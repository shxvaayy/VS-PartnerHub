import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, now, parseJson } from "./db.js";
import { assert } from "./errors.js";
import { authenticated, can } from "./security.js";
import { modules, moduleDefinitions } from "../shared/domain.js";
import { pagination, recordSchema, uuid, date } from "./validation.js";
import {
  accessibleRecord,
  canCreate,
  recordDetail,
  saveRecord,
  scopeRecords,
  serializeRecord,
  isBuyer,
} from "./record-service.js";
import { amendContract, transitionRecord } from "./workflows.js";
import { audit, notifyOrganizations } from "./events.js";
export const recordsRouter = Router();
recordsRouter.use(authenticated);
export const csv = (rows: unknown[][]) =>
  "\uFEFF" +
  rows
    .map((row) =>
      row
        .map((v) => {
          let value = String(v ?? "");
          if (/^[\s]*[=+@\-\t\r]/.test(value)) value = `'${value}`;
          return `"${value.replaceAll('"', '""')}"`;
        })
        .join(","),
    )
    .join("\r\n");
recordsRouter.get("/:kind/export", async (req, res) => {
  const kind = z.enum(modules).parse(req.params.kind);
  assert(can(req.user, kind), 403, "Your role cannot access this module.");
  const p = pagination.parse(req.query),
    query = scopeRecords(db("records").where("records.kind", kind), req.user);
  if (p.status) query.where("records.status", p.status);
  if (p.currency) query.where("records.currency", p.currency);
  if (p.requirement_type && kind === "requirements")
    query.where(
      "records.payload",
      "like",
      `%"requirement_type":"${p.requirement_type}"%`,
    );
  if (p.q)
    query.where((b) =>
      b.whereILike("title", `%${p.q}%`).orWhereILike("number", `%${p.q}%`),
    );
  if (p.from) query.where("created_at", ">=", p.from);
  if (p.to) query.where("created_at", "<=", `${p.to}T23:59:59.999Z`);
  const count = await query.clone().count({ n: "*" }).first();
  assert(
    Number(count?.n) <= 10000,
    422,
    "Narrow the date range to export 10,000 records or fewer.",
  );
  const records = await query.orderBy("created_at", "desc");
  await audit(
    db,
    req.user,
    "records_exported",
    kind,
    undefined,
    undefined,
    `${records.length} records`,
  );
  res
    .type("text/csv")
    .attachment(`${kind}-${now().slice(0, 10)}.csv`)
    .send(
      csv([
        [
          "Reference",
          "Title",
          "Status",
          "Currency",
          "Amount",
          "Created",
          "Updated",
        ],
        ...records.map((r: any) => [
          r.number,
          r.title,
          r.status,
          r.currency,
          Number(r.amount_minor) / 100,
          r.created_at,
          r.updated_at,
        ]),
      ]),
    );
});
recordsRouter.get("/:kind", async (req, res) => {
  const kind = z.enum(modules).parse(req.params.kind);
  assert(can(req.user, kind), 403, "Your role cannot access this module.");
  const p = pagination.parse(req.query),
    parentId = req.query.parent_id ? uuid.parse(req.query.parent_id) : null;
  const q = scopeRecords(db("records").where("records.kind", kind), req.user);
  if (p.q)
    q.where((b) =>
      b
        .whereILike("records.title", `%${p.q}%`)
        .orWhereILike("records.number", `%${p.q}%`),
    );
  if (p.status) q.where("records.status", p.status);
  if (p.currency) q.where("records.currency", p.currency);
  if (p.requirement_type && kind === "requirements")
    q.where(
      "records.payload",
      "like",
      `%"requirement_type":"${p.requirement_type}"%`,
    );
  if (parentId) q.where("records.parent_id", parentId);
  if (p.from) q.where("records.created_at", ">=", p.from);
  if (p.to) q.where("records.created_at", "<=", `${p.to}T23:59:59.999Z`);
  if (p.category)
    q.where(
      "records.payload",
      "like",
      `%"category":${JSON.stringify(p.category)}%`,
    );
  const count = await q.clone().count({ count: "*" }).first();
  const items = await q
    .leftJoin("organizations as buyer", "records.buyer_org_id", "buyer.id")
    .leftJoin(
      "organizations as partner",
      "records.partner_org_id",
      "partner.id",
    )
    .select(
      "records.*",
      "buyer.legal_name as buyer_name",
      "partner.legal_name as partner_name",
    )
    .orderBy("records.updated_at", "desc")
    .limit(p.limit)
    .offset((p.page - 1) * p.limit);
  res.json({
    items: items.map(serializeRecord),
    total: Number(count?.count),
    page: p.page,
    limit: p.limit,
    can_create: canCreate(req.user, kind),
  });
});
recordsRouter.post("/:kind", async (req, res) => {
  const kind = z.enum(modules).parse(req.params.kind);
  res
    .status(201)
    .json(await saveRecord(req.user, kind, recordSchema.parse(req.body)));
});
recordsRouter.get("/:kind/:id", async (req, res) => {
  const kind = z.enum(modules).parse(req.params.kind),
    record = await recordDetail(uuid.parse(req.params.id), req.user);
  assert(record.kind === kind, 404, "Record not found.");
  res.json(record);
});
recordsRouter.patch("/:kind/:id", async (req, res) => {
  const kind = z.enum(modules).parse(req.params.kind);
  res.json(
    await saveRecord(
      req.user,
      kind,
      recordSchema.parse(req.body),
      uuid.parse(req.params.id),
    ),
  );
});
recordsRouter.post("/:kind/:id/transition", async (req, res) => {
  const input = z
    .object({
      status: z.string().max(50),
      version: z.number().int().positive(),
      note: z.string().trim().max(2000).default(""),
    })
    .parse(req.body);
  const id = uuid.parse(req.params.id);
  const record = await accessibleRecord(id, req.user);
  assert(record.kind === req.params.kind, 404, "Record not found.");
  res.json(
    await transitionRecord(
      req.user,
      id,
      input.status,
      input.version,
      input.note,
    ),
  );
});
recordsRouter.get("/:kind/:id/comments", async (req, res) => {
  const id = uuid.parse(req.params.id);
  await accessibleRecord(id, req.user);
  res.json(
    await db("comments")
      .join("users", "comments.user_id", "users.id")
      .where("comments.record_id", id)
      .select("comments.*", "users.name as author", "users.role as role")
      .orderBy("comments.created_at"),
  );
});
recordsRouter.post("/:kind/:id/comments", async (req, res) => {
  const id = uuid.parse(req.params.id),
    record = await accessibleRecord(id, req.user),
    data = z
      .object({ body: z.string().trim().min(1).max(5000) })
      .parse(req.body);
  assert(
    can(req.user, record.kind, "edit") ||
      can(req.user, record.kind, "review") ||
      (record.kind === "tickets" && can(req.user, "tickets", "create")),
    403,
    "Your role cannot post to this conversation.",
  );
  await db.transaction(async (k) => {
    await k("comments").insert({
      id: randomUUID(),
      record_id: id,
      user_id: req.user.id,
      body: data.body,
      created_at: now(),
    });
    await audit(k, req.user, "comment_added", record.kind, record);
    await notifyOrganizations(
      k,
      [record.buyer_org_id, record.partner_org_id, record.owner_org_id],
      `New message on ${record.number}`,
      `${req.user.name} added a message.`,
      `/app/${record.kind}/${id}`,
      record.kind,
      record.kind === "tickets" ? ["support"] : [],
    );
  });
  res.status(201).json({ ok: true });
});
recordsRouter.get("/:kind/:id/history", async (req, res) => {
  const id = uuid.parse(req.params.id);
  await accessibleRecord(id, req.user);
  res.json({
    events: await db("audit_logs")
      .where({ record_id: id })
      .orderBy("created_at", "desc"),
    versions: (
      await db("record_versions")
        .join("users", "record_versions.created_by", "users.id")
        .where("record_versions.record_id", id)
        .select(
          "record_versions.id",
          "record_versions.version",
          "record_versions.note",
          "record_versions.created_at",
          "users.name as author",
          "record_versions.snapshot",
        )
        .orderBy("version", "desc")
    ).map((v) => ({ ...v, snapshot: parseJson(v.snapshot) })),
  });
});
recordsRouter.get("/rfqs/:id/compare", async (req, res) => {
  const id = uuid.parse(req.params.id),
    rfq = await recordDetail(id, req.user);
  assert(
    rfq.kind === "rfqs" &&
      isBuyer(req.user, rfq) &&
      can(req.user, "quotations"),
    403,
    "Only authorized buyers can compare quotations.",
  );
  const records = await scopeRecords(
    db("records")
      .where({ kind: "quotations", parent_id: id })
      .whereNot("status", "draft"),
    req.user,
  ).select("id");
  const quotations = await Promise.all(
    records.map((r: any) => recordDetail(r.id, req.user)),
  );
  res.json({ rfq, quotations });
});
recordsRouter.post("/contracts/:id/renew", async (req, res) => {
  const data = z
    .object({
      end_date: date,
      note: z.string().trim().min(5).max(2000),
      version: z.number().int().positive(),
    })
    .parse(req.body);
  res.json(
    await amendContract(
      req.user,
      uuid.parse(req.params.id),
      data.end_date,
      data.note,
      data.version,
    ),
  );
});
