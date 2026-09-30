import { Router } from "express";
import rateLimit from "express-rate-limit";
import { DatabaseRateLimitStore } from "./rate-limits.js";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { sendStoredFile } from "./storage.js";
import { z } from "zod";
import { db, now, nextNumber } from "./db.js";
import { config, INTERNAL_ORG_ID } from "./config.js";
import { assert } from "./errors.js";
import {
  authenticated,
  can,
  createSession,
  getUser,
  hashPassword,
  serializeOrg,
} from "./security.js";
import { audit, notifyUsers } from "./events.js";
import { publicOrganization, searchPublicDetails } from "./organizations.js";
import { masterLists, documentPolicies } from "./master-data.js";
import { emailConfiguration, emailConfigured } from "./integration-config.js";
import { email, password, pagination, uuid } from "./validation.js";
import { organizationTypes } from "../shared/domain.js";

export const publicRouter = Router();
publicRouter.get("/config", async (req, res) => {
  const type = req.query.type
    ? z.enum(organizationTypes).parse(req.query.type)
    : "vendor";
  res.json({
    lists: await masterLists(),
    documents: await documentPolicies(type),
    emailVerificationAvailable:
      config.demo || emailConfigured(await emailConfiguration()),
  });
});
publicRouter.get("/partners", async (req, res) => {
  const p = pagination.parse(req.query),
    q = db("organizations")
      .where({ status: "active", marketplace_visible: true })
      .whereNot("id", INTERNAL_ORG_ID);
  if (req.query.type)
    q.where("type", z.enum(organizationTypes).parse(req.query.type));
  if (p.q)
    q.where((b) => {
      b.whereILike("legal_name", `%${p.q}%`).orWhereILike(
        "trade_name",
        `%${p.q}%`,
      );
      searchPublicDetails(b, p.q);
    });
  if (p.category) q.where("industry", p.category);
  if (req.query.location) {
    const location = z.string().max(150).parse(req.query.location);
    q.where((b) => {
      b.whereILike("city", `%${location}%`);
      searchPublicDetails(b, location, ["locations", "delivery_locations"]);
    });
  }
  const total = await q.clone().count({ n: "*" }).first();
  const rows = await q
    .orderBy("legal_name")
    .limit(p.limit)
    .offset((p.page - 1) * p.limit);
  res.json({
    items: rows.map((row) => ({
      ...publicOrganization(serializeOrg(row)),
      logo_url: row.logo_key ? `/api/public/partners/${row.id}/logo` : null,
    })),
    total: Number(total?.n),
    page: p.page,
    limit: p.limit,
  });
});
publicRouter.get("/partners/:id", async (req, res) => {
  const org = await db("organizations")
    .where({
      id: uuid.parse(req.params.id),
      status: "active",
      marketplace_visible: true,
    })
    .first();
  assert(org, 404, "This partner has not published a public profile.");
  res.json({
    ...publicOrganization(serializeOrg(org)),
    logo_url: org.logo_key ? `/api/public/partners/${org.id}/logo` : null,
  });
});
publicRouter.get("/partners/:id/logo", async (req, res) => {
  const org = await db("organizations")
    .where({
      id: uuid.parse(req.params.id),
      status: "active",
      marketplace_visible: true,
    })
    .first();
  assert(org?.logo_key, 404, "Logo not found.");
  res.set("Cache-Control", "no-store");
  await sendStoredFile(res, org.logo_key, org.logo_mime);
});
const inquiryLimit = rateLimit({
  store: new DatabaseRateLimitStore("public-inquiries"),
  windowMs: 3600000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "test",
  message: {
    error:
      "Your earlier requests are saved. Please wait before submitting another message.",
  },
});
publicRouter.post("/contact", inquiryLimit, async (req, res) => {
  const input = z
    .object({
      name: z.string().trim().min(2).max(180),
      email,
      company: z.string().trim().min(2).max(255),
      message: z.string().trim().min(20).max(5000),
      consent: z.literal(true),
    })
    .parse(req.body);
  const id = randomUUID();
  let reference = "";
  await db.transaction(async (k) => {
    reference = await nextNumber(k, "INQ");
    const { consent: _consent, ...data } = input;
    await k("public_inquiries").insert({
      ...data,
      id,
      reference,
      created_at: now(),
      updated_at: now(),
    });
    const recipients = await k("users")
      .whereIn("role", ["super_admin", "support"])
      .where({ active: true })
      .select("id");
    await notifyUsers(
      k,
      recipients.map((u) => u.id),
      "New partner enquiry",
      `${reference} · ${input.company}`,
      "/app/inquiries",
      "support",
    );
  });
  res.status(201).json({ reference });
});
const setupAvailable = async () =>
  !(await db("users").where({ role: "super_admin" }).first());
