import { Router } from "express";
import { randomUUID } from "node:crypto";
import multer from "multer";
import { z } from "zod";
import { db, now } from "./db.js";
import { assert } from "./errors.js";
import { authenticated, can, permit } from "./security.js";
import { audit } from "./events.js";
import { date, email, pagination, uuid } from "./validation.js";
import { phoneSchema } from "../shared/auth.js";
import type { SessionUser } from "../shared/domain.js";
import {
  deleteStoredFile,
  sendStoredFile,
  writeStoredFile,
} from "./storage.js";

export const partnerOperationsRouter = Router();
partnerOperationsRouter.use(
  [
    "/organizations/:id/contacts",
    "/organizations/:id/logo",
    "/organizations/:id/marketplace",
    "/resources",
  ],
  authenticated,
);
function contactAccess(user: SessionUser, id: string, edit = false) {
  assert(
    can(user, "contacts", edit ? "edit" : "view") &&
      (user.organization_id === id ||
        (user.internal &&
          (edit
            ? can(user, "verification", "edit") || user.role === "super_admin"
            : can(user, "organizations")))),
    403,
    "Your role cannot access these organization contacts.",
  );
}
const contactSchema = z
  .object({
    name: z.string().trim().min(2).max(180),
    email,
    phone: z
      .string()
      .trim()
      .pipe(z.union([phoneSchema, z.literal("")]))
      .default(""),
    role: z.string().trim().min(2).max(120),
    active: z.boolean().default(true),
    is_primary: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.is_primary && !data.phone)
      ctx.addIssue({
        code: "custom",
        path: ["phone"],
        message: "A phone number is required for the primary company contact.",
      });
  });
