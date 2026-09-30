import type { Knex } from "knex";
import { categories, documentCategories } from "../shared/domain.js";

export async function enterpriseSchema(k: Knex) {
  const id = (t: Knex.CreateTableBuilder) => t.string("id", 64).primary();
  const stamp = (t: Knex.CreateTableBuilder) => {
    t.string("created_at", 30).notNullable();
    t.string("updated_at", 30).notNullable();
  };
  const org = (t: Knex.CreateTableBuilder) =>
    t
      .string("organization_id", 64)
      .references("id")
      .inTable("organizations")
      .index();
  await k.schema.createTable("integration_settings", (t) => {
    t.string("key", 40).primary();
    t.text("encrypted_value").notNullable();
    t.string("updated_by", 64).references("id").inTable("users");
    t.string("updated_at", 30).notNullable();
    t.string("checked_at", 30);
    t.string("check_status", 30);
  });
  await k.schema.alterTable("email_outbox", (t) => {
    t.string("expires_at", 30);
    t.string("provider", 30);
    t.string("provider_reference", 255);
    t.string("delivered_at", 30);
  });
  await k.schema.createTable("ai_conversations", (t) => {
    id(t);
    org(t);
    t.string("user_id", 64)
      .notNullable()
      .references("id")
      .inTable("users")
      .index();
    t.string("title", 180).notNullable();
    stamp(t);
  });
  await k.schema.createTable("ai_messages", (t) => {
    id(t);
    t.string("conversation_id", 64)
      .notNullable()
      .references("id")
      .inTable("ai_conversations")
      .onDelete("CASCADE")
      .index();
    t.string("role", 20).notNullable();
    t.text("content").notNullable();
    t.text("sources").notNullable().defaultTo("[]");
    t.text("structured").notNullable().defaultTo("{}");
    t.string("model", 100);
    t.integer("input_tokens").notNullable().defaultTo(0);
    t.integer("output_tokens").notNullable().defaultTo(0);
    t.string("created_at", 30).notNullable();
  });
  await k.schema.createTable("ai_requests", (t) => {
    id(t);
    org(t);
    t.string("user_id", 64)
      .notNullable()
      .references("id")
      .inTable("users")
      .index();
    t.string("purpose", 40).notNullable();
    t.string("status", 30).notNullable();
    t.string("model", 100).notNullable();
    t.string("created_at", 30).notNullable().index();
    t.string("completed_at", 30);
  });
  await k.schema.createTable("document_extractions", (t) => {
    id(t);
    org(t);
    t.string("document_id", 64)
      .notNullable()
      .references("id")
      .inTable("documents");
    t.string("user_id", 64).notNullable().references("id").inTable("users");
    t.string("source_digest", 64).notNullable();
    t.text("result").notNullable();
    t.string("model", 100).notNullable();
    t.string("created_at", 30).notNullable();
  });
  await k.schema.createTable("organization_contacts", (t) => {
    id(t);
    org(t);
    t.string("name", 180).notNullable();
    t.string("email", 255).notNullable();
    t.string("phone", 50).notNullable().defaultTo("");
    t.string("role", 120).notNullable();
    t.boolean("active").notNullable().defaultTo(true);
    t.boolean("is_primary").notNullable().defaultTo(false);
    stamp(t);
    t.unique(["organization_id", "email"]);
  });
  await k.schema.createTable("master_data", (t) => {
    id(t);
    t.string("kind", 40).notNullable();
    t.string("code", 100).notNullable();
    t.string("label", 180).notNullable();
    t.boolean("active").notNullable().defaultTo(true);
    t.integer("position").notNullable().defaultTo(0);
    t.text("metadata").notNullable().defaultTo("{}");
    stamp(t);
    t.unique(["kind", "code"]);
  });
  await k.schema.createTable("approval_policies", (t) => {
    id(t);
    org(t);
    t.string("name", 180).notNullable();
    t.string("kind", 40).notNullable();
    t.string("currency", 3).notNullable();
    t.bigInteger("minimum_minor").notNullable().defaultTo(0);
    t.text("steps").notNullable();
    t.boolean("enabled").notNullable().defaultTo(true);
    stamp(t);
  });
  await k.schema.createTable("approval_requests", (t) => {
    id(t);
    t.string("record_id", 64)
      .notNullable()
      .references("id")
      .inTable("records")
      .index();
    t.string("policy_id", 64)
      .notNullable()
      .references("id")
      .inTable("approval_policies");
    t.integer("cycle").notNullable();
    t.text("steps").notNullable();
    t.string("status", 30).notNullable();
    t.string("requested_by", 64)
      .notNullable()
      .references("id")
      .inTable("users");
    stamp(t);
    t.unique(["record_id", "cycle"]);
  });
  await k.schema.createTable("approval_decisions", (t) => {
    id(t);
    t.string("request_id", 64)
      .notNullable()
      .references("id")
      .inTable("approval_requests")
      .onDelete("CASCADE");
    t.integer("step").notNullable();
    t.string("user_id", 64).notNullable().references("id").inTable("users");
    t.text("remarks").notNullable();
    t.string("created_at", 30).notNullable();
    t.unique(["request_id", "step"]);
  });
  await k.schema.createTable("import_batches", (t) => {
    id(t);
    org(t);
    t.string("user_id", 64).notNullable().references("id").inTable("users");
    t.string("kind", 40).notNullable();
    t.string("status", 30).notNullable();
    t.text("rows").notNullable();
    t.text("results").notNullable().defaultTo("[]");
    t.string("expires_at", 30).notNullable();
    stamp(t);
  });
  await k.schema.createTable("signature_envelopes", (t) => {
    id(t);
    t.string("contract_id", 64)
      .notNullable()
      .references("id")
      .inTable("records")
      .index();
    t.integer("contract_version").notNullable();
    t.string("document_id", 64)
      .notNullable()
      .references("id")
      .inTable("documents");
    t.string("source_digest", 64).notNullable();
    t.string("requested_by", 64)
      .notNullable()
      .references("id")
      .inTable("users");
    t.string("status", 30).notNullable();
    t.string("expires_at", 30).notNullable();
    t.string("completed_at", 30);
    t.string("certificate_key", 100);
    stamp(t);
  });
  await k.schema.createTable("signature_parties", (t) => {
    id(t);
    t.string("envelope_id", 64)
      .notNullable()
      .references("id")
      .inTable("signature_envelopes")
      .onDelete("CASCADE");
    t.string("user_id", 64).notNullable().references("id").inTable("users");
    t.string("status", 30).notNullable();
    t.string("signed_name", 180);
    t.string("signed_at", 30);
    t.string("signature_digest", 64);
    t.text("consent");
    t.unique(["envelope_id", "user_id"]);
  });
  await k.schema.createTable("webhook_endpoints", (t) => {
    id(t);
    org(t);
    t.string("name", 180).notNullable();
    t.text("url").notNullable();
    t.text("encrypted_secret").notNullable();
    t.text("events").notNullable();
    t.boolean("active").notNullable().defaultTo(true);
    t.string("created_by", 64).notNullable().references("id").inTable("users");
    stamp(t);
  });
  await k.schema.createTable("webhook_deliveries", (t) => {
    id(t);
    t.string("endpoint_id", 64)
      .notNullable()
      .references("id")
      .inTable("webhook_endpoints")
      .onDelete("CASCADE");
    t.string("event_id", 64).notNullable();
    t.text("payload").notNullable();
    t.string("status", 30).notNullable();
    t.integer("attempts").notNullable().defaultTo(0);
    t.integer("http_status");
    t.string("next_attempt", 30).notNullable();
    t.string("delivered_at", 30);
    t.string("created_at", 30).notNullable();
    t.unique(["endpoint_id", "event_id"]);
  });
  await k.schema.createTable("integration_tokens", (t) => {
    id(t);
    org(t);
    t.string("user_id", 64).notNullable().references("id").inTable("users");
    t.string("name", 180).notNullable();
    t.string("token_hash", 64).notNullable().unique();
    t.string("prefix", 20).notNullable();
    t.text("scopes").notNullable();
    t.string("expires_at", 30).notNullable();
    t.string("last_used_at", 30);
    t.boolean("active").notNullable().defaultTo(true);
    t.string("created_at", 30).notNullable();
  });
  await k.schema.createTable("public_inquiries", (t) => {
    id(t);
    t.string("name", 180).notNullable();
    t.string("email", 255).notNullable();
    t.string("company", 255).notNullable();
    t.text("message").notNullable();
    t.string("status", 30).notNullable().defaultTo("open");
    stamp(t);
  });
  await k.schema.alterTable("line_items", (t) => {
    t.string("catalog_item_id", 64).references("id").inTable("records");
  });
  const at = new Date().toISOString();
  const lists: Record<string, string[]> = {
    category: categories,
    industry: [
      "Information Technology",
      "Manufacturing",
      "Professional Services",
      "Healthcare",
      "Financial Services",
      "Education",
      "Retail",
      "Logistics",
      "Construction",
      "Other",
    ],
    unit: [
      "units",
      "hours",
      "days",
      "months",
      "kg",
      "litres",
      "metres",
      "licenses",
      "positions",
    ],
    document: documentCategories,
    certification: [
      "ISO 9001",
      "ISO 27001",
      "ISO 14001",
      "SOC 2",
      "CMMI",
      "MSME",
    ],
  };
  for (const [kind, values] of Object.entries(lists)) {
    for (const [position, label] of values.entries()) {
      const code = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      await k("master_data").insert({
        id: `master-${kind}-${code}`,
        kind,
        code,
        label,
        position,
        created_at: at,
        updated_at: at,
      });
    }
  }
  const roles = await k("roles");
  for (const role of roles) {
    const p = JSON.parse(role.permissions);
    p.ai = ["view", "create"];
    p.contacts =
      role.id === "org_admin" || role.internal
        ? ["view", "create", "edit", "manage"]
        : ["view"];
    if (["super_admin", "org_admin"].includes(role.id))
      p.integrations = ["view", "create", "edit", "manage"];
    if (
      [
        "super_admin",
        "org_admin",
        "procurement",
        "finance",
        "org_procurement",
        "org_finance",
      ].includes(role.id)
    )
      p.approvals = [
        "view",
        ...(["super_admin", "org_admin"].includes(role.id) ? ["manage"] : []),
      ];
    if (role.id === "super_admin")
      p["master-data"] = ["view", "create", "edit", "manage"];
    await k("roles")
      .where({ id: role.id })
      .update({ permissions: JSON.stringify(p) });
  }
}
