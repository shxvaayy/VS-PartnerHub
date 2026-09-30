import { createHash, randomUUID } from "node:crypto";
import { readStoredFile } from "./storage.js";
import { z } from "zod";
import {
  emptyIdentity,
  extractedIdentitySchema,
  identityLabels,
  type ExtractedIdentity,
  type ExtractionValidation,
  type IdentityField,
} from "../shared/ai.js";
import type { SessionUser } from "../shared/domain.js";
import { now, parseJson, type Database } from "./db.js";
import { assert } from "./errors.js";
import { uuid } from "./validation.js";
import { audit } from "./events.js";

export const extractionReviewSchema = z.object({
  extractionId: uuid,
  fields: extractedIdentitySchema,
  sourceConfirmed: z.literal(true, {
    error:
      "Confirm that you compared the extracted fields with the source document.",
  }),
});
export function validateExtraction(
  identity: ExtractedIdentity = emptyIdentity(),
  document: any,
  organization?: any,
): ExtractionValidation[] {
  const profile = parseJson(organization?.details),
    checks: ExtractionValidation[] = [];
  const normalize = (value: string) =>
    value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const identifiers: Partial<Record<IdentityField, RegExp>> = {
    pan: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
    gst: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
    cin: /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/,
  };
  for (const key of Object.keys(identityLabels) as IdentityField[]) {
    const value = identity[key]?.trim();
    if (!value) {
      checks.push({
        field: key,
        status: "missing",
        message:
          "Not present in this extraction. Add a value only if a human can read it in the original.",
      });
      continue;
    }
    if (identifiers[key]) {
      if (!identifiers[key]!.test(value.toUpperCase())) {
        checks.push({
          field: key,
          status: "invalid",
          message: `${identityLabels[key]} does not match the expected identifier format. Inspect the printed source.`,
        });
        continue;
      }
      if (profile[key] && normalize(profile[key]) !== normalize(value)) {
        checks.push({
          field: key,
          status: "warning",
          message:
            "The extracted identifier differs from the organization's current profile.",
        });
        continue;
      }
      checks.push({
        field: key,
        status: "valid",
        message: profile[key]
          ? "Format checked; matches the profile. This is not a statutory verification."
          : "Identifier format checked. No profile value is available for comparison.",
      });
    } else if (key === "expiry_date") {
      const date = Date.parse(value);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        Number.isNaN(date) ||
        new Date(date).toISOString().slice(0, 10) !== value
      )
        checks.push({
          field: key,
          status: "invalid",
          message:
            "The expiry date is ambiguous or invalid. Check the source and use YYYY-MM-DD.",
        });
      else if (value < now().slice(0, 10))
        checks.push({
          field: key,
          status: "warning",
          message: "The extracted expiry date is in the past.",
        });
      else if (
        document.expires_at &&
        document.expires_at.slice(0, 10) !== value
      )
        checks.push({
          field: key,
          status: "warning",
          message:
            "The extracted date differs from the document's registered expiry date.",
        });
      else
        checks.push({
          field: key,
          status: "valid",
          message: "Date format checked. Confirm the date against the source.",
        });
    } else if (
      key === "company_name" &&
      organization?.legal_name &&
      normalize(value) !== normalize(organization.legal_name)
    )
      checks.push({
        field: key,
        status: "warning",
        message:
          "The extracted company name differs from the registered legal name. Review spelling and legal-entity details.",
      });
    else
      checks.push({
        field: key,
        status: "valid",
        message:
          "Readable value supplied for human review; no external validation performed.",
      });
  }
  return checks;
}
export async function recordExtractionReview(
  k: Database,
  document: any,
  user: SessionUser,
  review: z.infer<typeof extractionReviewSchema>,
  decision: string,
  note: string,
) {
  let query = k("document_extractions").where({
    id: review.extractionId,
    document_id: document.id,
  });
  if (k.client.config.client === "pg") query = query.forUpdate();
  const extraction = await query.first();
  assert(
    extraction,
    404,
    "This extraction does not belong to the document being reviewed.",
  );
  const bytes = await readStoredFile(document.storage_key);
  const digest = createHash("sha256").update(bytes).digest("hex");
  assert(
    digest === extraction.source_digest,
    409,
    "The source file changed after extraction. Extract the current document before reviewing it.",
  );
  const organization = await k("organizations")
    .where({ id: document.organization_id })
    .first();
  const validation = validateExtraction(review.fields, document, organization);
  if (
    decision === "approved" &&
    validation.some((c) => ["invalid", "warning"].includes(c.status))
  )
    assert(
      note.trim().length >= 10,
      422,
      "Explain how you resolved the identifier, profile or expiry warnings before approving this document.",
    );
  const id = randomUUID();
  await k("document_extraction_reviews").insert({
    id,
    extraction_id: extraction.id,
    document_id: document.id,
    reviewer_id: user.id,
    reviewer_name: user.name,
    source_digest: digest,
    decision,
    fields: JSON.stringify(review.fields),
    validation: JSON.stringify(validation),
    note,
    created_at: now(),
  });
  await audit(
    k,
    user,
    "extraction_human_reviewed",
    "documents",
    document,
    decision,
    `Human-reviewed fields retained with extraction ${extraction.id}. ${note}`,
  );
}
