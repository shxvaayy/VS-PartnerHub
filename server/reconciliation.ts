import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, now, parseJson, type Database } from "./db.js";
import { INTERNAL_ORG_ID } from "./config.js";
import { assert } from "./errors.js";
import { authenticated, assertActive, can } from "./security.js";
import { audit } from "./events.js";
import { amountMinor } from "./money.js";
import { uuid, date } from "./validation.js";
import { accessibleRecord } from "./record-service.js";
import { csv } from "./records.js";
import { previewStatement, statementInput } from "./statement-import.js";
import type { SessionUser } from "../shared/domain.js";

export const reconciliationRouter = Router();
reconciliationRouter.use(authenticated);
const canManage = (user: SessionUser) => can(user, "payments", "review");
function access(user: SessionUser, write = false) {
  assert(
    can(user, "payments") &&
      (user.internal || user.organization?.type === "client"),
    403,
    "Bank reconciliation is available to authorized buyer finance teams.",
  );
  if (write) {
    assertActive(user);
    assert(
      canManage(user),
      403,
      "Your role cannot manage bank reconciliation.",
    );
  }
}
async function accountFor(
  user: SessionUser,
  id: string,
  k: Database = db,
  lock = false,
) {
  access(user);
  let q = k("bank_accounts").where({ id });
  if (!user.internal) q.where({ organization_id: user.organization_id });
  if (lock && db.client.config.client === "pg") q = q.forUpdate();
  const account = await q.first();
  assert(account, 404, "Bank account not found.");
  return account;
}
const activeAmounts = (k: Database, key: string) =>
  k("reconciliation_allocations")
    .whereNull("reversed_at")
    .groupBy(key)
    .select(key)
    .sum({ matched_minor: "amount_minor" });
function transactionQuery(accountId: string, k: Database = db) {
  return k("bank_transactions as bt")
    .leftJoin(
      activeAmounts(k, "bank_transaction_id").as("matched"),
      "matched.bank_transaction_id",
      "bt.id",
    )
    .where("bt.account_id", accountId);
}
const selectTransaction = (
  q: ReturnType<typeof transactionQuery>,
  k: Database = db,
) =>
  q.select(
    "bt.*",
    k.raw("coalesce(matched.matched_minor, 0) as matched_minor"),
  );
