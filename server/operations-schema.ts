import type { Knex } from "knex";

export async function operationsSchema(k: Knex) {
  await k.schema.alterTable("organizations", (t) => {
    t.string("logo_key", 100);
    t.string("logo_mime", 40);
    t.boolean("marketplace_visible").notNullable().defaultTo(false);
  });
  await k.schema.createTable("organization_resources", (t) => {
    t.string("id", 64).primary();
    t.string("organization_id", 64)
      .notNullable()
      .references("id")
      .inTable("organizations")
      .index();
    t.string("title", 180).notNullable();
    t.text("skills").notNullable();
    t.string("location", 180).notNullable();
    t.decimal("experience", 5, 1).notNullable();
    t.integer("count").notNullable();
    t.string("available_from", 10).notNullable();
    t.string("status", 30).notNullable();
    t.bigInteger("rate_minor").notNullable();
    t.string("currency", 3).notNullable();
    t.string("rate_unit", 20).notNullable();
    t.text("notes").notNullable();
    t.integer("version").notNullable().defaultTo(1);
    t.string("created_at", 30).notNullable();
    t.string("updated_at", 30).notNullable();
  });
  await k.schema.createTable("document_policies", (t) => {
    t.string("id", 64).primary();
    t.string("category", 180).notNullable();
    t.string("organization_type", 40).notNullable();
    t.boolean("required").notNullable().defaultTo(false);
    t.boolean("expiry_required").notNullable().defaultTo(false);
    t.text("reminder_days").notNullable();
    t.string("updated_at", 30).notNullable();
    t.unique(["category", "organization_type"]);
  });
  await k.schema.alterTable("signature_envelopes", (t) => {
    t.text("contract_snapshot").notNullable().defaultTo("{}");
    t.string("contract_digest", 64).notNullable().defaultTo("");
  });
  await k.schema.alterTable("signature_parties", (t) => {
    t.string("challenge_id", 64);
    t.string("otp_hash", 64);
    t.string("otp_expires_at", 30);
    t.integer("otp_attempts").notNullable().defaultTo(0);
    t.string("otp_sent_at", 30);
    t.string("ip_hash", 64);
  });
  await k.schema.alterTable("public_inquiries", (t) => {
    t.string("reference", 50).unique();
    t.text("resolution").notNullable().defaultTo("");
  });
  for (const role of await k("roles")) {
    const p = JSON.parse(role.permissions);
    p.contacts = ["super_admin", "org_admin", "verification"].includes(role.id)
      ? ["view", "create", "edit", "manage"]
      : ["view"];
    if (["super_admin", "hr", "procurement", "org_admin"].includes(role.id))
      p.resources = ["view", "create", "edit", "manage"];
    if (
      ["management", "org_member", "org_recruiter", "org_procurement"].includes(
        role.id,
      )
    )
      p.resources = ["view"];
    await k("roles")
      .where({ id: role.id })
      .update({ permissions: JSON.stringify(p) });
  }
}
