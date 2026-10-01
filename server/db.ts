import knex, { type Knex } from "knex";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { defaultPermissions, roleLabels } from "../shared/domain.js";
import { enterpriseSchema } from "./enterprise-schema.js";
import { operationsSchema } from "./operations-schema.js";
import { securitySchema } from "./security-schema.js";
import { authSchema } from "./auth-schema.js";
import { intelligenceSchema } from "./intelligence-schema.js";
import { aiEfficiencySchema } from "./ai-efficiency-schema.js";
import { cloudSchema } from "./cloud-schema.js";
import { advancedProcurementSchema } from "./advanced-procurement-schema.js";
import { attachDatabasePool } from "@vercel/functions";

if (!config.databaseUrl)
  mkdirSync(path.dirname(config.sqlitePath), { recursive: true });
const connectionString = (() => {
  if (!config.databaseUrl || !config.databaseSsl) return config.databaseUrl;
  const url = new URL(config.databaseUrl);
  // Explicitly verify the server identity even if a provider's generated URI
  // contains the weaker or version-dependent sslmode=require setting.
  url.searchParams.set("sslmode", "verify-full");
  url.searchParams.delete("uselibpqcompat");
  return url.toString();
})();
export const db = knex(
  config.databaseUrl
    ? {
        client: "pg",
        connection: {
          connectionString,
          ssl: config.databaseSsl ? { rejectUnauthorized: true } : undefined,
        },
        pool: {
          min: 0,
          max: config.serverless ? 5 : 10,
          idleTimeoutMillis: 5000,
          reapIntervalMillis: 1000,
          acquireTimeoutMillis: 20000,
        },
      }
    : {
        client: "better-sqlite3",
        connection: { filename: config.sqlitePath },
        useNullAsDefault: true,
        pool: {
          min: 1,
          max: 1,
          afterCreate: (
            connection: any,
            done: (err: any, conn: any) => void,
          ) => {
            connection.pragma("foreign_keys = ON");
            connection.pragma("journal_mode = WAL");
            connection.pragma("busy_timeout = 10000");
            done(null, connection);
          },
        },
      },
);
if (config.serverless && config.databaseUrl)
  // Knex uses Tarn. Adapt its release event so Vercel keeps the instance alive
  // until idle connections are closed, without replacing Knex transactions.
  attachDatabasePool({
    options: { idleTimeoutMillis: 6000 },
    on: (_event: "release", listener: (...args: any[]) => void) => {
      db.client.pool.on("release", listener);
    },
  });
export type Database = Knex | Knex.Transaction;
export const now = () => new Date().toISOString();
const timestamps = (t: Knex.CreateTableBuilder) => {
  t.string("created_at", 30).notNullable();
  t.string("updated_at", 30).notNullable();
};
const id = (t: Knex.CreateTableBuilder) => t.string("id", 64).primary();

