import { Router, type RequestHandler } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import nodemailer from "nodemailer";
import { z } from "zod";
import { db, now } from "./db.js";
import { authenticated, permit } from "./security.js";
import { assert } from "./errors.js";
import {
  emailConfiguration,
  emailConfigured,
  geminiConfiguration,
  writeIntegration,
} from "./integration-config.js";
import { callGemini } from "./gemini.js";
import { audit, deliverEmails, queueEmail } from "./events.js";
import { email } from "./validation.js";

export const integrationsRouter = Router();
integrationsRouter.use(authenticated, permit("integrations"));
const admin: RequestHandler = (req, _res, next) => {
  try {
    assert(
      req.user.role === "super_admin",
      403,
      "Only a Super Admin can configure platform providers.",
    );
    next();
  } catch (e) {
    next(e);
  }
};
const sender = z
  .string()
  .trim()
  .min(5)
  .max(255)
  .refine(
    (v) =>
      !/[\r\n]/.test(v) &&
      z.email().safeParse(v.match(/<([^<>]+)>$/)?.[1] || v).success,
    "Enter a valid sender email or Name <email>.",
  );
integrationsRouter.get("/providers", admin, async (_req, res) => {
  const mail = await emailConfiguration(),
    gemini = await geminiConfiguration();
  const {
    password: _password,
    apiKey: _api,
    webhookSecret: _webhook,
    ...visibleMail
  } = mail;
  const { apiKey: _key, ...visibleGemini } = gemini;
  res.json({
    email: {
      ...visibleMail,
      configured: emailConfigured(mail),
      hasPassword: Boolean(mail.password),
      hasApiKey: Boolean(mail.apiKey),
      hasWebhookSecret: Boolean(mail.webhookSecret),
    },
    gemini: {
      ...visibleGemini,
      configured: Boolean(gemini.enabled && gemini.apiKey),
      hasApiKey: Boolean(gemini.apiKey),
    },
    checks: await db("integration_settings").select(
      "key",
      "checked_at",
      "check_status",
      "updated_at",
    ),
  });
});
integrationsRouter.put("/email", admin, async (req, res) => {
  const data = z
    .object({
      enabled: z.boolean(),
      provider: z.enum(["smtp", "resend"]),
      from: sender,
      replyTo: z.union([email, z.literal("")]).default(""),
      host: z.string().trim().max(255).default(""),
      port: z.number().int().min(1).max(65535).default(587),
      secure: z.boolean().default(false),
      username: z.string().max(255).default(""),
      password: z.string().max(2000).optional(),
      apiKey: z.string().max(2000).optional(),
      webhookSecret: z.string().max(2000).optional(),
    })
    .strict()
    .parse(req.body);
  const previous = await emailConfiguration();
  const value = {
    ...data,
    password: data.password || previous.password,
    apiKey: data.apiKey || previous.apiKey,
    webhookSecret: data.webhookSecret || previous.webhookSecret,
  };
  assert(
    !value.enabled || emailConfigured(value),
    422,
    "Complete the selected provider's connection details before enabling email.",
  );
  await writeIntegration("email", value, req.user.id);
  await audit(
    db,
    req.user,
    "email_provider_configured",
    "integrations",
    undefined,
    undefined,
    value.provider,
  );
  res.json({ ok: true });
});
integrationsRouter.post("/email/verify", admin, async (req, res) => {
  const settings = await emailConfiguration();
  assert(emailConfigured(settings), 422, "Configure email delivery first.");
  try {
    if (settings.provider === "smtp") {
      const transport = nodemailer.createTransport({
        host: settings.host,
        port: settings.port,
        secure: settings.secure,
        requireTLS:
          !settings.secure &&
          !["localhost", "127.0.0.1"].includes(settings.host),
        auth: settings.username
          ? { user: settings.username, pass: settings.password }
          : undefined,
        connectionTimeout: 10000,
        socketTimeout: 20000,
      });
      try {
        await transport.verify();
      } finally {
        transport.close();
      }
    } else {
      const response = await fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${settings.apiKey}` },
        signal: AbortSignal.timeout(20000),
      });
      assert(
        response.ok,
        422,
        "Resend could not verify this API key. For a sending-only key, use Send test email to verify delivery.",
      );
    }
    await db("integration_settings")
      .where({ key: "email" })
      .update({ checked_at: now(), check_status: "connected" });
    await audit(db, req.user, "email_connection_verified", "integrations");
    res.json({
      ok: true,
      message:
        "Provider connection verified. Send a test email to check the sender and recipient path.",
    });
  } catch {
    await db("integration_settings")
      .where({ key: "email" })
      .update({ checked_at: now(), check_status: "failed" });
    assert(
      false,
      422,
      "The email connection could not be verified. Check the host, port, credentials and sender domain. A sending-only Resend key can be checked with Send test email.",
    );
  }
});
integrationsRouter.post("/email/test", admin, async (req, res) => {
  const { recipient } = z.object({ recipient: email }).parse(req.body);
  assert(
    emailConfigured(await emailConfiguration()),
    422,
    "Configure email delivery first.",
  );
  const id = await queueEmail(
    db,
    recipient,
    "VS PartnerHub email connection test",
    "This message confirms that the VS PartnerHub email provider accepted a test delivery. Registration OTPs, verification decisions and workspace updates use this same delivery connection.",
    req.user.id,
    { expiresAt: new Date(Date.now() + 10 * 60000).toISOString() },
  );
  await deliverEmails(id);
  const result = await db("email_outbox")
    .where({ id })
    .select("id", "status", "sent_at", "provider", "provider_reference")
    .first();
  await audit(
    db,
    req.user,
    "email_test_requested",
    "integrations",
    { id },
    undefined,
    recipient,
  );
  res.json(result);
});
integrationsRouter.put("/gemini", admin, async (req, res) => {
  const data = z
    .object({
      enabled: z.boolean(),
      apiKey: z.string().trim().max(2000).optional(),
      model: z
        .string()
        .regex(/^gemini-[a-z0-9._-]+$/)
        .max(100),
      dailyLimit: z.number().int().min(1).max(2000),
    })
    .strict()
    .parse(req.body);
  const previous = await geminiConfiguration();
  const value = { ...data, apiKey: data.apiKey || previous.apiKey };
  assert(
    !value.enabled || value.apiKey,
    422,
    "Add a Gemini API key before enabling VS AI.",
  );
  await writeIntegration("gemini", value, req.user.id);
  await audit(
    db,
    req.user,
    "gemini_configured",
    "integrations",
    undefined,
    undefined,
    data.model,
  );
  res.json({ ok: true });
});
integrationsRouter.post("/gemini/test", admin, async (req, res) => {
  const response = await callGemini(
    {
      purpose: "connection_test",
      system: "Respond with the single word connected.",
      parts: [{ text: "Check this Gemini connection." }],
    },
    req.user,
  );
  await db("integration_settings")
    .where({ key: "gemini" })
    .update({ checked_at: now(), check_status: "connected" });
  await audit(
    db,
    req.user,
    "gemini_connection_verified",
    "integrations",
    undefined,
    undefined,
    response.model,
  );
  res.json({
    ok: true,
    model: response.model,
    response: response.result,
    usage: response.usage,
  });
});

export const emailWebhook: RequestHandler = async (req, res, next) => {
  try {
    const settings = await emailConfiguration();
    assert(
      settings.provider === "resend" && settings.webhookSecret,
      404,
      "Webhook not configured.",
    );
    const timestamp = req.get("svix-timestamp") || "",
      id = req.get("svix-id") || "";
    assert(
      /^\d+$/.test(timestamp) &&
        Math.abs(Date.now() / 1000 - Number(timestamp)) < 300 &&
        id,
      401,
      "Invalid webhook timestamp.",
    );
    assert(Buffer.isBuffer(req.body), 400, "A raw webhook body is required.");
    const secret = Buffer.from(
      settings.webhookSecret.replace(/^whsec_/, ""),
      "base64",
    );
    const expected = createHmac("sha256", secret)
      .update(`${id}.${timestamp}.${req.body.toString("utf8")}`)
      .digest();
    const signatures = (req.get("svix-signature") || "")
      .split(" ")
      .map((v) => v.split(","))
      .filter(([version]) => version === "v1");
    assert(
      signatures.some(([, signature]) => {
        const given = Buffer.from(signature || "", "base64");
        return (
          given.length === expected.length && timingSafeEqual(given, expected)
        );
      }),
      401,
      "Invalid webhook signature.",
    );
    const event = JSON.parse(req.body.toString("utf8"));
    if (event.data?.email_id) {
      const changes =
        event.type === "email.delivered"
          ? { status: "delivered", delivered_at: now(), last_error: null }
          : ["email.bounced", "email.failed", "email.complained"].includes(
                event.type,
              )
            ? {
                status: "failed",
                last_error: `Provider reported ${event.type.replace("email.", "")}.`,
              }
            : null;
      if (changes)
        await db("email_outbox")
          .where({
            provider_reference: event.data.email_id,
            provider: "resend",
          })
          .whereIn("status", ["sent", "delivered", "failed"])
          .update(changes);
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
};
