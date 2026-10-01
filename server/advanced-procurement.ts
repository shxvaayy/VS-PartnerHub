import { Router } from "express";
import { z } from "zod";
import { db, now } from "./db.js";
import { assert } from "./errors.js";
import { authenticated, assertActive, can } from "./security.js";
import { uuid } from "./validation.js";
import {
  accessibleRecord,
  isBuyer,
  serializeRecord,
  snapshot,
} from "./record-service.js";
import {
  captureReceipt,
  invoiceMatch,
  receivingSummary,
  receiptSchema,
} from "./receiving.js";
import { evaluateProposal, proposalEvaluation } from "./proposals.js";

export const advancedProcurementRouter = Router();
advancedProcurementRouter.use(authenticated);
advancedProcurementRouter.get("/invoices/:id/matching", async (req, res) => {
  const invoice = await accessibleRecord(uuid.parse(req.params.id), req.user);
  assert(invoice.kind === "invoices", 404, "Invoice not found.");
  res.json(await invoiceMatch(invoice));
});
advancedProcurementRouter.get("/:kind/:id/receiving", async (req, res) => {
  const source = await accessibleRecord(uuid.parse(req.params.id), req.user);
  assert(
    source.kind === req.params.kind &&
      ["orders", "deliveries", "milestones"].includes(source.kind),
    404,
    "Receipt information not found.",
  );
  const orderRaw = await db("records")
    .where({
      id: source.kind === "orders" ? source.id : source.parent_id,
      kind: "orders",
    })
    .first();
  if (!orderRaw) {
    res.json({ applicable: false });
    return;
  }
  const order = serializeRecord(orderRaw);
  const summary = await receivingSummary(order.id);
  res.json({
    ...summary,
    applicable: true,
    can_record_evidence:
      source.kind === "orders" &&
      ["fulfilled", "closed"].includes(source.status) &&
      !summary.complete &&
      isBuyer(req.user, source) &&
      can(req.user, "orders", "review"),
    order: { id: order.id, number: order.number, currency: order.currency },
    can_receive:
      isBuyer(req.user, source) &&
      can(req.user, source.kind, "review") &&
      ((source.kind === "deliveries" && source.status === "delivered") ||
        (source.kind === "milestones" && source.status === "submitted")),
  });
});
advancedProcurementRouter.post("/orders/:id/receiving", async (req, res) => {
  assertActive(req.user);
  const id = uuid.parse(req.params.id);
  const input = z
    .object({
      version: z.number().int().positive(),
      receipt: receiptSchema,
      type: z.enum(["goods", "service"]),
      note: z.string().trim().min(10).max(2000),
    })
    .strict()
    .parse(req.body);
  const result = await db.transaction(async (k) => {
    let query = k("records").where({ id });
    if (db.client.config.client === "pg") query = query.forUpdate();
    await query.first();
    const order = await accessibleRecord(id, req.user, k);
    assert(
      order.kind === "orders" &&
        isBuyer(req.user, order) &&
        can(req.user, "orders", "review"),
      403,
      "Only an authorized buyer receiving reviewer can record historical acceptance evidence.",
    );
    assert(
      ["fulfilled", "closed"].includes(order.status),
      422,
      "Confirm open orders through their delivery or service milestone workflow.",
    );
    assert(
      order.version === input.version,
      409,
      "This purchase order changed. Refresh before recording evidence.",
    );
    assert(
      !(await receivingSummary(id, k)).complete,
      422,
      "This PO already has complete acceptance evidence.",
    );
    await snapshot(
      k,
      order,
      req.user,
      "Historical receipt evidence added: " + input.note,
    );
    const summary = await captureReceipt(
      k,
      req.user,
      order,
      order,
      input.receipt,
      input.note,
      input.type,
    );
    await k("records")
      .where({ id, version: order.version })
      .update({ version: order.version + 1, updated_at: now() });
    return summary;
  });
  res.status(201).json(result);
});
advancedProcurementRouter.get(
  "/quotations/:id/evaluation",
  async (req, res) => {
    const record = await accessibleRecord(uuid.parse(req.params.id), req.user);
    assert(
      record.kind === "quotations" && isBuyer(req.user, record),
      403,
      "Proposal evaluations are available to the buyer team.",
    );
    res.json(await proposalEvaluation(record));
  },
);
advancedProcurementRouter.post(
  "/quotations/:id/evaluation",
  async (req, res) => {
    res.json(
      await evaluateProposal(req.user, uuid.parse(req.params.id), req.body),
    );
  },
);
