import { createHash } from "node:crypto";
import { z } from "zod";
import { db, now, type Database } from "./db.js";
import { assert } from "./errors.js";
import { audit } from "./events.js";
import { assertActive, can } from "./security.js";
import {
  accessibleRecord,
  getItems,
  isBuyer,
  serializeRecord,
} from "./record-service.js";
import type { SessionUser, WorkRecord } from "../shared/domain.js";

async function responseDigest(record: WorkRecord, k: Database) {
  const items = (await getItems(record.id, k)).map(
    ({ id: _id, ...item }) => item,
  );
  // Status changes do not change a proposal. Changed proposal content invalidates
  // the previous assessment even when the commercial total stays the same.
  return createHash("sha256")
    .update(
      JSON.stringify({
        title: record.title,
        payload: record.payload,
        currency: record.currency,
        items,
        amount: record.amount_minor,
      }),
    )
    .digest("hex");
}
export async function proposalEvaluation(record: WorkRecord, k: Database = db) {
  const parentRaw = await k("records")
    .where({ id: record.parent_id, kind: "rfqs" })
    .first();
  if (!parentRaw) return { applicable: false };
  const parent = serializeRecord(parentRaw);
  if (parent.payload.solicitation_type !== "RFP") return { applicable: false };
  const evaluation = await k("proposal_evaluations")
    .join("users", "proposal_evaluations.reviewed_by", "users.id")
    .where("quotation_id", record.id)
    .select("proposal_evaluations.*", "users.name as reviewer_name")
    .first();
  const technicalWeight = Number(parent.payload.technical_weight ?? 60);
  return {
    applicable: true,
    criteria: parent.payload.evaluation_criteria,
    technical_weight: technicalWeight,
    commercial_weight: 100 - technicalWeight,
    rfq: { id: parent.id, number: parent.number, status: parent.status },
    evaluation: evaluation
      ? {
          technical_score: evaluation.technical_score,
          commercial_score: evaluation.commercial_score,
          notes: evaluation.notes,
          quotation_version: evaluation.quotation_version,
          version: evaluation.version,
          reviewer_name: evaluation.reviewer_name,
          updated_at: evaluation.updated_at,
          current:
            evaluation.response_digest === (await responseDigest(record, k)),
          weighted_score:
            Math.round(
              evaluation.technical_score * technicalWeight +
                evaluation.commercial_score * (100 - technicalWeight),
            ) / 100,
        }
      : null,
  };
}
const evaluationSchema = z
  .object({
    quotation_version: z.number().int().positive(),
    version: z.number().int().min(0),
    technical_score: z.number().int().min(0).max(100),
    commercial_score: z.number().int().min(0).max(100),
    notes: z.string().trim().min(10).max(5000),
  })
  .strict();

export async function evaluateProposal(
  user: SessionUser,
  id: string,
  input: unknown,
) {
  assertActive(user);
  const data = evaluationSchema.parse(input);
  return db.transaction(async (k) => {
    let query = k("records").where({ id });
    if (db.client.config.client === "pg") query = query.forUpdate();
    await query.first();
    const record = await accessibleRecord(id, user, k);
    assert(
      record.kind === "quotations" &&
        isBuyer(user, record) &&
        can(user, "quotations", "review"),
      403,
      "Only the authorized buyer review team can assess proposals.",
    );
    assert(
      ["submitted", "under_review", "clarification"].includes(record.status),
      422,
      "Assess a submitted proposal before its final decision.",
    );
    assert(
      record.version === data.quotation_version,
      409,
      "The proposal has changed. Refresh before assessing it.",
    );
    const current = await proposalEvaluation(record, k);
    assert(
      current.applicable,
      422,
      "Structured proposal evaluation applies to RFP responses.",
    );
    assert(
      ["published", "evaluation"].includes(current.rfq!.status),
      422,
      "This RFP is no longer open for evaluation.",
    );
    assert(
      data.version === (current.evaluation?.version || 0),
      409,
      "Another reviewer updated this evaluation. Refresh before saving.",
    );
    const values = {
      quotation_id: id,
      technical_score: data.technical_score,
      commercial_score: data.commercial_score,
      notes: data.notes,
      response_digest: await responseDigest(record, k),
      quotation_version: record.version,
      version: data.version + 1,
      reviewed_by: user.id,
      updated_at: now(),
    };
    await k("proposal_evaluations")
      .insert(values)
      .onConflict("quotation_id")
      .merge();
    await audit(
      k,
      user,
      "proposal_evaluated",
      "quotations",
      record,
      undefined,
      JSON.stringify({
        before: current.evaluation || null,
        after: {
          technical_score: data.technical_score,
          commercial_score: data.commercial_score,
          notes: data.notes,
          quotation_version: record.version,
          version: values.version,
        },
        criteria: current.criteria,
        technical_weight: current.technical_weight,
      }),
    );
    return proposalEvaluation(record, k);
  });
}
