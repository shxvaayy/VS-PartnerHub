import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, now, parseJson } from "./db.js";
import { config } from "./config.js";
import { assert } from "./errors.js";
import {
  authenticated,
  assertActive,
  can,
  hashToken,
  permit,
  secret,
} from "./security.js";
import {
  audit,
  queueEmail,
  requireEmailDelivery,
  deliverEmails,
} from "./events.js";
import { emailConfiguration, emailConfigured } from "./integration-config.js";
import { email, pagination, uuid } from "./validation.js";
import {
  defaultPermissions,
  modules,
  documentCategories,
} from "../shared/domain.js";
import { csv } from "./records.js";
import { INTERNAL_ORG_ID } from "./config.js";
export const adminRouter = Router();
adminRouter.use(authenticated);
adminRouter.get(
  "/organizations-export",
  permit("organizations"),
  async (req, res) => {
    assert(
      req.user.internal,
      403,
      "Only an authorized internal team can export the directory.",
    );
    const p = pagination.parse(req.query),
      type = z.string().max(50).optional().parse(req.query.type),
      q = db("organizations").whereNot("id", INTERNAL_ORG_ID);
    if (p.q) q.whereILike("legal_name", `%${p.q}%`);
    if (p.status) q.where("status", p.status);
    if (type) q.where("type", type);
    const count = await q.clone().count({ n: "*" }).first();
    assert(
      Number(count?.n) <= 10000,
      422,
      "Narrow the filters to export 10,000 organizations or fewer.",
    );
    const rows = await q
      .select(
        "number",
        "legal_name",
        "type",
        "industry",
        "city",
        "country",
        "status",
        "created_at",
      )
      .orderBy("legal_name");
    await audit(
      db,
      req.user,
      "directory_exported",
      "organizations",
      undefined,
      undefined,
      `${rows.length} organizations`,
    );
    res
      .type("text/csv")
      .attachment("partnerhub-organizations.csv")
      .send(
        csv([
          [
            "Reference",
            "Organization",
            "Type",
            "Industry",
            "City",
            "Country",
            "Status",
            "Registered",
          ],
          ...rows.map((r) => [
            r.number,
            r.legal_name,
            r.type,
            r.industry,
            r.city,
            r.country,
            r.status,
            r.created_at,
          ]),
        ]),
      );
  },
);
adminRouter.get("/team", permit("team"), async (req, res) => {
  const q = db("users").select(
    "id",
    "organization_id",
    "name",
    "email",
    "role",
    "email_verified",
    "active",
    "created_at",
  );
  const invitations = db("invitations")
    .whereNull("accepted_at")
    .where("expires_at", ">", now())
    .select(
      "id",
      "name",
      "email",
      "role",
      "organization_id",
      "created_at",
      "expires_at",
    );
  if (!req.user.internal) {
    q.where({ organization_id: req.user.organization_id });
    invitations.where({ organization_id: req.user.organization_id });
  }
  const roles = await db("roles").modify((b) => {
    if (!req.user.internal) b.where({ internal: false });
  });
  res.json({
    users: await q.orderBy("created_at"),
    invitations: await invitations,
    roles: roles.map((r: any) => ({
      ...r,
      internal: Boolean(r.internal),
      permissions: parseJson(r.permissions),
    })),
  });
});
adminRouter.post("/team/invite", permit("team", "manage"), async (req, res) => {
  await requireEmailDelivery();
  assertActive(req.user);
  const data = z
    .object({
      name: z.string().trim().min(2).max(150),
      email,
      role: z.string().max(50),
      organization_id: uuid.nullable().optional(),
    })
    .parse(req.body);
  const role = await db("roles").where({ id: data.role }).first();
  assert(role, 422, "Choose a valid role.");
  const orgId = req.user.internal
    ? data.organization_id || null
    : req.user.organization_id;
  assert(
    req.user.internal || !role.internal,
    403,
    "You cannot invite an internal VS role.",
  );
  assert(
    role.internal ? orgId === null : orgId !== null,
    422,
    "External users must belong to an organization; internal users must use a VS role.",
  );
  if (orgId)
    assert(
      await db("organizations").where({ id: orgId }).first(),
      422,
      "Organization not found.",
    );
  assert(
    !(await db("users").where({ email: data.email }).first()),
    409,
    "This email is already registered.",
  );
  const token = secret(),
    invitationId = randomUUID(),
    expiresAt = new Date(Date.now() + 72 * 60 * 60000).toISOString();
  await db.transaction(async (k) => {
    assert(
      !(await k("invitations")
        .where({ email: data.email, accepted_at: null })
        .where("expires_at", ">", now())
        .first()),
      409,
      "This person already has a pending invitation.",
    );
    await k("invitations").insert({
      id: invitationId,
      organization_id: orgId,
      name: data.name,
      email: data.email,
      role: data.role,
      token_hash: hashToken(token),
      invited_by: req.user.id,
      expires_at: expiresAt,
      created_at: now(),
    });
    const emailId = await queueEmail(
      k,
      data.email,
      "You’re invited to VS PartnerHub",
      `${req.user.name} invited you to join VS PartnerHub.\n\nAccept your invitation: ${config.appUrl}/accept-invitation?token=${token}\n\nThis link expires in 72 hours.`,
      undefined,
      { expiresAt },
    );
    await k("invitations")
      .where({ id: invitationId })
      .update({ email_id: emailId });
    await audit(
      k,
      req.user,
      "user_invited",
      "team",
      undefined,
      undefined,
      `${data.email} · ${data.role}`,
    );
  });
  void deliverEmails().catch(() => {});
  res.status(201).json({
    ok: true,
    ...(config.demo
      ? { invitationUrl: `${config.appUrl}/accept-invitation?token=${token}` }
      : {}),
  });
});
adminRouter.patch("/team/:id", permit("team", "manage"), async (req, res) => {
  assertActive(req.user);
  const id = uuid.parse(req.params.id),
    data = z
      .object({
        role: z.string().max(50).optional(),
        active: z.boolean().optional(),
      })
      .refine((d) => d.role !== undefined || d.active !== undefined)
      .parse(req.body);
  assert(
    id !== req.user.id,
    422,
    "Ask another administrator to change your own role or account status.",
  );
  await db.transaction(async (k) => {
    const user = await k("users").where({ id }).first();
    assert(
      user &&
        (req.user.internal ||
          user.organization_id === req.user.organization_id),
      404,
      "User not found.",
    );
    if (data.role) {
      const role = await k("roles").where({ id: data.role }).first();
      assert(
        role && (user.organization_id ? !role.internal : role.internal),
        422,
        "Choose a role appropriate to this user’s organization.",
      );
      assert(
        req.user.internal || !role.internal,
        403,
        "Only a Super Admin can assign internal roles.",
      );
    }
    if (
      ["super_admin", "org_admin"].includes(user.role) &&
      (data.active === false || (data.role && data.role !== user.role))
    ) {
      const others = await k("users")
        .where({
          role: user.role,
          organization_id: user.organization_id,
          active: true,
        })
        .whereNot("id", id)
        .count({ n: "*" })
        .first();
      assert(
        Number(others?.n) > 0,
        422,
        "Keep at least one active administrator.",
      );
    }
    await k("users")
      .where({ id })
      .update({ ...data, updated_at: now() });
    await k("sessions").where({ user_id: id }).delete();
    await audit(
      k,
      req.user,
      "user_updated",
      "team",
      { id },
      undefined,
      data.role
        ? `Role changed to ${data.role}`
        : data.active
          ? "Account reactivated"
          : "Account deactivated",
    );
  });
  res.json({ ok: true });
});
adminRouter.delete(
  "/team/invitations/:id",
  permit("team", "manage"),
  async (req, res) => {
    const id = uuid.parse(req.params.id);
    const invitation = await db("invitations").where({ id }).first();
    assert(
      invitation &&
        (req.user.internal ||
          invitation.organization_id === req.user.organization_id),
      404,
      "Invitation not found.",
    );
    await db.transaction(async (k) => {
      await k("invitations").where({ id }).update({ expires_at: now() });
      if (invitation.email_id)
        await k("email_outbox")
          .where({ id: invitation.email_id })
          .whereIn("status", ["queued", "failed", "blocked", "local"])
          .update({ status: "expired", body: "[Revoked invitation]" });
      await audit(k, req.user, "invitation_revoked", "team", { id });
    });
    res.json({ ok: true });
  },
);
adminRouter.get("/roles", permit("roles"), async (_req, res) => {
  res.json(
    (await db("roles")).map((r: any) => ({
      ...r,
      internal: Boolean(r.internal),
      permissions: parseJson(r.permissions),
    })),
  );
});
adminRouter.patch("/roles/:id", permit("roles", "manage"), async (req, res) => {
  assert(
    req.user.role === "super_admin" && req.params.id !== "super_admin",
    403,
    "The Super Admin role is fixed and only a Super Admin can manage other roles.",
  );
  const permissions = z
    .record(
      z.string(),
      z.array(z.enum(["view", "create", "edit", "review", "manage"])).max(5),
    )
    .parse(req.body.permissions);
  const validModules = new Set([
    ...modules,
    "dashboard",
    "profile",
    "documents",
    "notifications",
    "settings",
    "organizations",
    "verification",
    "team",
    "roles",
    "reports",
    "audit",
    "discovery",
    "ai",
    "contacts",
    "integrations",
    "approvals",
    "master-data",
    "resources",
  ]);
  const role = await db("roles").where({ id: req.params.id }).first();
  assert(role, 404, "Role not found.");
  for (const [module, actions] of Object.entries(permissions)) {
    assert(validModules.has(module as any), 422, "Unknown permission module.");
    if (!role.internal)
      assert(
        actions.every((action) =>
          defaultPermissions.org_admin[module]?.includes(action),
        ),
        422,
        "External roles cannot receive internal administration permissions.",
      );
  }
  await db.transaction(async (k) => {
    await k("roles")
      .where({ id: role.id })
      .update({ permissions: JSON.stringify(permissions) });
    await audit(
      k,
      req.user,
      "permissions_updated",
      "roles",
      { id: role.id },
      undefined,
      role.name,
    );
  });
  res.json({ ok: true });
});
adminRouter.get("/settings", async (req, res) => {
  const settings = parseJson(
    (await db("settings").where({ key: "platform" }).first())?.value,
  );
  if (req.user.role === "super_admin")
    res.json({
      ...settings,
      emailConfigured: emailConfigured(await emailConfiguration()),
      database: config.databaseUrl ? "PostgreSQL" : "SQLite",
      demo: config.demo,
    });
  else
    res.json({
      name: settings.name,
      requiredDocuments: settings.requiredDocuments,
      categories: settings.categories,
      documentExpiryDays: settings.documentExpiryDays,
    });
});
adminRouter.patch("/settings", async (req, res) => {
  assert(
    req.user.role === "super_admin",
    403,
    "Only a Super Admin can change platform settings.",
  );
  const data = z
    .object({
      name: z.string().trim().min(2).max(100),
      documentExpiryDays: z
        .array(z.number().int().min(1).max(365))
        .min(1)
        .max(6),
      requiredDocuments: z
        .array(z.enum(documentCategories as [string, ...string[]]))
        .min(1)
        .max(10),
      candidateRetentionDays: z.number().int().min(30).max(1095),
      auditRetentionDays: z.number().int().min(365).max(3650),
      emailEnabled: z.boolean(),
      approvalThreshold: z.number().min(0).max(100000000),
      categories: z.array(z.string().trim().min(2).max(100)).min(1).max(100),
    })
    .strict()
    .parse(req.body);
  await db.transaction(async (k) => {
    await k("settings")
      .where({ key: "platform" })
      .update({ value: JSON.stringify(data), updated_at: now() });
    await audit(k, req.user, "settings_updated", "settings");
  });
  res.json(data);
});
adminRouter.get("/audit", permit("audit"), async (req, res) => {
  const p = pagination.parse(req.query),
    q = db("audit_logs");
  if (!req.user.internal)
    q.where({ organization_id: req.user.organization_id });
  if (p.q)
    q.where((b) =>
      b
        .whereILike("actor_name", `%${p.q}%`)
        .orWhereILike("action", `%${p.q}%`)
        .orWhereILike("record_number", `%${p.q}%`),
    );
  if (p.category) q.where("module", p.category);
  if (p.from) q.where("created_at", ">=", p.from);
  if (p.to) q.where("created_at", "<=", `${p.to}T23:59:59.999Z`);
  const count = await q.clone().count({ n: "*" }).first();
  res.json({
    items: await q
      .orderBy("created_at", "desc")
      .limit(p.limit)
      .offset((p.page - 1) * p.limit),
    total: Number(count?.n),
    page: p.page,
    limit: p.limit,
  });
});
adminRouter.get("/email-status", async (req, res) => {
  assert(
    req.user.role === "super_admin",
    403,
    "Only a Super Admin can access delivery status.",
  );
  res.json(
    await db("email_outbox")
      .select(
        "id",
        "to_address",
        "subject",
        "status",
        "attempts",
        "created_at",
        "sent_at",
        "last_error",
        "provider",
        "provider_reference",
        "delivered_at",
        "expires_at",
      )
      .orderBy("created_at", "desc")
      .limit(100),
  );
});
adminRouter.post("/email-status/:id/retry", async (req, res) => {
  assert(
    req.user.role === "super_admin",
    403,
    "Only a Super Admin can retry mail delivery.",
  );
  assert(
    emailConfigured(await emailConfiguration()),
    422,
    "Connect your email provider before retrying delivery.",
  );
  const id = uuid.parse(req.params.id);
  const changed = await db("email_outbox")
    .where({ id, status: "failed" })
    .where((q) => q.whereNull("expires_at").orWhere("expires_at", ">", now()))
    .update({
      status: "queued",
      attempts: 0,
      next_attempt: now(),
      last_error: null,
    });
  assert(changed, 422, "Only failed email can be retried.");
  await audit(db, req.user, "email_retry_requested", "notifications", { id });
  void deliverEmails(id).catch(() => {});
  res.json({ ok: true });
});
