import type { Knex } from "knex";

export async function advancedProcurementSchema(k: Knex) {
  await k.schema.alterTable("line_items", (t) => {
    // The referenced PO is immutable once it is sent. Keep invoice lines
    // independent while retaining an explicit link to the agreed order line.
    t.string("source_item_id", 64).references("id").inTable("line_items");
  });
  await k.schema.createTable("receipts", (t) => {
    t.string("id", 64).primary();
    t.string("number", 50).notNullable().unique();
    t.string("order_id", 64)
      .notNullable()
      .references("id")
      .inTable("records")
      .index();
    t.string("source_record_id", 64)
      .unique()
      .references("id")
      .inTable("records");
    t.string("type", 20).notNullable();
    t.string("reference", 200).notNullable();
    t.string("received_date", 10).notNullable();
    t.string("accepted_by", 64).notNullable().references("id").inTable("users");
    t.text("note").notNullable();
    t.string("created_at", 30).notNullable();
    t.unique(["order_id", "reference"]);
  });
  await k.schema.createTable("receipt_lines", (t) => {
    t.string("id", 64).primary();
    t.string("receipt_id", 64)
      .notNullable()
      .references("id")
      .inTable("receipts");
    t.string("order_item_id", 64)
      .notNullable()
      .references("id")
      .inTable("line_items");
    t.decimal("accepted_quantity", 15, 3).notNullable();
    t.decimal("rejected_quantity", 15, 3).notNullable();
    t.unique(["receipt_id", "order_item_id"]);
    t.index("order_item_id");
  });
  await k.schema.createTable("proposal_evaluations", (t) => {
    t.string("quotation_id", 64).primary().references("id").inTable("records");
    t.integer("technical_score").notNullable();
    t.integer("commercial_score").notNullable();
    t.text("notes").notNullable();
    t.string("response_digest", 64).notNullable();
    t.integer("quotation_version").notNullable();
    t.integer("version").notNullable();
    t.string("reviewed_by", 64).notNullable().references("id").inTable("users");
    t.string("updated_at", 30).notNullable();
  });
  await k.schema.createTable("bank_accounts", (t) => {
    t.string("id", 64).primary();
    t.string("organization_id", 64)
      .notNullable()
      .references("id")
      .inTable("organizations")
      .index();
    t.string("name", 120).notNullable();
    t.string("bank_name", 120).notNullable();
    t.string("last4", 4).notNullable();
    t.string("currency", 3).notNullable();
    t.string("created_by", 64).notNullable().references("id").inTable("users");
    t.string("created_at", 30).notNullable();
    t.unique(["organization_id", "name"]);
  });
  await k.schema.createTable("statement_imports", (t) => {
    t.string("id", 64).primary();
    t.string("account_id", 64)
      .notNullable()
      .references("id")
      .inTable("bank_accounts");
    t.string("file_name", 200).notNullable();
    t.string("digest", 64).notNullable();
    t.integer("imported_rows").notNullable();
    t.integer("duplicate_rows").notNullable();
    t.string("imported_by", 64).notNullable().references("id").inTable("users");
    t.string("created_at", 30).notNullable();
    t.unique(["account_id", "digest"]);
  });
  await k.schema.createTable("bank_transactions", (t) => {
    t.string("id", 64).primary();
    t.string("account_id", 64)
      .notNullable()
      .references("id")
      .inTable("bank_accounts")
      .index();
    t.string("import_id", 64)
      .notNullable()
      .references("id")
      .inTable("statement_imports");
    t.string("transaction_id", 200).notNullable();
    t.string("posted_date", 10).notNullable();
    t.string("reference", 200).notNullable();
    t.text("description").notNullable();
    t.string("direction", 10).notNullable();
    t.bigInteger("amount_minor").notNullable();
    t.string("disposition", 30).notNullable().defaultTo("open");
    t.text("exception_note").notNullable().defaultTo("");
    t.integer("version").notNullable().defaultTo(1);
    t.string("created_at", 30).notNullable();
    t.unique(["account_id", "transaction_id"]);
    t.index(["account_id", "posted_date"]);
  });
  await k.schema.createTable("reconciliation_allocations", (t) => {
    t.string("id", 64).primary();
    t.string("bank_transaction_id", 64)
      .notNullable()
      .references("id")
      .inTable("bank_transactions")
      .index();
    t.string("payment_id", 64)
      .notNullable()
      .references("id")
      .inTable("records")
      .index();
    t.bigInteger("amount_minor").notNullable();
    t.text("note").notNullable();
    t.string("created_by", 64).notNullable().references("id").inTable("users");
    t.string("created_at", 30).notNullable();
    t.string("reversed_by", 64).references("id").inTable("users");
    t.string("reversed_at", 30);
    t.text("reversal_reason");
  });
}
