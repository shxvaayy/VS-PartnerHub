import { Router } from "express";
import { randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import { z, ZodError } from "zod";
import { db, now, parseJson } from "./db.js";
import { assert, HttpError } from "./errors.js";
import { authenticated, assertActive } from "./security.js";
import { canCreate, saveRecord } from "./record-service.js";
import { recordSchema, uuid } from "./validation.js";
import { audit } from "./events.js";
import { csv } from "./records.js";

const kinds = ["catalog", "requirements", "candidates"] as const;
const columns: Record<(typeof kinds)[number], string[]> = {
  catalog: [
    "title",
    "currency",
    "sku",
    "item_type",
    "category",
    "description",
    "specifications",
    "unit",
    "price",
    "tax",
    "moq",
    "availability",
    "lead_time",
    "warranty",
    "delivery_locations",
    "technologies",
    "integrations",
    "documentation_url",
    "certifications",
  ],
  requirements: [
    "title",
    "currency",
    "requirement_type",
    "category",
    "description",
    "location",
    "required_date",
    "deadline",
    "budget",
    "quantity",
    "criteria",
    "skills",
    "experience",
    "notice_period",
    "technology",
    "delivery_requirements",
    "positions",
    "employment_type",
  ],
  candidates: [
    "title",
    "parent_id",
    "currency",
    "email",
    "phone",
    "skills",
    "experience",
    "location",
    "notice_period",
    "current_compensation",
    "expected_compensation",
    "availability",
    "consent",
    "recruiter_notes",
  ],
};
const numeric = new Set([
  "price",
  "tax",
  "moq",
  "availability",
  "budget",
  "quantity",
  "positions",
  "current_compensation",
  "expected_compensation",
]);
const validationMessage = (error: unknown) => {
  if (error instanceof ZodError)
    return error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
  if (error instanceof HttpError) return error.message;
  if (["23505", "SQLITE_CONSTRAINT_UNIQUE"].includes((error as any)?.code))
    return "A record with the same unique identifier already exists. Correct or remove the duplicate row.";
  throw error;
};
export const importsRouter = Router();
importsRouter.use(authenticated, (req, _res, next) => {
  assertActive(req.user);
  next();
});
importsRouter.get("/:kind/template", async (req, res) => {
  const kind = z.enum(kinds).parse(req.params.kind);
  assert(
    canCreate(req.user, kind),
    403,
    "Your role cannot import these records.",
  );
  res
    .type("text/csv")
    .attachment(`${kind}-import-template.csv`)
    .send(csv([columns[kind]]));
});
importsRouter.post("/:kind/preview", async (req, res) => {
  const kind = z.enum(kinds).parse(req.params.kind);
  assert(
    canCreate(req.user, kind),
    403,
    "Your role cannot import these records.",
  );
  const { content } = z
    .object({ content: z.string().min(1).max(1000000) })
    .parse(req.body);
  let rows: Record<string, string>[];
  try {
    rows = parse(content, {
      bom: true,
      skip_empty_lines: true,
      trim: true,
      max_record_size: 20000,
      columns: (headers: string[]) => {
        assert(
          headers.includes("title") &&
            headers.length === new Set(headers).size &&
            headers.every((h) => columns[kind].includes(h)),
          422,
          `Use the template columns for ${kind}. Unknown or duplicate headers are not accepted.`,
        );
        return headers;
      },
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      422,
      "The file is not a valid UTF-8 CSV. Check the delimiter, quotation marks and column counts.",
    );
  }
  assert(
    rows.length > 0 && rows.length <= 500,
    422,
    "Import between 1 and 500 rows per batch.",
  );
  const inputs: unknown[] = [],
    results: { row: number; title: string; valid: boolean; error?: string }[] =
      [];
  const rollback = new Error("preview-rollback");
  try {
    await db.transaction(async (k) => {
      for (const [index, row] of rows.entries()) {
        const payload: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(row)) {
          if (["title", "currency", "parent_id"].includes(key) || value === "")
            continue;
          payload[key] =
            key === "consent"
              ? value.toLowerCase() === "true"
              : (numeric.has(key) &&
                    !(kind === "candidates" && key === "availability")) ||
                  (key === "experience" && kind === "candidates")
                ? Number(value)
                : value;
        }
        const raw = {
          title: row.title,
          currency: row.currency || "INR",
          ...(row.parent_id ? { parent_id: row.parent_id } : {}),
          payload,
          items: [],
        };
        inputs.push(raw);
        try {
          const input = recordSchema.parse(raw);
          await k.transaction((sub) =>
            saveRecord(req.user, kind, input, undefined, sub),
          );
          results.push({ row: index + 2, title: row.title, valid: true });
        } catch (error) {
          results.push({
            row: index + 2,
            title: row.title,
            valid: false,
            error: validationMessage(error),
          });
        }
      }
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  const id = randomUUID(),
    status = results.every((r) => r.valid) ? "ready" : "invalid";
  await db("import_batches").insert({
    id,
    organization_id: req.user.organization_id,
    user_id: req.user.id,
    kind,
    status,
    rows: JSON.stringify(inputs),
    results: JSON.stringify(results),
    expires_at: new Date(Date.now() + 30 * 60000).toISOString(),
    created_at: now(),
    updated_at: now(),
  });
  res.json({
    id,
    status,
    results,
    count: results.length,
    expiresInMinutes: 30,
  });
});
importsRouter.post("/:id/commit", async (req, res) => {
  const id = uuid.parse(req.params.id);
  const result = await db.transaction(async (k) => {
    let q = k("import_batches").where({ id, user_id: req.user.id });
    if (db.client.config.client === "pg") q = q.forUpdate();
    const batch = await q.first();
    assert(
      batch && batch.organization_id === req.user.organization_id,
      404,
      "Import preview not found.",
    );
    assert(
      canCreate(req.user, batch.kind),
      403,
      "Your current role cannot import these records.",
    );
    if (batch.status === "completed") return parseJson(batch.results, []);
    assert(
      batch.status === "ready" && batch.expires_at > now(),
      422,
      "Upload a valid CSV and create a fresh preview before importing.",
    );
    const saved = [];
    for (const [index, input] of parseJson<any[]>(batch.rows, []).entries()) {
      try {
        const record = await saveRecord(
          req.user,
          batch.kind,
          recordSchema.parse(input),
          undefined,
          k,
        );
        saved.push({
          id: record.id,
          number: record.number,
          title: record.title,
          href: `/app/${batch.kind}/${record.id}`,
        });
      } catch (error) {
        throw new HttpError(
          422,
          `Row ${index + 2}: ${validationMessage(error)} No rows were imported.`,
        );
      }
    }
    await k("import_batches")
      .where({ id })
      .update({
        status: "completed",
        rows: "[]",
        results: JSON.stringify(saved),
        updated_at: now(),
      });
    await audit(
      k,
      req.user,
      "bulk_import_completed",
      batch.kind,
      undefined,
      undefined,
      `${saved.length} records from validated CSV`,
    );
    return saved;
  });
  res.json({ status: "completed", records: result });
});
