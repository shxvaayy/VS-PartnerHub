import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, now, parseJson, type Database } from "./db.js";
import { authenticated, permit } from "./security.js";
import { assert } from "./errors.js";
import { audit } from "./events.js";
import { organizationTypes, documentCategories } from "../shared/domain.js";

const kinds = [
  "category",
  "industry",
  "unit",
  "document",
  "certification",
] as const;
export async function masterLists(k: Database = db, includeInactive = false) {
  const q = k("master_data").orderBy("position").orderBy("label");
  if (!includeInactive) q.where({ active: true });
  const rows = await q;
  return Object.fromEntries(
    kinds.map((kind) => [
      kind,
      rows
        .filter((row) => row.kind === kind)
        .map((row) => ({
          ...row,
          active: Boolean(row.active),
          metadata: parseJson(row.metadata),
        })),
    ]),
  );
}
export async function documentPolicyCatalogue(k: Database = db) {
  // A caller may provide a transaction, whose PostgreSQL connection must not
  // run overlapping queries.
  const setting = await k("settings").where({ key: "platform" }).first();
  const masters = await k("master_data").where({
    kind: "document",
    active: true,
  });
  const policies = await k("document_policies");
  return { settings: parseJson(setting?.value), masters, policies };
}
export function resolveDocumentPolicies(
  type: string,
  {
    settings,
    masters,
    policies,
  }: Awaited<ReturnType<typeof documentPolicyCatalogue>>,
) {
  return [
    ...new Set([
      ...masters.map((row) => row.label),
      ...(settings.requiredDocuments || ["PAN", "Incorporation"]),
    ]),
  ].map((category) => {
    const policy =
      policies.find(
        (row) => row.category === category && row.organization_type === type,
      ) ||
      policies.find(
        (row) => row.category === category && row.organization_type === "all",
      );
    return {
      category,
      required: policy
        ? Boolean(policy.required)
        : (settings.requiredDocuments || ["PAN", "Incorporation"]).includes(
            category,
          ),
      expiry_required: Boolean(policy?.expiry_required),
      reminder_days: policy
        ? parseJson<number[]>(policy.reminder_days, [90, 60, 30])
        : settings.documentExpiryDays || [90, 60, 30],
    };
  });
}
export async function documentPolicies(type: string, k: Database = db) {
  return resolveDocumentPolicies(type, await documentPolicyCatalogue(k));
}
export const masterDataRouter = Router();
masterDataRouter.use(authenticated);
masterDataRouter.get("/", async (req, res) =>
  res.json(
    await masterLists(
      db,
      req.query.all === "true" && req.user.role === "super_admin",
    ),
  ),
);
masterDataRouter.get("/document-policies", async (req, res) => {
  if (req.query.type) {
    const type = z.enum(organizationTypes).parse(req.query.type);
    res.json(await documentPolicies(type));
  } else {
    res.json(
      (await db("document_policies").orderBy("category")).map((row) => ({
        ...row,
        required: Boolean(row.required),
        expiry_required: Boolean(row.expiry_required),
        reminder_days: parseJson(row.reminder_days, []),
      })),
    );
  }
});
const entrySchema = z.object({
  kind: z.enum(kinds),
  label: z.string().trim().min(1).max(100),
  active: z.boolean().default(true),
  position: z.number().int().min(0).max(10000).default(0),
});
masterDataRouter.post(
  "/",
  permit("master-data", "manage"),
  async (req, res) => {
    const input = entrySchema.parse(req.body);
    const id = randomUUID(),
      code = input.label.toLowerCase().replace(/[^a-z0-9]+/g, "-") || id;
    assert(
      !(await db("master_data").where({ kind: input.kind, code }).first()),
      409,
      "This value already exists. Edit the existing entry.",
    );
    await db.transaction(async (k) => {
      await k("master_data").insert({
        ...input,
        id,
        code,
        metadata: "{}",
        created_at: now(),
        updated_at: now(),
      });
      await audit(
        k,
        req.user,
        "master_value_created",
        "master-data",
        { id },
        input.active ? "active" : "inactive",
        input.label,
      );
    });
    res.status(201).json({ id });
  },
);
masterDataRouter.patch(
  "/:id",
  permit("master-data", "manage"),
  async (req, res) => {
    const id = z.string().max(160).parse(req.params.id),
      input = entrySchema.parse(req.body);
    await db.transaction(async (k) => {
      const row = await k("master_data").where({ id }).first();
      assert(
        row && row.kind === input.kind,
        404,
        "Configuration entry not found.",
      );
      if (row.kind === "document") {
        assert(
          input.label === row.label,
          422,
          "Document categories keep their name to preserve historical records. Create a new category instead.",
        );
        if (!input.active) {
          const required = await k("document_policies")
            .where({ category: row.label, required: true })
            .first();
          const settings = parseJson(
            (await k("settings").where({ key: "platform" }).first())?.value,
          );
          assert(
            !required &&
              !(
                settings.requiredDocuments || ["PAN", "Incorporation"]
              ).includes(row.label),
            422,
            "Remove this category from required document policies before deactivating it.",
          );
        }
      }
      await k("master_data")
        .where({ id })
        .update({ ...input, updated_at: now() });
      await audit(
        k,
        req.user,
        "master_value_updated",
        "master-data",
        { id },
        input.active ? "active" : "inactive",
        input.label,
      );
    });
    res.json({ ok: true });
  },
);
masterDataRouter.put(
  "/document-policies",
  permit("master-data", "manage"),
  async (req, res) => {
    const input = z
      .object({
        category: z.string().trim().min(1).max(100),
        organization_type: z.enum(["all", ...organizationTypes]),
        required: z.boolean(),
        expiry_required: z.boolean(),
        reminder_days: z
          .array(z.number().int().min(1).max(365))
          .min(1)
          .max(8)
          .transform((days) => [...new Set(days)].sort((a, b) => b - a)),
      })
      .parse(req.body);
    assert(
      await db("master_data")
        .where({ kind: "document", label: input.category, active: true })
        .first(),
      422,
      "Choose an active document category.",
    );
    await db.transaction(async (k) => {
      await k("document_policies")
        .insert({
          ...input,
          id: randomUUID(),
          reminder_days: JSON.stringify(input.reminder_days),
          updated_at: now(),
        })
        .onConflict(["category", "organization_type"])
        .merge(["required", "expiry_required", "reminder_days", "updated_at"]);
      await audit(
        k,
        req.user,
        "document_policy_updated",
        "master-data",
        undefined,
        undefined,
        `${input.category} · ${input.organization_type}`,
      );
    });
    res.json({ ok: true });
  },
);
export async function activeDocumentCategory(
  category: string,
  k: Database = db,
) {
  return (
    Boolean(
      await k("master_data")
        .where({ kind: "document", label: category, active: true })
        .first(),
    ) ||
    (!(await k("master_data").where({ kind: "document" }).first()) &&
      documentCategories.includes(category))
  );
}
