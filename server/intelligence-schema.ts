import type { Knex } from "knex";

export async function intelligenceSchema(k: Knex) {
  await k.schema.createTable("document_extraction_reviews", (t) => {
    t.string("id", 64).primary();
    t.string("extraction_id", 64)
      .notNullable()
      .references("id")
      .inTable("document_extractions")
      .index();
    t.string("document_id", 64)
      .notNullable()
      .references("id")
      .inTable("documents")
      .index();
    t.string("reviewer_id", 64).notNullable().references("id").inTable("users");
    t.string("reviewer_name", 200).notNullable();
    t.string("source_digest", 64).notNullable();
    t.string("decision", 30).notNullable();
    t.text("fields").notNullable();
    t.text("validation").notNullable();
    t.text("note").notNullable();
    t.string("created_at", 30).notNullable();
  });
}
