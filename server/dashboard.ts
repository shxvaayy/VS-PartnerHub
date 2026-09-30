import { Router } from "express";
import { z } from "zod";
import { db, now, parseJson } from "./db.js";
import { INTERNAL_ORG_ID } from "./config.js";
import { assert } from "./errors.js";
import { authenticated, can } from "./security.js";
import {
  canCreate,
  getItems,
  scopeRecords,
  serializeRecord,
} from "./record-service.js";
import { modules, type Module } from "../shared/domain.js";
import { pagination, uuid } from "./validation.js";
import { csv } from "./records.js";
import { audit } from "./events.js";
export const dashboardRouter = Router();
dashboardRouter.use(authenticated);
dashboardRouter.get("/dashboard", async (req, res) => {
  const currency = z
    .enum(["INR", "USD", "EUR", "GBP"])
    .default("INR")
    .parse(req.query.currency);
  const days = z.coerce
    .number()
    .int()
    .min(7)
    .max(730)
    .default(180)
    .parse(req.query.days);
  const start = new Date(Date.now() - days * 86400000).toISOString();
  const allowed = modules.filter((m) => can(req.user, m));
  const records = scopeRecords(
    db("records").whereIn("kind", allowed),
    req.user,
  );
  const metrics = await records
    .clone()
    .select("kind", "status")
    .count({ count: "*" })
    .groupBy("kind", "status");
  const commercial = await records
    .clone()
    .where({ currency })
    .select("kind", "status")
    .sum({ total: "amount_minor" })
    .groupBy("kind", "status");
  const monthly = await records
    .clone()
    .where("created_at", ">=", start)
    .select(db.raw("substr(created_at, 1, 7) as month"), "kind")
    .count({ count: "*" })
    .groupByRaw("substr(created_at, 1, 7), kind")
    .orderBy("month");
  const recentRecords = await records
    .clone()
    .select("*")
    .orderBy("updated_at", "desc")
    .limit(7);
  let organizationStats: any[] = [],
    recentPartners: any[] = [],
    registrations: any[] = [];
  if (req.user.internal && can(req.user, "organizations")) {
    organizationStats = await db("organizations")
      .whereNot("id", INTERNAL_ORG_ID)
      .select("type", "status")
      .count({ count: "*" })
      .groupBy("type", "status");
    recentPartners = await db("organizations")
      .whereNot("id", INTERNAL_ORG_ID)
      .select(
        "id",
        "number",
        "legal_name",
        "type",
        "industry",
        "city",
        "status",
        "created_at",
      )
      .orderBy("created_at", "desc")
      .limit(5);
    registrations = await db("organizations")
      .whereNot("id", INTERNAL_ORG_ID)
      .where("created_at", ">=", start)
      .select(db.raw("substr(created_at, 1, 7) as month"))
      .count({ count: "*" })
      .groupByRaw("substr(created_at, 1, 7)")
      .orderBy("month");
  }
  const docs = db("documents")
    .whereNull("record_id")
    .whereNotExists(
      db("documents as next").whereRaw("next.previous_id = documents.id"),
    );
  if (!req.user.internal || !can(req.user, "documents"))
    docs.where({ organization_id: req.user.organization_id });
  const documentCounts = await docs
    .clone()
    .select("status")
    .count({ count: "*" })
    .groupBy("status");
  const expiringDocuments = await docs
    .clone()
    .whereNotNull("expires_at")
    .where(
      "expires_at",
      "<=",
      new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    )
    .select("id", "name", "category", "status", "expires_at", "organization_id")
    .orderBy("expires_at")
    .limit(5);
  const activitiesQuery = db("audit_logs").whereIn("module", [
    ...allowed,
    "organizations",
    "documents",
    "auth",
  ]);
  if (!req.user.internal || !can(req.user, "audit"))
    activitiesQuery.where("organization_id", req.user.organization_id);
  const activity = await activitiesQuery.orderBy("created_at", "desc").limit(6);
  res.json({
    currency,
    days,
    metrics: metrics.map((m: any) => ({ ...m, count: Number(m.count) })),
    commercial: commercial.map((m: any) => ({ ...m, total: Number(m.total) })),
    monthly: monthly.map((m: any) => ({ ...m, count: Number(m.count) })),
    organizationStats: organizationStats.map((m: any) => ({
      ...m,
      count: Number(m.count),
    })),
    recentPartners,
    registrations: registrations.map((m: any) => ({
      ...m,
      count: Number(m.count),
    })),
    recentRecords: recentRecords.map(serializeRecord),
    documentCounts: documentCounts.map((m: any) => ({
      ...m,
      count: Number(m.count),
    })),
    expiringDocuments,
    activity,
  });
});
dashboardRouter.get("/lookups", async (req, res) => {
  const kind = z.enum(modules).parse(req.query.kind);
  assert(
    canCreate(req.user, kind) || can(req.user, kind, "edit"),
    403,
    "Your role cannot create this record.",
  );
  const parentTypes: Partial<Record<Module, Module[]>> = {
    rfqs: ["requirements"],
    quotations: ["rfqs"],
    orders: ["quotations"],
    deliveries: ["orders"],
    contracts: ["orders"],
    invoices: ["orders", "contracts"],
    payments: ["invoices"],
    candidates: ["requirements"],
    interviews: ["candidates"],
    engagements: ["contracts"],
    timesheets: ["engagements"],
    milestones: ["orders", "contracts"],
    demos: ["catalog"],
    performance: ["orders", "contracts"],
  };
  const validStatuses: Partial<Record<Module, string[]>> = {
    rfqs: ["open"],
    quotations: ["published", "evaluation"],
    orders: ["approved"],
    deliveries: ["sent", "acknowledged"],
    contracts: ["approved", "sent", "acknowledged", "fulfilled", "closed"],
    invoices: ["fulfilled", "closed", "active", "renewed"],
    payments: ["approved"],
    candidates: ["open"],
    interviews: ["shortlisted", "interview"],
    engagements: ["active", "renewed"],
    timesheets: ["active"],
    milestones: ["approved", "sent", "acknowledged", "active", "renewed"],
    demos: ["active"],
    performance: ["fulfilled", "closed", "active", "renewed"],
  };
  const parents: any[] = [];
  if (parentTypes[kind]) {
    const q = db("records")
      .whereIn("kind", parentTypes[kind]!)
      .whereIn("status", validStatuses[kind] || []);
    if (kind === "demos" && can(req.user, "discovery"))
      q.where("payload", "like", '%"item_type":"Technology"%');
    else {
      scopeRecords(q, req.user);
      q.whereIn(
        "kind",
        parentTypes[kind]!.filter((m) => can(req.user, m)),
      );
    }
    const rows = await q.orderBy("created_at", "desc").limit(200);
    for (const row of rows) {
      const parsed = serializeRecord(row);
      if (
        (kind === "candidates" &&
          parsed.payload.requirement_type !== "hiring") ||
        (kind === "rfqs" && parsed.payload.requirement_type !== "procurement")
      )
        continue;
      parents.push({ ...parsed, items: await getItems(row.id) });
    }
  }
  const partners = await db("organizations")
    .where({ status: "active" })
    .select("id", "legal_name", "type", "city")
    .orderBy("legal_name")
    .limit(1000);
  const catalog =
    can(req.user, "catalog") || can(req.user, "discovery")
      ? (
          await (
            can(req.user, "discovery")
              ? db("records")
                  .where({ kind: "catalog", status: "active" })
                  .whereIn(
                    "owner_org_id",
                    db("organizations")
                      .where({ status: "active" })
                      .select("id"),
                  )
              : scopeRecords(
                  db("records").where({ kind: "catalog", status: "active" }),
                  req.user,
                )
          ).limit(100)
        ).map(serializeRecord)
      : [];
  res.json({ parents, partners, catalog });
});
dashboardRouter.get("/search", async (req, res) => {
  const q = z.string().trim().min(2).max(100).parse(req.query.q);
  const records = await scopeRecords(
    db("records")
      .whereIn(
        "kind",
        modules.filter((m) => can(req.user, m)),
      )
      .where((b) =>
        b.whereILike("title", `%${q}%`).orWhereILike("number", `%${q}%`),
      ),
    req.user,
  )
    .select("id", "number", "title", "kind", "status")
    .limit(8);
  const organizations =
    can(req.user, "organizations") || can(req.user, "discovery")
      ? await db("organizations")
          .whereILike("legal_name", `%${q}%`)
          .modify((b) => {
            if (!req.user.internal) b.where("status", "active");
          })
          .select("id", "legal_name", "type", "status")
          .limit(5)
      : [];
  res.json({ records, organizations });
});
dashboardRouter.get("/notifications", async (req, res) => {
  const p = pagination.parse(req.query),
    q = db("notifications").where({ user_id: req.user.id });
  if (p.status === "unread") q.whereNull("read_at");
  const total = await q.clone().count({ n: "*" }).first();
  const unread = await db("notifications")
    .where({ user_id: req.user.id, read_at: null })
    .count({ n: "*" })
    .first();
  res.json({
    items: await q
      .orderBy("created_at", "desc")
      .limit(p.limit)
      .offset((p.page - 1) * p.limit),
    total: Number(total?.n),
    unread: Number(unread?.n),
    page: p.page,
    limit: p.limit,
  });
});
dashboardRouter.post("/notifications/read-all", async (req, res) => {
  await db("notifications")
    .where({ user_id: req.user.id, read_at: null })
    .update({ read_at: now() });
  res.json({ ok: true });
});
dashboardRouter.post("/notifications/:id/read", async (req, res) => {
  await db("notifications")
    .where({ id: uuid.parse(req.params.id), user_id: req.user.id })
    .update({ read_at: now() });
  res.json({ ok: true });
});
dashboardRouter.get("/reports/export", async (req, res) => {
  assert(can(req.user, "reports"), 403, "Your role cannot export reports.");
  const p = pagination.parse(req.query),
    q = scopeRecords(
      db("records").whereIn(
        "kind",
        modules.filter((m) => can(req.user, m)),
      ),
      req.user,
    );
  if (p.from) q.where("created_at", ">=", p.from);
  if (p.to) q.where("created_at", "<=", `${p.to}T23:59:59.999Z`);
  const rows = await q
    .select("kind", "status", "currency")
    .count({ count: "*" })
    .sum({ total: "amount_minor" })
    .groupBy("kind", "status", "currency");
  await audit(db, req.user, "report_exported", "reports");
  res
    .type("text/csv")
    .attachment(`partnerhub-report-${now().slice(0, 10)}.csv`)
    .send(
      csv([
        ["Module", "Status", "Currency", "Count", "Total amount"],
        ...rows.map((r: any) => [
          r.kind,
          r.status,
          r.currency,
          r.count,
          Number(r.total) / 100,
        ]),
      ]),
    );
});