function serializeTransaction(row: any) {
  const amount = Number(row.amount_minor),
    matched = Number(row.matched_minor || 0);
  return {
    ...row,
    amount_minor: amount,
    matched_minor: matched,
    remaining_minor: amount - matched,
    status:
      row.disposition !== "open"
        ? "exception"
        : row.direction === "credit"
          ? "credit"
          : matched === amount
            ? "matched"
            : matched > 0
              ? "partial"
              : "unmatched",
  };
}
async function transactionFor(
  user: SessionUser,
  id: string,
  k: Database = db,
  lock = false,
) {
  access(user);
  const row = await k("bank_transactions").where({ id }).first();
  assert(row, 404, "Bank transaction not found.");
  const account = await accountFor(user, row.account_id, k);
  if (lock && db.client.config.client === "pg")
    await k("bank_transactions").where({ id }).forUpdate().first();
  const current = await selectTransaction(
    transactionQuery(account.id, k).where("bt.id", id),
    k,
  ).first();
  return { account, transaction: serializeTransaction(current) };
}
const filters = z.object({
  q: z.string().trim().max(150).default(""),
  from: date.optional(),
  to: date.optional(),
  status: z
    .enum(["all", "unmatched", "partial", "matched", "credit", "exception"])
    .default("all"),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
function filteredTransactions(
  accountId: string,
  input: z.infer<typeof filters>,
) {
  assert(
    !input.from || !input.to || input.from <= input.to,
    422,
    "The statement start date must be before its end date.",
  );
  const q = transactionQuery(accountId);
  if (input.from) q.where("bt.posted_date", ">=", input.from);
  if (input.to) q.where("bt.posted_date", "<=", input.to);
  if (input.q)
    q.where((b) =>
      b
        .whereILike("bt.reference", "%" + input.q + "%")
        .orWhereILike("bt.description", "%" + input.q + "%")
        .orWhereILike("bt.transaction_id", "%" + input.q + "%"),
    );
  if (input.status === "exception") q.whereNot("bt.disposition", "open");
  else if (input.status !== "all") {
    q.where("bt.disposition", "open");
    q.where("bt.direction", input.status === "credit" ? "credit" : "debit");
    if (input.status === "matched")
      q.whereRaw("coalesce(matched.matched_minor, 0) = bt.amount_minor");
    if (input.status === "unmatched")
      q.whereRaw("coalesce(matched.matched_minor, 0) = 0");
    if (input.status === "partial")
      q.whereRaw(
        "coalesce(matched.matched_minor, 0) > 0 and matched.matched_minor < bt.amount_minor",
      );
  }
  return q;
}

reconciliationRouter.get("/accounts", async (req, res) => {
  access(req.user);
  const q = db("bank_accounts")
    .join("organizations", "bank_accounts.organization_id", "organizations.id")
    .select("bank_accounts.*", "organizations.legal_name as organization_name")
    .orderBy("bank_accounts.name");
  if (!req.user.internal)
    q.where("bank_accounts.organization_id", req.user.organization_id);
  const organizations = req.user.internal
    ? await db("organizations")
        .where({ status: "active" })
        .where((b) => b.where("type", "client").orWhere("id", INTERNAL_ORG_ID))
        .select("id", "legal_name")
        .orderBy("legal_name")
    : [
        {
          id: req.user.organization_id,
          legal_name: req.user.organization!.legal_name,
        },
      ];
  res.json({ items: await q, organizations, can_manage: canManage(req.user) });
});
reconciliationRouter.post("/accounts", async (req, res) => {
  access(req.user, true);
  const data = z
    .object({
      organization_id: uuid,
      name: z.string().trim().min(3).max(120),
      bank_name: z.string().trim().min(2).max(120),
      last4: z.string().regex(/^\d{4}$/),
      currency: z.enum(["INR", "USD", "EUR", "GBP"]),
    })
    .strict()
    .parse(req.body);
  assert(
    req.user.internal || req.user.organization_id === data.organization_id,
    403,
    "Create an account for your own organization.",
  );
  const org = await db("organizations")
    .where({ id: data.organization_id, status: "active" })
    .first();
  assert(
    org && (org.type === "client" || org.id === INTERNAL_ORG_ID),
    422,
    "Choose an active buyer organization.",
  );
  const account = {
    ...data,
    id: randomUUID(),
    created_by: req.user.id,
    created_at: now(),
  };
  await db.transaction(async (k) => {
    await k("bank_accounts").insert(account);
    await audit(
      k,
      req.user,
      "bank_account_added",
      "reconciliation",
      { id: account.id, number: account.name },
      undefined,
      "Currency: " + account.currency + "; account ending " + account.last4,
    );
  });
  res.status(201).json(account);
});
reconciliationRouter.get("/accounts/:id/transactions", async (req, res) => {
  const account = await accountFor(req.user, uuid.parse(req.params.id));
  const p = filters.parse(req.query),
    q = filteredTransactions(account.id, p);
  const count = await q.clone().count({ total: "bt.id" }).first();
  const items = await selectTransaction(q.clone())
    .orderBy("bt.posted_date", "desc")
    .orderBy("bt.id")
    .limit(p.limit)
    .offset((p.page - 1) * p.limit);
  const totals = await filteredTransactions(account.id, { ...p, status: "all" })
    .select(
      db.raw(
        "coalesce(sum(case when bt.direction = 'debit' then bt.amount_minor else 0 end), 0) as debit_minor",
      ),
      db.raw(
        "coalesce(sum(case when bt.direction = 'credit' then bt.amount_minor else 0 end), 0) as credit_minor",
      ),
      db.raw("coalesce(sum(matched.matched_minor), 0) as matched_minor"),
      db.raw(
        "coalesce(sum(case when bt.direction = 'debit' and bt.disposition = 'open' then bt.amount_minor - coalesce(matched.matched_minor, 0) else 0 end), 0) as unmatched_minor",
      ),
      db.raw(
        "coalesce(sum(case when bt.disposition <> 'open' then bt.amount_minor else 0 end), 0) as exception_minor",
      ),
      db.raw("count(bt.id) as transaction_count"),
    )
    .first();
  res.json({
    account,
    items: items.map(serializeTransaction),
    total: Number(count?.total || 0),
    page: p.page,
    limit: p.limit,
    summary: Object.fromEntries(
      Object.entries(totals || {}).map(([key, value]) => [key, Number(value)]),
    ),
    can_manage: canManage(req.user),
  });
});
reconciliationRouter.get("/accounts/:id/export", async (req, res) => {
  const account = await accountFor(req.user, uuid.parse(req.params.id));
  const q = filteredTransactions(account.id, filters.parse(req.query));
  const count = await q.clone().count({ total: "bt.id" }).first();
  assert(
    Number(count?.total || 0) <= 10000,
    422,
    "Narrow the dates to export 10,000 rows or fewer.",
  );
  const rows = (
    await selectTransaction(q).orderBy("bt.posted_date", "desc")
  ).map(serializeTransaction);
  await audit(
    db,
    req.user,
    "reconciliation_exported",
    "reconciliation",
    { id: account.id, number: account.name },
    undefined,
    String(rows.length) + " statement rows",
  );
  res
    .type("text/csv")
    .attachment("reconciliation-" + now().slice(0, 10) + ".csv")
    .send(
      csv([
        [
          "Date",
          "Transaction ID",
          "Reference",
          "Description",
          "Currency",
          "Direction",
          "Amount",
          "Matched",
          "Remaining",
          "Status",
          "Exception category",
          "Exception note",
        ],
        ...rows.map((row) => [
          row.posted_date,
          row.transaction_id,
          row.reference,
          row.description,
          account.currency,
          row.direction,
          row.amount_minor / 100,
          row.matched_minor / 100,
          row.remaining_minor / 100,
          row.status,
          row.disposition,
          row.exception_note,
        ]),
      ]),
    );
});
reconciliationRouter.post("/accounts/:id/import-preview", async (req, res) => {
  const account = await accountFor(req.user, uuid.parse(req.params.id));
  res.json(await previewStatement(db, account, statementInput.parse(req.body)));
});
reconciliationRouter.post("/accounts/:id/import", async (req, res) => {
  access(req.user, true);
  const input = statementInput.parse(req.body),
    id = uuid.parse(req.params.id);
  const result = await db.transaction(async (k) => {
    const account = await accountFor(req.user, id, k, true);
    const preview = await previewStatement(k, account, input);
    assert(
      preview.valid,
      422,
      "Resolve every CSV validation error before importing the statement.",
    );
    const prior = await k("statement_imports")
      .where({ account_id: id, digest: preview.digest })
      .first();
    if (prior) return { ...prior, repeated: true };
    const batch = {
      id: randomUUID(),
      account_id: id,
      file_name: input.file_name,
      digest: preview.digest,
      imported_rows: preview.new_rows,
      duplicate_rows: preview.duplicate_rows,
      imported_by: req.user.id,
      created_at: now(),
    };
    await k("statement_imports").insert(batch);
    // Small chunks also work with SQLite's variable and compound-query limits.
    const rows = preview.rows.filter((row) => row.state === "new");
    for (let offset = 0; offset < rows.length; offset += 50)
      await k("bank_transactions").insert(
        rows
          .slice(offset, offset + 50)
          .map(({ row: _row, state: _state, ...data }) => ({
            ...data,
            id: randomUUID(),
            account_id: id,
            import_id: batch.id,
            created_at: now(),
          })),
      );
    await audit(
      k,
      req.user,
      "statement_imported",
      "reconciliation",
      { id, number: account.name },
      undefined,
      JSON.stringify({
        import_id: batch.id,
        file_name: input.file_name,
        imported: batch.imported_rows,
        duplicates: batch.duplicate_rows,
      }),
    );
    return { ...batch, repeated: false };
  });
  res.status(201).json(result);
});

const sameReference = (a: unknown, b: unknown) =>
  Boolean(a && b) &&
  String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
async function transactionDetail(user: SessionUser, id: string, search = "") {
  const { account, transaction } = await transactionFor(user, id);
  const allocations = await db("reconciliation_allocations as allocation")
    .join("records as payment", "allocation.payment_id", "payment.id")
    .join("users as creator", "allocation.created_by", "creator.id")
    .leftJoin("users as reverser", "allocation.reversed_by", "reverser.id")
    .where("allocation.bank_transaction_id", id)
    .select(
      "allocation.*",
      "payment.number as payment_number",
      "payment.title as payment_title",
      "creator.name as created_by_name",
      "reverser.name as reversed_by_name",
    )
    .orderBy("allocation.created_at", "desc");
  const events = await db("audit_logs")
    .where({ record_id: id, module: "reconciliation" })
    .select(
      "id",
      "action",
      "actor_name",
      "created_at",
      "previous_status",
      "new_status",
      "remarks",
    )
    .orderBy("created_at", "desc")
    .limit(50);
  const q = db("records as payment")
    .leftJoin(
      activeAmounts(db, "payment_id").as("allocated"),
      "allocated.payment_id",
      "payment.id",
    )
    .leftJoin(
      "organizations as partner",
      "payment.partner_org_id",
      "partner.id",
    )
    .where({
      "payment.kind": "payments",
      "payment.status": "completed",
      "payment.buyer_org_id": account.organization_id,
      "payment.currency": account.currency,
    })
    .whereRaw("payment.amount_minor > coalesce(allocated.matched_minor, 0)");
  const referenceColumns =
    db.client.config.client === "pg"
      ? [
          "lower(coalesce(payment.payload::jsonb ->> 'reference', ''))",
          "lower(coalesce(payment.payload::jsonb ->> 'transaction_id', ''))",
        ]
      : [
          "lower(coalesce(json_extract(payment.payload, '$.reference'), ''))",
          "lower(coalesce(json_extract(payment.payload, '$.transaction_id'), ''))",
        ];
  if (search)
    q.where((b) => {
      b.whereILike("payment.number", "%" + search + "%")
        .orWhereILike("payment.title", "%" + search + "%")
        .orWhereILike("partner.legal_name", "%" + search + "%");
      for (const column of referenceColumns)
        b.orWhereRaw(column + " like ?", ["%" + search.toLowerCase() + "%"]);
    });
  const count = await q.clone().count({ total: "payment.id" }).first();
  // Rank exact references before limiting the candidate list, including older
  // payments. The query remains constrained to this buyer and currency.
  const references = [transaction.transaction_id, transaction.reference]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());
  q.orderByRaw(
    "case when " +
      referenceColumns
        .map(
          (column) =>
            column + " in (" + references.map(() => "?").join(",") + ")",
        )
        .join(" or ") +
      " then 0 else 1 end",
    referenceColumns.flatMap(() => references),
  );
  const candidates = await q
    .select(
      "payment.id",
      "payment.number",
      "payment.title",
      "payment.amount_minor",
      "payment.currency",
      "payment.payload",
      "partner.legal_name as partner_name",
      db.raw("coalesce(allocated.matched_minor, 0) as matched_minor"),
    )
    .orderBy("payment.created_at", "desc")
    .limit(100);
  const suggested = candidates
    .map(({ payload: raw, ...row }) => {
      const payload = parseJson(raw),
        remaining = Number(row.amount_minor) - Number(row.matched_minor);
      const reference = [payload.transaction_id, payload.reference].some(
        (value) =>
          sameReference(value, transaction.transaction_id) ||
          sameReference(value, transaction.reference),
      );
      const amount = remaining === transaction.remaining_minor;
      return {
        ...row,
        amount_minor: Number(row.amount_minor),
        matched_minor: Number(row.matched_minor),
        remaining_minor: remaining,
        payment_date: payload.payment_date,
        reference: payload.reference,
        transaction_id: payload.transaction_id,
        suggestion:
          reference && amount
            ? "Reference and amount match"
            : reference
              ? "Reference matches"
              : amount
                ? "Amount matches"
                : "Manual selection",
        rank: (reference ? 2 : 0) + (amount ? 1 : 0),
      };
    })
    .sort((a, b) => b.rank - a.rank);
  return {
    account,
    transaction,
    events: events.map(({ remarks, ...event }) => ({
      ...event,
      note: parseJson(remarks).note || remarks,
    })),
    allocations: allocations.map((row) => ({
      ...row,
      amount_minor: Number(row.amount_minor),
    })),
    candidates: suggested,
    candidate_total: Number(count?.total || 0),
    can_manage: canManage(user),
  };
}
reconciliationRouter.get("/transactions/:id", async (req, res) => {
  res.json(
    await transactionDetail(
      req.user,
      uuid.parse(req.params.id),
      z.string().trim().max(150).default("").parse(req.query.q),
    ),
  );
});
const monetaryAmount = z
  .number()
  .finite()
  .positive()
  .max(1e12)
  .refine(
    (n) => Math.abs(Math.round(n * 100) - n * 100) < 0.00001,
    "Use at most two decimal places.",
  );
const decision = {
  version: z.number().int().positive(),
  note: z.string().trim().min(5).max(2000),
};
reconciliationRouter.post("/transactions/:id/allocations", async (req, res) => {
  access(req.user, true);
  const id = uuid.parse(req.params.id);
  const input = z
    .object({
      ...decision,
      allocations: z
        .array(z.object({ payment_id: uuid, amount: monetaryAmount }).strict())
        .min(1)
        .max(50),
    })
    .strict()
    .parse(req.body);
  assert(
    new Set(input.allocations.map((item) => item.payment_id)).size ===
      input.allocations.length,
    422,
    "Select each payment only once in this match.",
  );
  await db.transaction(async (k) => {
    const { account, transaction } = await transactionFor(
      req.user,
      id,
      k,
      true,
    );
    assert(
      transaction.version === input.version,
      409,
      "This statement row has changed. Refresh before matching.",
    );
    assert(
      transaction.direction === "debit" && transaction.disposition === "open",
      422,
      "Only open bank debits can be matched to outgoing payments.",
    );
    const total = input.allocations.reduce(
      (sum, item) => sum + amountMinor(item.amount),
      0,
    );
    assert(
      total <= transaction.remaining_minor,
      422,
      "The allocation exceeds the unmatched bank debit.",
    );
    // Always lock payment rows in a stable order, across all bank accounts.
    // This serializes concurrent attempts to reconcile the same payment.
    for (const item of [...input.allocations].sort((a, b) =>
      a.payment_id.localeCompare(b.payment_id),
    )) {
      if (db.client.config.client === "pg")
        await k("records").where({ id: item.payment_id }).forUpdate().first();
      const payment = await accessibleRecord(item.payment_id, req.user, k);
      assert(
        payment.kind === "payments" &&
          payment.status === "completed" &&
          payment.buyer_org_id === account.organization_id &&
          payment.currency === account.currency,
        422,
        "Choose a completed payment from this bank account's buyer organization and currency.",
      );
      const used = await k("reconciliation_allocations")
        .where({ payment_id: payment.id })
        .whereNull("reversed_at")
        .sum({ total: "amount_minor" })
        .first();
      const amount = amountMinor(item.amount);
      assert(
        amount <= payment.amount_minor - Number(used?.total || 0),
        422,
        "This allocation exceeds the payment's unreconciled balance.",
      );
      await k("reconciliation_allocations").insert({
        id: randomUUID(),
        bank_transaction_id: id,
        payment_id: payment.id,
        amount_minor: amount,
        note: input.note,
        created_by: req.user.id,
        created_at: now(),
      });
    }
    await k("bank_transactions")
      .where({ id, version: input.version })
      .update({ version: input.version + 1 });
    await audit(
      k,
      req.user,
      "bank_payment_matched",
      "reconciliation",
      { id, number: transaction.transaction_id },
      undefined,
      JSON.stringify({
        account_id: account.id,
        allocations: input.allocations,
        note: input.note,
      }),
    );
  });
  res.json(await transactionDetail(req.user, id));
});
reconciliationRouter.post("/allocations/:id/reverse", async (req, res) => {
  access(req.user, true);
  const input = z.object(decision).strict().parse(req.body),
    id = uuid.parse(req.params.id);
  const transactionId = await db.transaction(async (k) => {
    const allocation = await k("reconciliation_allocations")
      .where({ id })
      .first();
    assert(allocation, 404, "Reconciliation entry not found.");
    const { transaction } = await transactionFor(
      req.user,
      allocation.bank_transaction_id,
      k,
      true,
    );
    assert(
      transaction.version === input.version,
      409,
      "This statement row has changed. Refresh before reversing a match.",
    );
    if (db.client.config.client === "pg")
      await k("records")
        .where({ id: allocation.payment_id })
        .forUpdate()
        .first();
    assert(
      !allocation.reversed_at,
      409,
      "This match has already been reversed.",
    );
    await k("reconciliation_allocations")
      .where({ id })
      .whereNull("reversed_at")
      .update({
        reversed_by: req.user.id,
        reversed_at: now(),
        reversal_reason: input.note,
      });
    await k("bank_transactions")
      .where({ id: transaction.id, version: input.version })
      .update({ version: input.version + 1 });
    await audit(
      k,
      req.user,
      "bank_match_reversed",
      "reconciliation",
      { id: transaction.id, number: transaction.transaction_id },
      undefined,
      JSON.stringify({
        allocation_id: id,
        payment_id: allocation.payment_id,
        amount_minor: Number(allocation.amount_minor),
        note: input.note,
      }),
    );
    return transaction.id;
  });
  res.json(await transactionDetail(req.user, transactionId));
});
reconciliationRouter.post("/transactions/:id/exception", async (req, res) => {
  access(req.user, true);
  const id = uuid.parse(req.params.id);
  const input = z
    .object({
      ...decision,
      category: z.enum([
        "open",
        "bank_fee",
        "refund",
        "internal_transfer",
        "other",
      ]),
    })
    .strict()
    .parse(req.body);
  await db.transaction(async (k) => {
    const { transaction } = await transactionFor(req.user, id, k, true);
    assert(
      transaction.version === input.version,
      409,
      "This statement row has changed. Refresh before continuing.",
    );
    assert(
      transaction.matched_minor === 0,
      422,
      "Reverse active payment matches before classifying this statement row as an exception.",
    );
    await k("bank_transactions")
      .where({ id, version: input.version })
      .update({
        disposition: input.category,
        exception_note: input.note,
        version: input.version + 1,
      });
    await audit(
      k,
      req.user,
      "bank_exception_reviewed",
      "reconciliation",
      {
        id,
        number: transaction.transaction_id,
        status: transaction.disposition,
      },
      input.category,
      input.note,
    );
  });
  res.json(await transactionDetail(req.user, id));
});
reconciliationRouter.get("/payments/:id", async (req, res) => {
  access(req.user);
  const payment = await accessibleRecord(uuid.parse(req.params.id), req.user);
  assert(
    payment.kind === "payments" &&
      (req.user.internal || payment.buyer_org_id === req.user.organization_id),
    404,
    "Payment reconciliation not found.",
  );
  const rows = await db("reconciliation_allocations as allocation")
    .join("bank_transactions as bt", "allocation.bank_transaction_id", "bt.id")
    .join("bank_accounts as account", "bt.account_id", "account.id")
    .where("allocation.payment_id", payment.id)
    .whereNull("allocation.reversed_at")
    .select(
      "allocation.id",
      "allocation.amount_minor",
      "allocation.created_at",
      "bt.id as transaction_id",
      "bt.posted_date",
      "bt.reference",
      "account.id as account_id",
      "account.name as account_name",
      "account.last4",
    );
  const matched = rows.reduce((sum, row) => sum + Number(row.amount_minor), 0);
  res.json({
    payment_id: payment.id,
    amount_minor: payment.amount_minor,
    matched_minor: matched,
    remaining_minor: payment.amount_minor - matched,
    currency: payment.currency,
    entries: rows.map((row) => ({
      ...row,
      amount_minor: Number(row.amount_minor),
    })),
  });
});