publicRouter.get("/setup", async (_req, res) =>
  res.json({
    available: await setupAvailable(),
    tokenRequired: config.production || Boolean(process.env.SETUP_TOKEN),
  }),
);
publicRouter.post("/setup", inquiryLimit, async (req, res) => {
  const input = z
    .object({
      name: z.string().trim().min(2).max(150),
      email,
      password,
      token: z.string().max(200).default(""),
    })
    .parse(req.body);
  assert(
    await setupAvailable(),
    409,
    "The platform administrator has already been created. Sign in to continue.",
  );
  const expected = process.env.SETUP_TOKEN;
  if (config.production || expected)
    assert(
      expected &&
        expected.length >= 32 &&
        input.token.length === expected.length &&
        timingSafeEqual(Buffer.from(input.token), Buffer.from(expected)),
      403,
      "Enter the one-time setup token configured by the server operator.",
    );
  else
    assert(
      ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
        req.socket.remoteAddress || "",
      ) && !req.get("x-forwarded-for"),
      403,
      "Initial setup without a token is available only on this computer.",
    );
  const id = randomUUID(),
    hashed = await hashPassword(input.password);
  const csrfToken = await db.transaction(async (k) => {
    let lock = k("organizations").where({ id: INTERNAL_ORG_ID });
    if (db.client.config.client === "pg") lock = lock.forUpdate();
    await lock.first();
    assert(
      !(await k("users").where({ role: "super_admin" }).first()),
      409,
      "The first administrator is already configured.",
    );
    await k("users").insert({
      id,
      name: input.name,
      email: input.email,
      password_hash: hashed,
      role: "super_admin",
      organization_id: INTERNAL_ORG_ID,
      email_verified: true,
      active: true,
      created_at: now(),
      updated_at: now(),
    });
    await k("organizations").where({ id: INTERNAL_ORG_ID }).update({
      contact_name: input.name,
      contact_email: input.email,
      updated_at: now(),
    });
    await audit(
      k,
      null,
      "administrator_bootstrapped",
      "team",
      { id },
      undefined,
      "First administrator created through operator-controlled setup.",
    );
    return createSession(res, id, k);
  });
  res
    .status(201)
    .json({ user: await getUser(id), csrfToken, demo: config.demo });
});
export const inquiriesRouter = Router();
inquiriesRouter.use(authenticated, (req, _res, next) => {
  assert(
    req.user.internal && can(req.user, "tickets", "review"),
    403,
    "Only the VS support team can manage public enquiries.",
  );
  next();
});
inquiriesRouter.get("/", async (req, res) => {
  const p = pagination.parse(req.query),
    q = db("public_inquiries");
  if (p.status) q.where({ status: p.status });
  if (p.q)
    q.where((b) =>
      b
        .whereILike("company", `%${p.q}%`)
        .orWhereILike("reference", `%${p.q}%`)
        .orWhereILike("email", `%${p.q}%`),
    );
  const total = await q.clone().count({ n: "*" }).first();
  res.json({
    items: await q
      .orderBy("created_at", "desc")
      .limit(p.limit)
      .offset((p.page - 1) * p.limit),
    total: Number(total?.n),
    page: p.page,
    limit: p.limit,
  });
});
inquiriesRouter.patch("/:id", async (req, res) => {
  const id = uuid.parse(req.params.id),
    input = z
      .object({
        status: z.enum(["open", "in_progress", "resolved", "closed"]),
        resolution: z.string().trim().max(5000),
      })
      .parse(req.body);
  assert(
    !["resolved", "closed"].includes(input.status) ||
      input.resolution.length >= 5,
    422,
    "Add resolution notes before closing an enquiry.",
  );
  await db.transaction(async (k) => {
    const row = await k("public_inquiries").where({ id }).first();
    assert(row, 404, "Enquiry not found.");
    await k("public_inquiries")
      .where({ id })
      .update({ ...input, updated_at: now() });
    await audit(
      k,
      req.user,
      "inquiry_updated",
      "tickets",
      { ...row, number: row.reference },
      input.status,
      input.resolution,
    );
  });
  res.json({ ok: true });
});