async function initialSchema(k: Knex) {
  await k.schema.createTable("roles", (t) => {
    t.string("id", 50).primary();
    t.string("name").notNullable();
    t.boolean("internal").notNullable();
    t.text("permissions").notNullable();
  });
  await k.schema.createTable("organizations", (t) => {
    id(t);
    t.string("number").notNullable().unique();
    t.string("type", 50).notNullable();
    t.string("legal_name").notNullable();
    t.string("trade_name").notNullable().defaultTo("");
    t.string("industry").notNullable();
    t.string("city").notNullable();
    t.string("country").notNullable().defaultTo("India");
    t.string("website").notNullable().defaultTo("");
    t.string("status", 40).notNullable().index();
    t.string("contact_name").notNullable();
    t.string("contact_email").notNullable();
    t.string("contact_phone", 50).notNullable();
    t.text("details").notNullable().defaultTo("{}");
    timestamps(t);
    t.index(["type", "status"]);
  });
  await k.schema.createTable("users", (t) => {
    id(t);
    t.string("organization_id", 64).references("id").inTable("organizations");
    t.string("name").notNullable();
    t.string("email").notNullable().unique();
    t.text("password_hash").notNullable();
    t.string("role", 50).notNullable().references("id").inTable("roles");
    t.boolean("email_verified").notNullable().defaultTo(false);
    t.boolean("active").notNullable().defaultTo(true);
    t.text("preferences").notNullable().defaultTo("{}");
    timestamps(t);
  });
  await k.schema.createTable("sessions", (t) => {
    t.string("id", 64).primary();
    t.string("user_id", 64)
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    t.string("csrf_token", 64).notNullable();
    t.string("expires_at", 30).notNullable().index();
    t.string("created_at", 30).notNullable();
  });
  await k.schema.createTable("auth_tokens", (t) => {
    id(t);
    t.string("user_id", 64)
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    t.string("kind", 30).notNullable();
    t.string("token_hash", 64).notNullable();
    t.integer("attempts").notNullable().defaultTo(0);
    t.string("expires_at", 30).notNullable();
    t.string("created_at", 30).notNullable();
    t.index(["user_id", "kind"]);
  });
  await k.schema.createTable("invitations", (t) => {
    id(t);
    t.string("organization_id", 64).references("id").inTable("organizations");
    t.string("name").notNullable();
    t.string("email").notNullable();
    t.string("role", 50).notNullable().references("id").inTable("roles");
    t.string("token_hash", 64).notNullable().unique();
    t.string("invited_by", 64).notNullable().references("id").inTable("users");
    t.string("expires_at", 30).notNullable();
    t.string("accepted_at", 30);
    t.string("created_at", 30).notNullable();
  });
  await k.schema.createTable("sequences", (t) => {
    t.string("name", 50).primary();
    t.bigInteger("value").notNullable();
  });
  await k.schema.createTable("records", (t) => {
    id(t);
    t.string("kind", 40).notNullable();
    t.string("number").notNullable().unique();
    t.string("title").notNullable();
    t.string("status", 40).notNullable();
    for (const key of ["owner_org_id", "buyer_org_id", "partner_org_id"])
      t.string(key, 64).references("id").inTable("organizations").index();
    t.string("parent_id", 64).references("id").inTable("records").index();
    t.bigInteger("amount_minor").notNullable().defaultTo(0);
    t.string("currency", 3).notNullable().defaultTo("INR");
    t.text("payload").notNullable().defaultTo("{}");
    t.integer("version").notNullable().defaultTo(1);
    t.string("created_by", 64).notNullable().references("id").inTable("users");
    timestamps(t);
    t.index(["kind", "status"]);
    t.index(["kind", "created_at"]);
  });
  await k.schema.createTable("record_invitations", (t) => {
    t.string("record_id", 64)
      .notNullable()
      .references("id")
      .inTable("records")
      .onDelete("CASCADE");
    t.string("organization_id", 64)
      .notNullable()
      .references("id")
      .inTable("organizations");
    t.primary(["record_id", "organization_id"]);
  });
  await k.schema.createTable("line_items", (t) => {
    id(t);
    t.string("record_id", 64)
      .notNullable()
      .references("id")
      .inTable("records")
      .onDelete("CASCADE");
    t.string("name").notNullable();
    t.text("specification").notNullable().defaultTo("");
    t.decimal("quantity", 16, 3).notNullable();
    t.string("unit", 30).notNullable();
    t.bigInteger("unit_price_minor").notNullable();
    t.integer("tax_bps").notNullable();
    t.integer("discount_bps").notNullable();
    t.integer("position").notNullable();
  });
  await k.schema.createTable("record_versions", (t) => {
    id(t);
    t.string("record_id", 64)
      .notNullable()
      .references("id")
      .inTable("records")
      .onDelete("CASCADE");
    t.integer("version").notNullable();
    t.text("snapshot").notNullable();
    t.string("created_by", 64).notNullable().references("id").inTable("users");
    t.string("note", 2000).notNullable();
    t.string("created_at", 30).notNullable();
    t.unique(["record_id", "version"]);
  });
  await k.schema.createTable("comments", (t) => {
    id(t);
    t.string("record_id", 64)
      .notNullable()
      .references("id")
      .inTable("records")
      .onDelete("CASCADE");
    t.string("user_id", 64).notNullable().references("id").inTable("users");
    t.text("body").notNullable();
    t.string("created_at", 30).notNullable();
  });
  await k.schema.createTable("documents", (t) => {
    id(t);
    t.string("organization_id", 64)
      .notNullable()
      .references("id")
      .inTable("organizations");
    t.string("record_id", 64).references("id").inTable("records");
    t.string("category", 50).notNullable();
    t.string("name").notNullable();
    t.string("storage_key", 100).notNullable().unique();
    t.string("mime_type", 100).notNullable();
    t.integer("size").notNullable();
    t.string("status", 30).notNullable();
    t.string("expires_at", 30);
    t.integer("version").notNullable().defaultTo(1);
    t.string("previous_id", 64).references("id").inTable("documents");
    t.string("uploaded_by", 64).notNullable().references("id").inTable("users");
    t.string("reviewed_by", 64).references("id").inTable("users");
    t.text("review_note").notNullable().defaultTo("");
    timestamps(t);
    t.index(["organization_id", "status"]);
  });
  await k.schema.createTable("notifications", (t) => {
    id(t);
    t.string("user_id", 64)
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    t.string("title").notNullable();
    t.text("body").notNullable();
    t.string("href").notNullable();
    t.string("category", 50).notNullable();
    t.string("dedupe_key");
    t.string("read_at", 30);
    t.string("created_at", 30).notNullable();
    t.unique(["user_id", "dedupe_key"]);
    t.index(["user_id", "read_at"]);
  });
  await k.schema.createTable("email_outbox", (t) => {
    id(t);
    t.string("user_id", 64).references("id").inTable("users");
    t.string("to_address").notNullable();
    t.string("subject").notNullable();
    t.text("body").notNullable();
    t.string("status", 30).notNullable().defaultTo("queued");
    t.integer("attempts").notNullable().defaultTo(0);
    t.string("next_attempt", 30).notNullable();
    t.string("sent_at", 30);
    t.text("last_error");
    t.string("created_at", 30).notNullable();
  });
  await k.schema.createTable("audit_logs", (t) => {
    id(t);
    t.string("user_id", 64).references("id").inTable("users");
    t.string("organization_id", 64).references("id").inTable("organizations");
    t.string("actor_name").notNullable();
    t.string("role", 50).notNullable();
    t.string("action", 80).notNullable();
    t.string("module", 50).notNullable();
    t.string("record_id", 64);
    t.string("record_number");
    t.string("previous_status", 50);
    t.string("new_status", 50);
    t.text("remarks").notNullable().defaultTo("");
    t.string("created_at", 30).notNullable().index();
  });
  await k.schema.createTable("settings", (t) => {
    t.string("key", 100).primary();
    t.text("value").notNullable();
    t.string("updated_at", 30).notNullable();
  });
  for (const [key, permissions] of Object.entries(defaultPermissions))
    await k("roles").insert({
      id: key,
      name: roleLabels[key],
      internal: !key.startsWith("org_"),
      permissions: JSON.stringify(permissions),
    });
  await k("settings").insert({
    key: "platform",
    value: JSON.stringify({
      name: "VS PartnerHub",
      documentExpiryDays: [90, 60, 30],
      requiredDocuments: ["PAN", "Incorporation"],
      candidateRetentionDays: 365,
      auditRetentionDays: 2555,
      emailEnabled: true,
      approvalThreshold: 500000,
      categories: [
        "Information Technology",
        "Office & Infrastructure",
        "Professional Services",
        "Human Resources",
        "Marketing & Creative",
        "Logistics & Supply Chain",
        "Manufacturing",
        "Healthcare",
        "Financial Services",
        "Other",
      ],
    }),
    updated_at: now(),
  });
}
async function commercialConstraints(k: Knex) {
  await k.schema.alterTable("records", (t) => {
    t.string("external_key", 600).unique();
    t.string("relationship_key", 200).unique();
  });
  await k.schema.alterTable("documents", (t) => {
    t.unique(["previous_id"]);
  });
  const records = await k("records").whereIn("kind", [
    "quotations",
    "orders",
    "invoices",
    "payments",
    "catalog",
  ]);
  for (const record of records) {
    const p = parseJson(record.payload);
    const keys = commercialKeys(
      record.kind,
      record.owner_org_id,
      record.partner_org_id,
      record.buyer_org_id,
      record.parent_id,
      p,
    );
    await k("records").where({ id: record.id }).update(keys);
  }
}
export function commercialKeys(
  kind: string,
  owner: string | null,
  partner: string | null,
  buyer: string | null,
  parent: string | null,
  payload: Record<string, any>,
) {
  const normalized = (value: unknown) =>
    String(value || "")
      .trim()
      .toLowerCase();
  return {
    external_key:
      kind === "invoices"
        ? `invoice:${partner}:${normalized(payload.invoice_number)}`
        : kind === "payments"
          ? `payment:${buyer}:${normalized(payload.transaction_id)}`
          : kind === "catalog"
            ? `sku:${owner}:${normalized(payload.sku)}`
            : null,
    relationship_key:
      kind === "quotations"
        ? `quote:${parent}:${partner}`
        : kind === "orders"
          ? `order:${parent}`
          : kind === "invoices"
            ? `invoice:${parent}`
            : null,
  };
}
export async function migrate() {
  await db.migrate.latest({
    migrationSource: {
      getMigrations: async () => [
        "001_foundation",
        "002_commercial_constraints",
        "003_enterprise_operations",
        "004_complete_operations",
        "005_security_delivery_evidence",
        "006_auth_sessions_and_attempts",
        "007_document_ai_review",
        "008_ai_efficiency",
        "009_cloud_runtime",
        "010_advanced_procurement",
      ],
      getMigrationName: (migration: string) => migration,
      getMigration: async (name: string) => ({
        up:
          name === "001_foundation"
            ? initialSchema
            : name === "002_commercial_constraints"
              ? commercialConstraints
              : name === "003_enterprise_operations"
                ? enterpriseSchema
                : name === "004_complete_operations"
                  ? operationsSchema
                  : name === "005_security_delivery_evidence"
                    ? securitySchema
                    : name === "006_auth_sessions_and_attempts"
                      ? authSchema
                      : name === "007_document_ai_review"
                        ? intelligenceSchema
                        : name === "008_ai_efficiency"
                          ? aiEfficiencySchema
                          : name === "009_cloud_runtime"
                            ? cloudSchema
                            : advancedProcurementSchema,
        down: async () => {
          throw new Error(
            "Destructive rollback is intentionally unsupported. Restore a verified backup.",
          );
        },
      }),
    },
  });
}
export async function nextNumber(k: Database, prefix: string) {
  const name = `${prefix}-${new Date().getUTCFullYear()}`;
  await k("sequences")
    .insert({ name, value: 1000 })
    .onConflict("name")
    .ignore();
  const [row] = await k("sequences")
    .where({ name })
    .increment("value", 1)
    .returning("value");
  return `${name}-${String(row.value).padStart(4, "0")}`;
}
export function parseJson<T = Record<string, any>>(
  input: unknown,
  fallback: T = {} as T,
): T {
  if (typeof input !== "string") return (input as T) || fallback;
  try {
    return JSON.parse(input);
  } catch {
    return fallback;
  }
}
