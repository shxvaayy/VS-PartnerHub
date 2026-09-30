import { randomUUID } from "node:crypto";
import { db, now } from "./db.js";
import { assert, HttpError } from "./errors.js";
import {
  geminiConfiguration,
  type GeminiConfiguration,
} from "./integration-config.js";
import type { SessionUser } from "../shared/domain.js";
import { assertAiRequestActive } from "./ai-request.js";

export type GeminiPart =
  { text: string } | { inlineData: { mimeType: string; data: string } };
export interface GeminiInput {
  system: string;
  parts: GeminiPart[];
  schema?: Record<string, unknown>;
  history?: { role: "user" | "model"; parts: { text: string }[] }[];
  purpose: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputTokens?: number;
}
// This product has one response language. Inputs can be multilingual, but a
// user's request or quoted document must never override the response policy.
export const aiLanguagePolicy =
  "Always write user-facing answers, explanations, summaries, suggestions, warnings and generated requirement drafts in English. Understand Hindi, Hinglish, typos and other input languages, but do not mirror them or switch response language, even when asked. Preserve proper names, identifiers, search keywords, quoted source values and verbatim OCR transcripts exactly; never translate or invent evidence. Keep schema keys and enum values unchanged.";

// Long UUID enums can exceed the provider's constrained-generation complexity
// limit even for modest evidence sets. Short per-request citation keys preserve
// an exact allowlist; callers and stored history still receive the real IDs.
export function citationContract(input: GeminiInput) {
  const schema: any = input.schema ? structuredClone(input.schema) : undefined;
  const ids: string[] = schema?.properties?.sourceIds?.items?.enum || [];
  const references = ids.map((id, index) => ({ key: `ref${index + 1}`, id }));
  if (references.length)
    schema.properties.sourceIds.items.enum = references.map(
      (reference) => reference.key,
    );
  return {
    schema,
    instruction: references.length
      ? ` In sourceIds, return only the short citation keys from this reference index, never the database IDs. Do not print citation keys in the answer. Reference index: ${JSON.stringify(references)}`
      : "",
    restore(result: any) {
      if (
        result &&
        typeof result === "object" &&
        Array.isArray(result.sourceIds)
      ) {
        return {
          ...result,
          sourceIds: result.sourceIds.map(
            (key: string) =>
              references.find((reference) => reference.key === key)?.id || key,
          ),
        };
      }
      return result;
    },
  };
}
export async function callGemini(
  input: GeminiInput,
  user?: SessionUser,
  override?: GeminiConfiguration,
) {
  const settings = override || (await geminiConfiguration());
  assert(
    settings.enabled && settings.apiKey,
    503,
    "VS AI is not connected. Ask your platform administrator to enable it in Integrations.",
  );
  assert(
    /^gemini-[a-z0-9._-]+$/.test(settings.model),
    422,
    "The VS AI connection needs attention. Ask your administrator to review its settings.",
  );
  const signal = AbortSignal.any([
    AbortSignal.timeout(input.timeoutMs ?? 45000),
    ...(input.signal ? [input.signal] : []),
  ]);
  assertAiRequestActive(signal);
  const requestId = randomUUID();
  if (user) {
    await db.transaction(async (k) => {
      // Serializing on the user also makes the daily quota reliable under concurrent requests.
      let lock = k("users").where({ id: user.id });
      if (db.client.config.client === "pg") lock = lock.forUpdate();
      await lock.first();
      const count = await k("ai_requests")
        .where({ user_id: user.id })
        .where("created_at", ">=", `${now().slice(0, 10)}T00:00:00.000Z`)
        .count({ count: "*" })
        .first();
      assert(
        Number(count?.count || 0) < settings.dailyLimit,
        429,
        "Your daily VS AI allowance has been reached. Try again tomorrow or ask an administrator to review your allowance.",
      );
      const busy = await k("ai_requests")
        .where({ user_id: user.id, status: "running" })
        .where("created_at", ">", new Date(Date.now() - 120000).toISOString())
        .first();
      assert(
        !busy,
        409,
        "Your previous AI request is still running. Please wait for it to finish.",
      );
      await k("ai_requests").insert({
        id: requestId,
        user_id: user.id,
        organization_id: user.organization_id,
        purpose: input.purpose,
        status: "running",
        model: settings.model,
        created_at: now(),
      });
    });
  }
  try {
    const citations = citationContract(input);
    const base =
      process.env.NODE_ENV === "test" && process.env.GEMINI_TEST_URL
        ? process.env.GEMINI_TEST_URL
        : "https://generativelanguage.googleapis.com/v1beta";
    const request: RequestInit = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": settings.apiKey,
      },
      signal,
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: `${input.system}${citations.instruction}\n\nProduct response-language policy: ${aiLanguagePolicy}`,
            },
          ],
        },
        contents: [
          ...(input.history || []),
          { role: "user", parts: input.parts },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: input.maxOutputTokens ?? 2048,
          ...(/^gemini-2\.5-flash$/.test(settings.model)
            ? { thinkingConfig: { thinkingBudget: 0 } }
            : {}),
          ...(citations.schema
            ? {
                responseMimeType: "application/json",
                responseJsonSchema: citations.schema,
              }
            : {}),
        },
      }),
    };
    let response = await fetch(
      `${base}/models/${settings.model}:generateContent`,
      request,
    );
    for (
      let retry = 0;
      retry < 1 && [500, 502, 503, 504].includes(response.status);
      retry++
    ) {
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, 500 * (retry + 1)));
      assertAiRequestActive(signal);
      response = await fetch(
        `${base}/models/${settings.model}:generateContent`,
        request,
      );
    }
    const body = await response.json();
    if (!response.ok) {
      console.warn("VS AI connection error", {
        requestId,
        purpose: input.purpose,
        status: response.status,
        providerCode: body.error?.status,
      });
      if (response.status === 429)
        throw new HttpError(
          503,
          "VS AI is temporarily at capacity. Please try again later.",
        );
      if ([401, 403, 404].includes(response.status))
        throw new HttpError(
          503,
          "The VS AI connection needs attention. Ask your administrator to review its settings.",
        );
      throw new HttpError(
        502,
        "VS AI could not complete this request. Please try again.",
      );
    }
    const candidate = body.candidates?.[0];
    assert(
      candidate?.finishReason === "STOP",
      502,
      "VS AI could not finish this answer. Try a smaller document or a more specific request.",
    );
    const text = candidate?.content?.parts
      ?.filter((p: any) => typeof p.text === "string" && !p.thought)
      .map((p: any) => p.text)
      .join("\n");
    assert(
      text?.trim(),
      502,
      "VS AI could not produce an answer. Please rephrase your request.",
    );
    const result = citations.restore(input.schema ? JSON.parse(text) : text);
    assertAiRequestActive(signal);
    if (user)
      await db("ai_requests")
        .where({ id: requestId })
        .update({ status: "completed", completed_at: now() });
    return {
      result,
      model: settings.model,
      usage: {
        input: Number(body.usageMetadata?.promptTokenCount || 0),
        output: Number(body.usageMetadata?.candidatesTokenCount || 0),
      },
      requestId,
    };
  } catch (error) {
    if (user)
      await db("ai_requests")
        .where({ id: requestId })
        .update({ status: "failed", completed_at: now() });
    assertAiRequestActive(signal);
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      502,
      "VS AI could not connect or read the response. Please try again.",
    );
  }
}
