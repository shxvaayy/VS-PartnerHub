import type { Knex } from "knex";

export async function aiEfficiencySchema(k: Knex) {
  await k.schema.alterTable("ai_messages", (t) => {
    t.string("cache_key", 64).index();
  });
  await k.schema.alterTable("document_extractions", (t) => {
    t.index(
      ["document_id", "user_id", "source_digest"],
      "document_extraction_reuse_idx",
    );
  });
}