partnerOperationsRouter.get("/organizations/:id/contacts", async (req, res) => {
  const id = uuid.parse(req.params.id);
  contactAccess(req.user, id);
  res.json(
    (
      await db("organization_contacts")
        .where({ organization_id: id })
        .orderBy("is_primary", "desc")
        .orderBy("name")
    ).map((row) => ({
      ...row,
      active: Boolean(row.active),
      is_primary: Boolean(row.is_primary),
    })),
  );
});
partnerOperationsRouter.post(
  "/organizations/:id/contacts",
  async (req, res) => {
    const orgId = uuid.parse(req.params.id),
      input = contactSchema.parse(req.body);
    contactAccess(req.user, orgId, true);
    assert(
      input.active || !input.is_primary,
      422,
      "The primary contact must be active.",
    );
    const id = randomUUID();
    await db.transaction(async (k) => {
      let q = k("organizations").where({ id: orgId });
      if (db.client.config.client === "pg") q = q.forUpdate();
      assert(await q.first(), 404, "Organization not found.");
      if (input.is_primary)
        await k("organization_contacts")
          .where({ organization_id: orgId })
          .update({ is_primary: false });
      await k("organization_contacts").insert({
        ...input,
        id,
        organization_id: orgId,
        created_at: now(),
        updated_at: now(),
      });
      if (input.is_primary)
        await k("organizations").where({ id: orgId }).update({
          contact_name: input.name,
          contact_email: input.email,
          contact_phone: input.phone,
          updated_at: now(),
        });
      await audit(
        k,
        req.user,
        "contact_created",
        "contacts",
        { id },
        "active",
        input.role,
      );
    });
    res.status(201).json({ id });
  },
);
partnerOperationsRouter.patch(
  "/organizations/:id/contacts/:contact",
  async (req, res) => {
    const orgId = uuid.parse(req.params.id),
      id = uuid.parse(req.params.contact),
      input = contactSchema.parse(req.body);
    contactAccess(req.user, orgId, true);
    assert(
      input.active || !input.is_primary,
      422,
      "The primary contact must be active.",
    );
    await db.transaction(async (k) => {
      let q = k("organizations").where({ id: orgId });
      if (db.client.config.client === "pg") q = q.forUpdate();
      await q.first();
      const row = await k("organization_contacts")
        .where({ id, organization_id: orgId })
        .first();
      assert(row, 404, "Contact not found.");
      assert(
        !row.is_primary || input.is_primary,
        422,
        "Choose another primary contact before removing this designation.",
      );
      if (input.is_primary)
        await k("organization_contacts")
          .where({ organization_id: orgId })
          .update({ is_primary: false });
      await k("organization_contacts")
        .where({ id })
        .update({ ...input, updated_at: now() });
      if (input.is_primary)
        await k("organizations").where({ id: orgId }).update({
          contact_name: input.name,
          contact_email: input.email,
          contact_phone: input.phone,
          updated_at: now(),
        });
      await audit(
        k,
        req.user,
        "contact_updated",
        "contacts",
        { id },
        input.active ? "active" : "inactive",
        input.role,
      );
    });
    res.json({ ok: true });
  },
);
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 2 * 1024 * 1024, fields: 0 },
});
partnerOperationsRouter.post(
  "/organizations/:id/logo",
  logoUpload.single("file"),
  async (req, res) => {
    const id = uuid.parse(req.params.id);
    assert(
      (req.user.organization_id === id && can(req.user, "profile", "edit")) ||
        (req.user.internal && can(req.user, "verification", "edit")),
      403,
      "Your role cannot change this logo.",
    );
    const f = req.file;
    assert(f?.size, 422, "Choose a PNG or JPEG logo, up to 2 MB.");
    const png = f.buffer
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      jpg = f.buffer[0] === 255 && f.buffer[1] === 216 && f.buffer[2] === 255;
    assert(png || jpg, 422, "Choose a valid PNG or JPEG image.");
    const key = `logo-${randomUUID()}.${png ? "png" : "jpg"}`,
      org = await db("organizations").where({ id }).first();
    assert(org, 404, "Organization not found.");
    await writeStoredFile(key, f.buffer, png ? "image/png" : "image/jpeg");
    try {
      await db.transaction(async (k) => {
        await k("organizations")
          .where({ id })
          .update({
            logo_key: key,
            logo_mime: png ? "image/png" : "image/jpeg",
            updated_at: now(),
          });
        await audit(k, req.user, "logo_updated", "organizations", org);
      });
    } catch (error) {
      await deleteStoredFile(key).catch(() => {});
      throw error;
    }
    if (org.logo_key) await deleteStoredFile(org.logo_key).catch(() => {});
    res.json({ ok: true });
  },
);
partnerOperationsRouter.get("/organizations/:id/logo", async (req, res) => {
  const org = await db("organizations")
    .where({ id: uuid.parse(req.params.id) })
    .first();
  assert(
    org?.logo_key &&
      (org.id === req.user.organization_id ||
        (req.user.internal && can(req.user, "organizations")) ||
        (can(req.user, "discovery") &&
          org.status === "active" &&
          req.user.organization?.status === "active")),
    404,
    "Logo not found.",
  );
  res.set("Cache-Control", "private, no-store");
  await sendStoredFile(res, org.logo_key, org.logo_mime);
});
partnerOperationsRouter.patch(
  "/organizations/:id/marketplace",
  async (req, res) => {
    const id = uuid.parse(req.params.id),
      { visible } = z.object({ visible: z.boolean() }).parse(req.body);
    assert(
      req.user.organization_id === id && can(req.user, "profile", "edit"),
      403,
      "Only your organization administrator can choose public visibility.",
    );
    if (visible)
      assert(
        req.user.organization?.status === "active",
        422,
        "Your organization must be verified and active before joining the public directory.",
      );
    await db.transaction(async (k) => {
      await k("organizations")
        .where({ id })
        .update({ marketplace_visible: visible, updated_at: now() });
      await audit(
        k,
        req.user,
        visible ? "marketplace_published" : "marketplace_hidden",
        "organizations",
        { id },
      );
    });
    res.json({ ok: true });
  },
);
const resourceSchema = z.object({
  title: z.string().trim().min(3).max(180),
  skills: z.string().trim().min(2).max(3000),
  location: z.string().trim().min(2).max(180),
  experience: z.coerce.number().min(0).max(60),
  count: z.coerce.number().int().min(1).max(100000),
  available_from: date,
  status: z.enum(["available", "reserved", "deployed", "archived"]),
  rate: z.coerce.number().min(0).max(100000000),
  currency: z.enum(["INR", "USD", "EUR", "GBP"]),
  rate_unit: z.enum(["hour", "day", "month"]),
  notes: z.string().trim().max(3000).default(""),
  version: z.number().int().positive().optional(),
});
function resourceAccess(user: SessionUser) {
  assert(
    user.internal ||
      [
        "vendor",
        "staffing",
        "recruitment",
        "service_provider",
        "technology_partner",
      ].includes(user.organization?.type || ""),
    403,
    "Resource management is available to talent and service partners.",
  );
}
partnerOperationsRouter.get(
  "/resources",
  permit("resources"),
  async (req, res) => {
    resourceAccess(req.user);
    const p = pagination.parse(req.query),
      q = db("organization_resources").join(
        "organizations",
        "organizations.id",
        "organization_resources.organization_id",
      );
    if (!req.user.internal)
      q.where(
        "organization_resources.organization_id",
        req.user.organization_id,
      );
    if (p.q)
      q.where((b) =>
        b
          .whereILike("title", `%${p.q}%`)
          .orWhereILike("skills", `%${p.q}%`)
          .orWhereILike("location", `%${p.q}%`),
      );
    if (p.status) q.where("organization_resources.status", p.status);
    const count = await q.clone().count({ n: "*" }).first();
    const items = await q
      .select(
        "organization_resources.*",
        "organizations.legal_name as organization_name",
      )
      .orderBy("organization_resources.updated_at", "desc")
      .limit(p.limit)
      .offset((p.page - 1) * p.limit);
    res.json({
      items: items.map((row) => ({
        ...row,
        rate: Number(row.rate_minor) / 100,
        experience: Number(row.experience),
      })),
      total: Number(count?.n),
      page: p.page,
      limit: p.limit,
    });
  },
);
partnerOperationsRouter.post(
  "/resources",
  permit("resources", "create"),
  async (req, res) => {
    resourceAccess(req.user);
    const {
        rate,
        version: _version,
        ...input
      } = resourceSchema.parse(req.body),
      id = randomUUID();
    assert(
      req.user.organization_id,
      422,
      "An organization is required for this resource pool.",
    );
    await db.transaction(async (k) => {
      await k("organization_resources").insert({
        ...input,
        id,
        organization_id: req.user.organization_id,
        rate_minor: Math.round(rate * 100),
        created_at: now(),
        updated_at: now(),
      });
      await audit(
        k,
        req.user,
        "resource_created",
        "resources",
        { id },
        input.status,
      );
    });
    res.status(201).json({ id });
  },
);
partnerOperationsRouter.patch(
  "/resources/:id",
  permit("resources", "edit"),
  async (req, res) => {
    resourceAccess(req.user);
    const id = uuid.parse(req.params.id),
      { rate, version, ...input } = resourceSchema.parse(req.body);
    await db.transaction(async (k) => {
      const row = await k("organization_resources").where({ id }).first();
      assert(
        row &&
          (req.user.internal ||
            row.organization_id === req.user.organization_id),
        404,
        "Resource pool not found.",
      );
      assert(
        row.version === version,
        409,
        "Refresh this resource before editing.",
      );
      const changed = await k("organization_resources")
        .where({ id, version })
        .update({
          ...input,
          rate_minor: Math.round(rate * 100),
          version: version! + 1,
          updated_at: now(),
        });
      assert(
        changed,
        409,
        "Another person updated this resource. Refresh and try again.",
      );
      await audit(
        k,
        req.user,
        "resource_updated",
        "resources",
        row,
        input.status,
      );
    });
    res.json({ ok: true });
  },
);
