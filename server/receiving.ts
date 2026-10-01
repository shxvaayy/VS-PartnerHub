import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, nextNumber, now, type Database } from "./db.js";
import { assert } from "./errors.js";
import { audit } from "./events.js";
import { date, uuid } from "./validation.js";
import { getItems, serializeRecord } from "./record-service.js";
import type { SessionUser, WorkRecord } from "../shared/domain.js";

const quantity = z
  .number()
  .finite()
  .min(0)
  .max(1000000)
  .refine(
    (n) => Math.round(n * 1000) / 1000 === n,
    "Use at most three decimal places for quantities.",
  );
export const receiptSchema = z
  .object({
    reference: z.string().trim().min(3).max(200),
    received_date: date,
    lines: z
      .array(
        z
          .object({
            order_item_id: uuid,
            accepted_quantity: quantity,
            rejected_quantity: quantity.default(0),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export type ReceiptInput = z.infer<typeof receiptSchema>;
const units = (n: number) => Math.round(n * 1000);

export async function receivingSummary(orderId: string, k: Database = db) {
  const items = await getItems(orderId, k);
  const received: any[] = await k("receipt_lines")
    .join("receipts", "receipt_lines.receipt_id", "receipts.id")
    .where("receipts.order_id", orderId)
    .groupBy("receipt_lines.order_item_id")
    .select("receipt_lines.order_item_id")
    .sum({ accepted: "accepted_quantity", rejected: "rejected_quantity" });
  const lines = items.map((item) => {
    const r = received.find((v) => v.order_item_id === item.id);
    const accepted = Number(r?.accepted || 0);
    return {
      ...item,
      accepted_quantity: accepted,
      rejected_quantity: Number(r?.rejected || 0),
      remaining_quantity:
        Math.max(0, units(item.quantity) - units(accepted)) / 1000,
    };
  });
  const receipts = await k("receipts")
    .join("users", "receipts.accepted_by", "users.id")
    .leftJoin("records", "receipts.source_record_id", "records.id")
    .where("receipts.order_id", orderId)
    .select(
      "receipts.*",
      "users.name as accepted_by_name",
      "records.number as source_number",
      "records.kind as source_kind",
    )
    .orderBy("receipts.created_at", "desc");
  return {
    lines,
    receipts,
    complete:
      lines.length > 0 && lines.every((line) => line.remaining_quantity === 0),
  };
}

// The caller holds the PO lock. Validation and the eventual insert run in the
// same transaction as the authorized delivery/service acceptance decision.
export async function validateReceipt(
  k: Database,
  order: WorkRecord,
  input?: ReceiptInput,
) {
  assert(
    input,
    422,
    "Record accepted and rejected quantities with a receipt reference before confirming receipt.",
  );
  const data = receiptSchema.parse(input);
  assert(
    data.received_date <= now().slice(0, 10),
    422,
    "A receipt date cannot be in the future.",
  );
  assert(
    data.received_date >= order.created_at.slice(0, 10),
    422,
    "A receipt cannot predate its purchase order.",
  );
  assert(
    new Set(data.lines.map((line) => line.order_item_id)).size ===
      data.lines.length,
    422,
    "A purchase order line can appear only once in a receipt.",
  );
  const summary = await receivingSummary(order.id, k);
  for (const line of data.lines) {
    const item = summary.lines.find((i) => i.id === line.order_item_id);
    assert(item, 422, "Every receipt line must belong to this purchase order.");
    assert(
      units(line.accepted_quantity) <= units(item.remaining_quantity),
      422,
      "Accepted quantities cannot exceed the unreceived purchase order balance.",
    );
  }
  assert(
    data.lines.some(
      (line) => line.accepted_quantity + line.rejected_quantity > 0,
    ),
    422,
    "Record at least one accepted or rejected quantity.",
  );
  return data;
}

export async function captureReceipt(
  k: Database,
  user: SessionUser,
  source: WorkRecord,
  order: WorkRecord,
  input: ReceiptInput,
  note: string,
  receiptType: "goods" | "service" = source.kind === "milestones"
    ? "service"
    : "goods",
) {
  const data = await validateReceipt(k, order, input);
  const id = randomUUID();
  const number = await nextNumber(k, receiptType === "service" ? "SRN" : "GRN");
  await k("receipts").insert({
    id,
    number,
    order_id: order.id,
    source_record_id: source.kind === "orders" ? null : source.id,
    type: receiptType,
    reference: data.reference,
    received_date: data.received_date,
    accepted_by: user.id,
    note,
    created_at: now(),
  });
  await k("receipt_lines").insert(
    data.lines
      .filter((line) => line.accepted_quantity + line.rejected_quantity > 0)
      .map((line) => ({
        id: randomUUID(),
        receipt_id: id,
        ...line,
      })),
  );
  await audit(
    k,
    user,
    "receipt_confirmed",
    source.kind,
    source,
    undefined,
    JSON.stringify({
      receipt: number,
      reference: data.reference,
      date: data.received_date,
      lines: data.lines,
      note,
    }),
  );
  return receivingSummary(order.id, k);
}

export async function invoiceMatch(invoice: WorkRecord, k: Database = db) {
  assert(
    invoice.kind === "invoices",
    422,
    "Select an invoice to run matching.",
  );
  const raw = await k("records").where({ id: invoice.parent_id }).first();
  assert(raw, 404, "The linked agreement is unavailable.");
  const order = serializeRecord(raw);
  if (order.kind !== "orders")
    return {
      status: "not_applicable" as const,
      reason:
        "This invoice is backed by a contract. Review its contractual terms and supporting evidence.",
      order: { id: order.id, number: order.number, kind: order.kind },
      lines: [],
      receipts: [],
      issues: [],
    };
  const summary = await receivingSummary(order.id, k);
  const items = await getItems(invoice.id, k);
  const issues: string[] = [];
  const lines = summary.lines.map((ordered) => {
    const billed = items.filter((item) => item.source_item_id === ordered.id);
    const actual = billed.length === 1 ? billed[0] : null;
    const lineIssues: string[] = [];
    if (!actual)
      lineIssues.push(
        billed.length
          ? "Duplicate invoice line mapping"
          : "Invoice line is not mapped",
      );
    if (ordered.remaining_quantity > 0)
      lineIssues.push("Accepted receipt quantity is incomplete");
    if (actual) {
      if (units(actual.quantity) !== units(ordered.quantity))
        lineIssues.push("Invoice quantity differs from PO");
      if (actual.unit !== ordered.unit)
        lineIssues.push("Unit of measure differs from PO");
      if (
        Math.round(actual.unit_price * 100) !==
        Math.round(ordered.unit_price * 100)
      )
        lineIssues.push("Unit price differs from PO");
      if (Math.round(actual.tax * 100) !== Math.round(ordered.tax * 100))
        lineIssues.push("Tax differs from PO");
      if (
        Math.round(actual.discount * 100) !== Math.round(ordered.discount * 100)
      )
        lineIssues.push("Discount differs from PO");
      if (units(actual.quantity) > units(ordered.accepted_quantity))
        lineIssues.push("Invoice quantity exceeds accepted receipts");
    }
    return {
      ordered,
      invoiced: actual,
      issues: lineIssues,
      matched: lineIssues.length === 0,
    };
  });
  if (!lines.length)
    issues.push("The purchase order has no line-item evidence.");
  if (
    items.some(
      (item) =>
        !summary.lines.some((ordered) => ordered.id === item.source_item_id),
    )
  )
    issues.push("One or more invoice lines are not linked to this PO.");
  if (invoice.currency !== order.currency)
    issues.push("Invoice currency differs from PO.");
  if (invoice.amount_minor !== order.amount_minor)
    issues.push("Invoice total differs from the agreed PO total.");
  if (
    Math.round(Number(invoice.payload.delivery_charges || 0) * 100) !==
    Math.round(Number(order.payload.delivery_charges || 0) * 100)
  )
    issues.push("Delivery charges differ from PO.");
  const matched =
    lines.length > 0 &&
    lines.every((line) => line.matched) &&
    issues.length === 0;
  return {
    status: matched
      ? ("matched" as const)
      : !summary.complete
        ? ("missing_receipt" as const)
        : ("exception" as const),
    reason: matched
      ? "PO, buyer-accepted receipts and independently entered invoice lines agree."
      : "Resolve every exception before invoice approval. Only buyer-confirmed quantities count as received.",
    order: {
      id: order.id,
      number: order.number,
      kind: order.kind,
      amount_minor: order.amount_minor,
      currency: order.currency,
    },
    invoice_total_minor: invoice.amount_minor,
    variance_minor: invoice.amount_minor - order.amount_minor,
    lines,
    receipts: summary.receipts,
    issues,
  };
}
