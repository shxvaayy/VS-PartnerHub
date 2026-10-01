import { parse } from "csv-parse/sync";
import { createHash } from "node:crypto";
import { z } from "zod";
import { now, type Database } from "./db.js";
import { assert, HttpError } from "./errors.js";
import { date } from "./validation.js";
import { amountMinor } from "./money.js";

export const statementInput = z
  .object({
    csv: z.string().min(1).max(500000),
    file_name: z.string().trim().min(1).max(200),
  })
  .strict();
const rowSchema = z.object({
  date,
  transaction_id: z.string().trim().min(1).max(200),
  reference: z.string().trim().max(200).default(""),
  description: z.string().trim().max(1000).default(""),
  debit: z.string().trim().default(""),
  credit: z.string().trim().default(""),
  currency: z.string().trim().default(""),
});
type ParsedRow = {
  row: number;
  transaction_id: string;
  posted_date: string;
  reference: string;
  description: string;
  direction: "debit" | "credit";
  amount_minor: number;
  state: "new" | "duplicate" | "conflict";
};
const parseAmount = (value: string) => {
  if (!value) return 0;
  assert(
    /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value),
    422,
    "Use nonnegative decimal amounts without currency symbols or thousands separators.",
  );
  const n = Number(value);
  return n === 0 ? 0 : amountMinor(n);
};
export async function previewStatement(
  k: Database,
  account: any,
  input: z.infer<typeof statementInput>,
) {
  let raw: Record<string, string>[];
  try {
    raw = parse(input.csv, {
      bom: true,
      skip_empty_lines: true,
      trim: true,
      max_record_size: 10000,
      columns: (headers: string[]) => {
        const normalized = headers.map((header) => header.trim().toLowerCase());
        if (
          new Set(normalized).size !== normalized.length ||
          !["date", "transaction_id", "debit", "credit"].every((key) =>
            normalized.includes(key),
          )
        )
          throw new Error("Required CSV columns are missing or repeated.");
        return normalized;
      },
    });
  } catch {
    throw new HttpError(
      422,
      "The CSV could not be read. Use the template headers: date, transaction_id, reference, description, debit, credit, currency.",
    );
  }
  assert(
    raw.length > 0 && raw.length <= 1000,
    422,
    "Import between 1 and 1,000 statement rows at a time.",
  );
  const errors: { row: number; message: string }[] = [];
  const rows: ParsedRow[] = [];
  const seen = new Set<string>();
  raw.forEach((rawRow, index) => {
    try {
      const row = rowSchema.parse(rawRow);
      assert(
        row.date <= now().slice(0, 10),
        422,
        "Statement dates cannot be in the future.",
      );
      assert(
        !row.currency || row.currency === account.currency,
        422,
        "The statement currency must match the selected bank account.",
      );
      const debit = parseAmount(row.debit),
        credit = parseAmount(row.credit);
      assert(
        debit > 0 !== credit > 0,
        422,
        "Exactly one of debit or credit must contain a positive amount.",
      );
      assert(
        !seen.has(row.transaction_id),
        422,
        "This bank transaction ID is repeated in the file.",
      );
      seen.add(row.transaction_id);
      rows.push({
        row: index + 2,
        transaction_id: row.transaction_id,
        posted_date: row.date,
        reference: row.reference,
        description: row.description,
        direction: debit > 0 ? "debit" : "credit",
        amount_minor: debit || credit,
        state: "new",
      });
    } catch (error) {
      errors.push({
        row: index + 2,
        message:
          error instanceof z.ZodError
            ? error.issues
                .map((issue) => issue.path.join(".") + ": " + issue.message)
                .join("; ")
            : error instanceof Error
              ? error.message
              : "Invalid statement row.",
      });
    }
  });
  const existing = rows.length
    ? await k("bank_transactions")
        .where({ account_id: account.id })
        .whereIn(
          "transaction_id",
          rows.map((row) => row.transaction_id),
        )
    : [];
  for (const row of rows) {
    const prior = existing.find(
      (transaction) => transaction.transaction_id === row.transaction_id,
    );
    if (prior) {
      const same =
        prior.posted_date === row.posted_date &&
        prior.direction === row.direction &&
        Number(prior.amount_minor) === row.amount_minor &&
        prior.reference === row.reference &&
        prior.description === row.description;
      row.state = same ? "duplicate" : "conflict";
      if (!same)
        errors.push({
          row: row.row,
          message:
            "This transaction ID already exists with different details. Resolve it before importing.",
        });
    }
  }
  return {
    rows,
    errors,
    valid: errors.length === 0,
    new_rows: rows.filter((row) => row.state === "new").length,
    duplicate_rows: rows.filter((row) => row.state === "duplicate").length,
    digest: createHash("sha256").update(input.csv).digest("hex"),
  };
}
