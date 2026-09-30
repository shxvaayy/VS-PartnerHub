import type { Knex } from "knex";

export async function cloudSchema(k: Knex) {
  await k.schema.createTable("document_uploads", (t) => {
    t.string("id", 36).primary();
    t.string("user_id", 64).notNullable().references("id").inTable("users");
    t.string("storage_key", 100).notNullable().unique();
    t.string("name", 200).notNullable();
    t.string("mime_type", 100).notNullable();
    t.integer("size").notNullable();
    t.text("input").notNullable();
    t.string("status", 30).notNullable();
    t.string("document_id", 64)
      .references("id")
      .inTable("documents")
      .onDelete("SET NULL");
    t.string("created_at", 30).notNullable();
    t.string("expires_at", 30).notNullable().index();
    t.string("updated_at", 30).notNullable();
  });
  await k.schema.createTable("job_leases", (t) => {
    t.string("name", 80).primary();
    t.string("owner", 36).notNullable();
    t.string("expires_at", 30).notNullable();
    t.string("next_run_at", 30).notNullable();
  });
}
