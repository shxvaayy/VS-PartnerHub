import { Router, type RequestHandler } from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { db, now, parseJson } from "./db.js";
import {
  authenticated,
  assertActive,
  can,
  getUser,
  hashToken,
  permit,
} from "./security.js";
import { assert } from "./errors.js";
import { encryptSecret } from "./integration-config.js";
import { validateWebhookUrl } from "./webhooks.js";
import { audit } from "./events.js";
import { modules, type Permissions } from "../shared/domain.js";
import { pagination, uuid } from "./validation.js";
import {
  recordDetail,
  scopeRecords,
  serializeRecord,
} from "./record-service.js";

export const businessIntegrationsRouter = Router();
businessIntegrationsRouter.use(authenticated, permit("integrations"));
businessIntegrationsRouter.get("/business", async (req, res) => {
  const webhooks = await db("webhook_endpoints")
    .where({ organization_id: req.user.organization_id })
    .select("id", "name", "url", "active", "events", "created_at");
  const tokens = await db("integration_tokens")
    .where({ organization_id: req.user.organization_id, user_id: req.user.id })
    .select(
      "id",
      "name",
      "prefix",
      "scopes",
      "expires_at",
      "last_used_at",
      "active",
    );
  const deliveries = await db("webhook_deliveries as d")
    .join("webhook_endpoints as e", "d.endpoint_id", "e.id")
    .where("e.organization_id", req.user.organization_id)
    .select(
      "d.id",
      "d.status",
      "d.attempts",
      "d.http_status",
      "d.created_at",
      "e.name as endpoint_name",
    )
    .orderBy("d.created_at", "desc")
    .limit(100);
  res.json({
    webhooks: webhooks.map((w) => ({ ...w, events: parseJson(w.events, []) })),
    tokens: tokens.map((t) => ({ ...t, scopes: parseJson(t.scopes, []) })),
    deliveries,
  });
});
businessIntegrationsRouter.post(
  "/webhooks",
  permit("integrations", "manage"),
  async (req, res) => {
    assertActive(req.user);
    const data = z
      .object({
        name: z.string().trim().min(2).max(180),
        url: z.url().max(2000),
        events: z.array(z.enum(modules)).min(1).max(30),
      })
      .parse(req.body);
    assert(
      data.events.every((m) => can(req.user, m)),
      403,
      "Only permitted modules can be connected.",
    );
    await validateWebhookUrl(data.url);
    const id = randomUUID(),
      secret = randomBytes(32).toString("hex");
    await db("webhook_endpoints").insert({
      id,
      organization_id: req.user.organization_id,
      name: data.name,
      url: data.url,
      events: JSON.stringify(data.events),
      encrypted_secret: encryptSecret(secret),
      active: true,
      created_by: req.user.id,
      created_at: now(),
      updated_at: now(),
    });
    await audit(
      db,
      req.user,
      "webhook_created",
      "integrations",
      { id },
      undefined,
      data.name,
    );
    res.status(201).json({ id, secret });
  },
);
businessIntegrationsRouter.patch(
  "/webhooks/:id",
  permit("integrations", "manage"),
  async (req, res) => {
    const { active } = z.object({ active: z.boolean() }).parse(req.body),
      id = uuid.parse(req.params.id);
    const changed = await db("webhook_endpoints")
      .where({ id, organization_id: req.user.organization_id })
      .update({ active, updated_at: now() });
    assert(changed, 404, "Connection not found.");
    await audit(
      db,
      req.user,
      active ? "webhook_enabled" : "webhook_disabled",
      "integrations",
      { id },
    );
    res.json({ ok: true });
  },
);
businessIntegrationsRouter.post(
  "/deliveries/:id/retry",
  permit("integrations", "manage"),
  async (req, res) => {
    const id = uuid.parse(req.params.id),
      row = await db("webhook_deliveries as d")
        .join("webhook_endpoints as e", "d.endpoint_id", "e.id")
        .where("d.id", id)
        .where("e.organization_id", req.user.organization_id)
        .where("e.active", true)
        .where("d.status", "failed")
        .first();
    assert(row, 404, "Failed delivery not found.");
    await db("webhook_deliveries")
      .where({ id, status: "failed" })
      .update({ status: "queued", attempts: 0, next_attempt: now() });
    await audit(db, req.user, "webhook_retry_requested", "integrations", {
      id,
    });
    res.json({ ok: true });
  },
);
businessIntegrationsRouter.post(
  "/tokens",
  permit("integrations", "manage"),
  async (req, res) => {
    assertActive(req.user);
    const data = z
      .object({
        name: z.string().trim().min(2).max(180),
        scopes: z.array(z.enum(modules)).min(1).max(30),
        expiresInDays: z.number().int().min(1).max(365).default(90),
      })
      .parse(req.body);
    assert(
      data.scopes.every((m) => can(req.user, m)),
      403,
      "A token cannot grant access beyond your current role.",
    );
    const token = `phk_${randomBytes(32).toString("hex")}`,
      id = randomUUID();
    await db("integration_tokens").insert({
      id,
      organization_id: req.user.organization_id,
      user_id: req.user.id,
      name: data.name,
      token_hash: hashToken(token),
      prefix: token.slice(0, 12),
      scopes: JSON.stringify(data.scopes),
      expires_at: new Date(
        Date.now() + data.expiresInDays * 86400000,
      ).toISOString(),
      created_at: now(),
    });
    await audit(
      db,
      req.user,
      "integration_token_created",
      "integrations",
      { id },
      undefined,
      data.name,
    );
    res.status(201).json({ id, token });
  },
);
businessIntegrationsRouter.delete(
  "/tokens/:id",
  permit("integrations", "manage"),
  async (req, res) => {
    const id = uuid.parse(req.params.id);
    const changed = await db("integration_tokens")
      .where({
        id,
        user_id: req.user.id,
        organization_id: req.user.organization_id,
      })
      .update({ active: false });
    assert(changed, 404, "Token not found.");
    await audit(db, req.user, "integration_token_revoked", "integrations", {
      id,
    });
    res.json({ ok: true });
  },
);
export const integrationApiRouter = Router();
const tokenAuth: RequestHandler = async (req, _res, next) => {
  try {
    const token = req
      .get("authorization")
      ?.match(/^Bearer (phk_[a-f0-9]{64})$/)?.[1];
    assert(token, 401, "A valid integration Bearer token is required.");
    const entry = await db("integration_tokens")
      .where({ token_hash: hashToken(token), active: true })
      .where("expires_at", ">", now())
      .first();
    assert(
      entry,
      401,
      "This integration token is invalid, expired or revoked.",
    );
    const user = await getUser(entry.user_id);
    assert(
      user &&
        user.organization_id === entry.organization_id &&
        can(user, "integrations", "manage"),
      401,
      "This integration account is no longer active or authorized.",
    );
    assertActive(user);
    const permissions: Permissions = {};
    for (const scope of parseJson<string[]>(entry.scopes, []))
      if (can(user, scope)) permissions[scope] = ["view"];
    req.user = { ...user, permissions };
    await db("integration_tokens")
      .where({ id: entry.id })
      .update({ last_used_at: now() });
    next();
  } catch (e) {
    next(e);
  }
};
integrationApiRouter.use(tokenAuth);
integrationApiRouter.get("/records/:kind", async (req, res) => {
  const kind = z.enum(modules).parse(req.params.kind);
  assert(
    can(req.user, kind),
    403,
    "This token cannot read the requested module.",
  );
  const p = pagination.parse(req.query),
    q = scopeRecords(db("records").where({ kind }), req.user);
  if (p.status) q.where({ status: p.status });
  if (p.q) q.whereILike("title", `%${p.q}%`);
  const count = await q.clone().count({ n: "*" }).first();
  const rows = await q
    .orderBy("created_at", "desc")
    .limit(p.limit)
    .offset((p.page - 1) * p.limit);
  res.json({
    items: rows.map(serializeRecord),
    total: Number(count?.n),
    page: p.page,
    limit: p.limit,
  });
});
integrationApiRouter.get("/records/:kind/:id", async (req, res) => {
  const kind = z.enum(modules).parse(req.params.kind),
    record = await recordDetail(uuid.parse(req.params.id), req.user);
  assert(record.kind === kind, 404, "Record not found.");
  res.json(record);
});
