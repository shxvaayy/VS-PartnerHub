import { Router } from "express";
import { z } from "zod";
import { db, now } from "./db.js";
import { assert } from "./errors.js";
import { authenticated, assertActive, can, serializeOrg } from "./security.js";
import { publicOrganization } from "./organizations.js";
import { scopeRecords, serializeRecord } from "./record-service.js";
import { documentPolicies } from "./master-data.js";
import { date, uuid } from "./validation.js";
import { modules, type WorkRecord } from "../shared/domain.js";

export const partner360Router = Router();
partner360Router.use(authenticated);
partner360Router.get("/:id/360", async (req, res) => {
  const id = uuid.parse(req.params.id),
    raw = await db("organizations").where({ id }).first();
  assert(raw, 404, "Organization not found.");
  const own = id === req.user.organization_id;
  assert(
    own ||
      (req.user.internal && can(req.user, "organizations")) ||
      (can(req.user, "discovery") && raw.status === "active"),
    404,
    "Organization not found.",
  );
  if (!req.user.internal && !own) assertActive(req.user);
  const input = z
    .object({ from: date.optional(), to: date.optional() })
    .parse(req.query);
  assert(
    !input.from || !input.to || input.from <= input.to,
    422,
    "The start date must be before the end date.",
  );
  const allowed = modules.filter((module) => can(req.user, module));
  const q = scopeRecords(db("records"), req.user)
    .whereIn("records.kind", allowed)
    .where((b) =>
      b
        .where("records.owner_org_id", id)
        .orWhere("records.buyer_org_id", id)
        .orWhere("records.partner_org_id", id)
        .orWhereExists(
          db("record_invitations")
            .whereRaw("record_invitations.record_id = records.id")
            .where("record_invitations.organization_id", id),
        ),
    );
  if (input.from) q.where("records.created_at", ">=", input.from);
  if (input.to)
    q.where("records.created_at", "<=", input.to + "T23:59:59.999Z");
  const records: WorkRecord[] = (
    await q
      .select("records.*")
      .orderBy("records.updated_at", "desc")
      .limit(10001)
  ).map(serializeRecord);
  assert(
    records.length <= 10000,
    422,
    "Narrow the date range to view a relationship with more than 10,000 records.",
  );
  const invoices = records.filter(
    (record) =>
      record.kind === "invoices" &&
      !["draft", "rejected"].includes(record.status),
  );
  const paidByInvoice = new Map<string, number>();
  if (can(req.user, "payments") && invoices.length) {
    for (let offset = 0; offset < invoices.length; offset += 500) {
      const paid = await scopeRecords(
        db("records").where({
          "records.kind": "payments",
          "records.status": "completed",
        }),
        req.user,
      )
        .whereIn(
          "records.parent_id",
          invoices.slice(offset, offset + 500).map((invoice) => invoice.id),
        )
        .groupBy("records.parent_id")
        .select("records.parent_id")
        .sum({ amount: "records.amount_minor" });
      paid.forEach((row: any) =>
        paidByInvoice.set(row.parent_id, Number(row.amount)),
      );
    }
  }
  const today = now().slice(0, 10);
  const currencies = [
    ...new Set(
      records
        .filter((record) =>
          ["orders", "invoices", "payments", "contracts"].includes(record.kind),
        )
        .map((record) => record.currency),
    ),
  ].sort();
  const finances = currencies.map((currency) => {
    const ordered = records.filter(
      (record) =>
        record.kind === "orders" &&
        record.currency === currency &&
        ["approved", "sent", "acknowledged", "fulfilled", "closed"].includes(
          record.status,
        ),
    );
    const billed = invoices.filter((invoice) => invoice.currency === currency);
    const outstanding = (invoice: (typeof invoices)[number]) =>
      Math.max(0, invoice.amount_minor - (paidByInvoice.get(invoice.id) || 0));
    const overdue = billed.filter(
      (invoice) => invoice.payload.due_date < today && outstanding(invoice) > 0,
    );
    return {
      currency,
      order_minor: can(req.user, "orders")
        ? ordered.reduce((sum, order) => sum + order.amount_minor, 0)
        : null,
      invoice_minor: can(req.user, "invoices")
        ? billed.reduce((sum, invoice) => sum + invoice.amount_minor, 0)
        : null,
      paid_minor:
        can(req.user, "payments") && can(req.user, "invoices")
          ? billed.reduce(
              (sum, invoice) => sum + (paidByInvoice.get(invoice.id) || 0),
              0,
            )
          : null,
      outstanding_minor:
        can(req.user, "payments") && can(req.user, "invoices")
          ? billed.reduce((sum, invoice) => sum + outstanding(invoice), 0)
          : null,
      overdue_minor:
        can(req.user, "payments") && can(req.user, "invoices")
          ? overdue.reduce((sum, invoice) => sum + outstanding(invoice), 0)
          : null,
      overdue_count:
        can(req.user, "payments") && can(req.user, "invoices")
          ? overdue.length
          : null,
    };
  });
  const reviews = records.filter(
    (record) => record.kind === "performance" && record.status === "published",
  );
  const performance = can(req.user, "performance")
    ? {
        count: reviews.length,
        scores: Object.fromEntries(
          ["quality", "delivery", "communication", "value"].map((key) => [
            key,
            reviews.length
              ? Math.round(
                  (reviews.reduce(
                    (sum, record) => sum + Number(record.payload[key]),
                    0,
                  ) /
                    reviews.length) *
                    10,
                ) / 10
              : null,
          ]),
        ),
        recent: reviews.slice(0, 3).map((record) => ({
          id: record.id,
          number: record.number,
          title: record.title,
          date: record.payload.review_date,
          feedback: record.payload.feedback,
        })),
      }
    : null;
  const canDocuments =
    can(req.user, "documents") &&
    (own ||
      (req.user.internal &&
        (can(req.user, "verification") || can(req.user, "documents"))));
  let compliance: any = { private: true, organization_status: raw.status };
  if (canDocuments) {
    const rows = await db("documents")
      .where({ organization_id: id })
      .whereNull("record_id");
    const latest = rows.filter(
      (doc) => !rows.some((newer) => newer.previous_id === doc.id),
    );
    const policies = await documentPolicies(raw.type);
    const valid = (doc: any) =>
      doc.status === "approved" && (!doc.expires_at || doc.expires_at >= today);
    const remainingDays = (doc: any) =>
      doc.expires_at
        ? Math.ceil((Date.parse(doc.expires_at) - Date.parse(today)) / 86400000)
        : null;
    compliance = {
      private: false,
      organization_status: raw.status,
      total: latest.length,
      approved: latest.filter(valid).length,
      pending: latest.filter((doc) =>
        ["uploaded", "under_review"].includes(doc.status),
      ).length,
      rejected: latest.filter((doc) => doc.status === "rejected").length,
      expired: latest.filter(
        (doc) => remainingDays(doc) !== null && remainingDays(doc)! < 0,
      ).length,
      due30: latest.filter(
        (doc) =>
          remainingDays(doc) !== null &&
          remainingDays(doc)! >= 0 &&
          remainingDays(doc)! <= 30,
      ).length,
      due60: latest.filter(
        (doc) =>
          remainingDays(doc) !== null &&
          remainingDays(doc)! >= 0 &&
          remainingDays(doc)! <= 60,
      ).length,
      due90: latest.filter(
        (doc) =>
          remainingDays(doc) !== null &&
          remainingDays(doc)! >= 0 &&
          remainingDays(doc)! <= 90,
      ).length,
      missing: policies
        .filter(
          (policy) =>
            policy.required &&
            !latest.some(
              (doc) => doc.category === policy.category && valid(doc),
            ),
        )
        .map((policy) => policy.category),
      documents: latest
        .sort((a, b) =>
          String(a.expires_at || "9999").localeCompare(
            String(b.expires_at || "9999"),
          ),
        )
        .slice(0, 6)
        .map((doc) => ({
          id: doc.id,
          name: doc.name,
          category: doc.category,
          status: doc.status,
          expires_at: doc.expires_at,
        })),
    };
  }
  res.json({
    organization: publicOrganization(serializeOrg(raw)),
    own,
    scope: req.user.internal
      ? "Authorized platform activity"
      : own
        ? "Your organization's activity"
        : "Your shared business activity",
    filters: input,
    generated_at: now(),
    module_counts: Object.fromEntries(
      allowed.map((module) => [
        module,
        records.filter((record) => record.kind === module).length,
      ]),
    ),
    finances,
    performance,
    compliance,
    activity: records
      .filter((record) => record.kind !== "catalog")
      .slice(0, 30)
      .map((record) => ({
        id: record.id,
        kind: record.kind,
        number: record.number,
        title: record.title,
        status: record.status,
        amount_minor: record.amount_minor,
        currency: record.currency,
        updated_at: record.updated_at,
      })),
    alerts: {
      open_orders: records.filter(
        (record) =>
          record.kind === "orders" &&
          ["approved", "sent", "acknowledged"].includes(record.status),
      ).length,
      late_deliveries: records.filter(
        (record) =>
          record.kind === "deliveries" &&
          !["delivered", "confirmed"].includes(record.status) &&
          record.payload.expected_date < today,
      ).length,
      contracts_expiring: records.filter(
        (record) =>
          record.kind === "contracts" &&
          ["active", "renewed"].includes(record.status) &&
          record.payload.end_date >= today &&
          record.payload.end_date <=
            new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      ).length,
    },
  });
});
