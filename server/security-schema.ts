import type { Knex } from "knex";
export async function securitySchema(k: Knex) {
  await k.schema.alterTable("auth_tokens", (t) => {
    t.string("email_id", 64).references("id").inTable("email_outbox");
  });
  await k.schema.alterTable("signature_parties", (t) => {
    t.string("email_id", 64).references("id").inTable("email_outbox");
    t.text("signer_identity");
  });
}
