import type { Knex } from "knex";
import { randomUUID } from "node:crypto";

export async function authSchema(k: Knex) {
  await k.schema.alterTable("sessions", (t) => {
    t.string("public_id", 36).unique();
    t.string("last_seen_at", 30);
    t.string("user_agent", 500).notNullable().defaultTo("");
  });
  for (const session of await k("sessions").select("id", "created_at"))
    await k("sessions")
      .where({ id: session.id })
      .update({ public_id: randomUUID(), last_seen_at: session.created_at });
  await k.schema.createTable("auth_attempts", (t) => {
    t.string("key", 64).primary();
    t.integer("attempts").notNullable().defaultTo(0);
    t.string("expires_at", 30).notNullable().index();
  });
  await k.schema.alterTable("invitations", (t) => {
    t.string("email_id", 64).references("id").inTable("email_outbox");
  });
}
