import { createHash } from "node:crypto";
import { db, parseJson } from "./db.js";
import { aiLanguagePolicy, callGemini, type GeminiInput } from "./gemini.js";
import { geminiConfiguration } from "./integration-config.js";
import type { SessionUser } from "../shared/domain.js";
import type { RetrievalPlan } from "./ai-retrieval.js";
import { assertAiRequestActive } from "./ai-request.js";

const cacheVersion = 1;
const ttl = 15 * 60 * 1000;
// Normalize only the observation clock. Record timestamps, amounts, filters and
// source versions remain in the key so changed evidence invalidates the result.
function canonical(value: any, key = ""): any {
  if (key === "asOf" && typeof value === "string") return value.slice(0, 10);
  if (Array.isArray(value)) return value.map((v) => canonical(v));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k], k)]),
    );
  return value;
}
export function analysisFingerprint(user: SessionUser, evidence: unknown) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        canonical({
          cacheVersion,
          language: aiLanguagePolicy,
          user: user.id,
          organization: user.organization_id,
          role: user.role,
          permissions: user.permissions,
          day: new Date().toISOString().slice(0, 10),
          evidence,
        }),
      ),
    )
    .digest("hex");
}

export async function cachedAnalysis(input: GeminiInput, user: SessionUser) {
  const settings = await geminiConfiguration();
  const parts = input.parts.map((part) => {
    if (!("text" in part)) return part;
    try {
      return { data: JSON.parse(part.text) };
    } catch {
      return part;
    }
  });
  const cacheKey = analysisFingerprint(user, {
    purpose: input.purpose,
    system: input.system,
    schema: input.schema,
    parts,
    model: settings.model,
  });
  const row = await db("ai_messages as m")
    .join("ai_conversations as c", "c.id", "m.conversation_id")
    .where({
      "m.cache_key": cacheKey,
      "m.role": "assistant",
      "c.user_id": user.id,
      "c.organization_id": user.organization_id,
    })
    .where("m.created_at", ">=", new Date(Date.now() - ttl).toISOString())
    .select("m.structured", "m.model")
    .orderBy("m.created_at", "desc")
    .first();
  const result = parseJson(row?.structured).analysisResult;
  assertAiRequestActive(input.signal);
  // The caller still validates the schema and reauthorizes every source before
  // saving/returning this result. Cache entries live in private history and are
  // removed with it; no shared organization or cross-user result cache exists.
  if (result)
    return {
      result,
      model: row.model,
      usage: { input: 0, output: 0 },
      engine: "saved_analysis",
      cacheKey,
    };
  return { ...(await callGemini(input, user)), cacheKey };
}

// Plans contain constrained query parameters only. Reusing a plan never reuses
// business facts: all SQL lookups and permission checks run again on every call.
const plans = new Map<
  string,
  { userId: string; expires: number; plan: RetrievalPlan }
>();
export function rememberedPlan(key: string): RetrievalPlan | undefined {
  const entry = plans.get(key);
  if (!entry) return;
  if (entry.expires <= Date.now()) {
    plans.delete(key);
    return;
  }
  plans.delete(key);
  plans.set(key, entry);
  return structuredClone(entry.plan);
}
export function rememberPlan(key: string, userId: string, plan: RetrievalPlan) {
  plans.set(key, {
    userId,
    expires: Date.now() + 5 * 60 * 1000,
    plan: structuredClone(plan),
  });
  while (plans.size > 128) plans.delete(plans.keys().next().value!);
}
export function forgetPlans(userId: string) {
  for (const [key, entry] of plans)
    if (entry.userId === userId) plans.delete(key);
}
