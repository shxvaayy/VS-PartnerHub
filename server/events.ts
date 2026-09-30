import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { db, now, parseJson, type Database } from "./db.js";
import { config } from "./config.js";
import type { SessionUser } from "../shared/domain.js";
import { modules } from "../shared/domain.js";
import {
  emailConfiguration,
  emailConfigured,
  type EmailConfiguration,
} from "./integration-config.js";
import { assert } from "./errors.js";
import { enqueueWebhookEvent } from "./webhooks.js";
export async function audit(
  k: Database,
  user: Pick<SessionUser, "id" | "name" | "role" | "organization_id"> | null,
  action: string,
  module: string,
  record?: { id?: string; number?: string; status?: string },
  nextStatus?: string,
  remarks = "",
) {
  const eventId = randomUUID(),
    at = now();
  await k("audit_logs").insert({
    id: eventId,
    user_id: user?.id || null,
    organization_id: user?.organization_id || null,
    actor_name: user?.name || "System",
    role: user?.role || "system",
    action,
    module,
    record_id: record?.id || null,
    record_number: record?.number || null,
    previous_status: record?.status || null,
    new_status: nextStatus || null,
    remarks,
    created_at: at,
  });
  if (modules.includes(module as any))
    await enqueueWebhookEvent(k, {
      id: eventId,
      module,
      action,
      organizationId: user?.organization_id || null,
      recordId: record?.id,
      number: record?.number,
      previousStatus: record?.status,
      status: nextStatus,
      at,
    });
}
export async function queueEmail(
  k: Database,
  to: string,
  subject: string,
  body: string,
  userId?: string,
  options: { expiresAt?: string } = {},
) {
  const settings = await emailConfiguration(k);
  const id = randomUUID();
  await k("email_outbox").insert({
    id,
    user_id: userId || null,
    to_address: to,
    subject,
    body,
    status: emailConfigured(settings)
      ? "queued"
      : config.demo
        ? "local"
        : "blocked",
    provider: settings.provider,
    expires_at: options.expiresAt || null,
    attempts: 0,
    next_attempt: now(),
    created_at: now(),
  });
  return id;
}
export async function requireEmailDelivery() {
  assert(
    config.demo || emailConfigured(await emailConfiguration()),
    503,
    "Email verification is temporarily unavailable. Please contact VS support or try again after email delivery is restored.",
  );
}
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export async function sendEmail(
  settings: EmailConfiguration,
  message: { id: string; to_address: string; subject: string; body: string },
) {
  const html = `<div style="background:#f3f6f1;padding:32px;font-family:Arial,sans-serif;color:#203d30"><div style="max-width:580px;margin:auto;background:white;border:1px solid #dfe8db;border-radius:16px;padding:32px"><h2 style="color:#204c37;margin-top:0">VS PartnerHub</h2><h3>${escapeHtml(message.subject)}</h3><div style="line-height:1.7;white-space:pre-wrap">${escapeHtml(message.body)}</div><hr style="border:0;border-top:1px solid #e1e8dd;margin-top:32px"><p style="font-size:12px;color:#5a6b5e">Vijay Software Solutions Pvt. Ltd. · Partner operations</p></div></div>`;
  if (settings.provider === "resend") {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": message.id,
      },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        from: settings.from,
        to: [message.to_address],
        subject: message.subject,
        text: message.body,
        html,
        ...(settings.replyTo ? { reply_to: settings.replyTo } : {}),
      }),
    });
    if (!response.ok)
      throw new Error(
        `Email provider rejected the request (HTTP ${response.status}). Check the sender domain and provider credentials.`,
      );
    const result = (await response.json()) as { id: string };
    return result.id;
  }
  const transport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    requireTLS:
      !settings.secure && !["127.0.0.1", "localhost"].includes(settings.host),
    auth: settings.username
      ? { user: settings.username, pass: settings.password }
      : undefined,
    connectionTimeout: 10000,
    socketTimeout: 20000,
  });
  try {
    const result = await transport.sendMail({
      from: settings.from,
      to: message.to_address,
      replyTo: settings.replyTo || undefined,
      subject: message.subject,
      text: message.body,
      html,
      messageId: `<${message.id}@${settings.from.match(/@([^>\s]+)>?$/)?.[1] || "partnerhub.local"}>`,
    });
    if (!result.accepted?.length)
      throw new Error("The recipient was not accepted by the email provider.");
    return result.messageId;
  } finally {
    transport.close();
  }
}
export async function notifyUsers(
  k: Database,
  userIds: string[],
  title: string,
  body: string,
  href: string,
  category: string,
  dedupeKey?: string,
) {
  const settings = parseJson(
    (await k("settings").where({ key: "platform" }).first())?.value,
  );
  const users = await k("users")
    .join("roles", "users.role", "roles.id")
    .whereIn("users.id", [...new Set(userIds)])
    .where("users.active", true)
    .select("users.*", "roles.permissions", "roles.internal");
  for (const user of users) {
    if (
      modules.includes(category as any) &&
      !parseJson(user.permissions)[category]?.includes("view")
    )
      continue;
    const destination =
      !user.internal && href === "/app/verification" ? "/app/profile" : href;
    if (
      dedupeKey &&
      (await k("notifications")
        .where({ user_id: user.id, dedupe_key: dedupeKey })
        .first())
    )
      continue;
    await k("notifications").insert({
      id: randomUUID(),
      user_id: user.id,
      title,
      body,
      href: destination,
      category,
      dedupe_key: dedupeKey || null,
      created_at: now(),
    });
    if (
      settings.emailEnabled !== false &&
      parseJson(user.preferences).email !== false
    )
      await queueEmail(
        k,
        user.email,
        title,
        `${body}\n\nOpen your workspace: ${config.appUrl}${destination}`,
        user.id,
      );
  }
}
export async function notifyOrganizations(
  k: Database,
  orgIds: (string | null | undefined)[],
  title: string,
  body: string,
  href: string,
  category: string,
  internalRoles: string[] = [],
  dedupeKey?: string,
) {
  const ids = orgIds.filter(Boolean) as string[];
  const users = await k("users")
    .where((q) => {
      q.whereIn("organization_id", ids);
      if (internalRoles.length) q.orWhereIn("role", internalRoles);
    })
    .select("id");
  await notifyUsers(
    k,
    users.map((u) => u.id),
    title,
    body,
    href,
    category,
    dedupeKey,
  );
}
let deliveryTask: Promise<void> | null = null;
let pendingAll = false;
const pendingIds = new Set<string>();
export function deliverEmails(onlyId?: string): Promise<void> {
  if (onlyId) pendingIds.add(onlyId);
  else pendingAll = true;
  if (!deliveryTask)
    deliveryTask = (async () => {
      try {
        while (pendingAll || pendingIds.size) {
          const all = pendingAll,
            ids = [...pendingIds];
          pendingAll = false;
          pendingIds.clear();
          if (all) await deliverEmailBatch();
          else for (const id of ids) await deliverEmailBatch(id);
        }
      } finally {
        deliveryTask = null;
      }
    })();
  return deliveryTask;
}
async function deliverEmailBatch(onlyId?: string) {
  const settings = await emailConfiguration();
  if (!emailConfigured(settings)) return;
  // Recover abandoned claims after a process restart. SMTP delivery is at-least-once.
  await db("email_outbox")
    .where({ status: "sending" })
    .where("next_attempt", "<", now())
    .update({ status: "queued" });
  await db("email_outbox")
    .whereIn("status", ["queued", "blocked"])
    .whereNotNull("expires_at")
    .where("expires_at", "<=", now())
    .update({
      status: "expired",
      body: "[Expired; content removed]",
      last_error:
        "This message expired before delivery. Request a new code or invitation.",
    });
  await db("email_outbox")
    .where({ status: "blocked" })
    .where((q) => q.whereNull("expires_at").orWhere("expires_at", ">", now()))
    .update({ status: "queued", next_attempt: now() });
  const query = db("email_outbox")
    .where({ status: "queued" })
    .where("next_attempt", "<=", now())
    .orderByRaw("case when expires_at is null then 1 else 0 end")
    .orderBy("created_at")
    .limit(20);
  if (onlyId) query.where({ id: onlyId });
  const messages = await query;
  for (const m of messages) {
    const claimed = await db("email_outbox")
      .where({ id: m.id, status: "queued" })
      .where((q) => q.whereNull("expires_at").orWhere("expires_at", ">", now()))
      .update({
        status: "sending",
        next_attempt: new Date(Date.now() + 5 * 60000).toISOString(),
      });
    if (!claimed) continue;
    try {
      const providerReference = await sendEmail(settings, m);
      await db("email_outbox")
        .where({ id: m.id })
        .update({
          status: "sent",
          provider: settings.provider,
          provider_reference: providerReference,
          sent_at: now(),
          body: "[Accepted by provider; content removed]",
          attempts: m.attempts + 1,
          last_error: null,
        });
    } catch {
      await db("email_outbox")
        .where({ id: m.id })
        .update({
          status: m.attempts >= 4 ? "failed" : "queued",
          attempts: m.attempts + 1,
          last_error:
            "Email provider did not accept the message. Check credentials, sender verification and recipient delivery settings.",
          next_attempt: new Date(
            Date.now() + Math.pow(2, m.attempts) * 60000,
          ).toISOString(),
        });
    }
  }
  if (!onlyId && messages.length === 20) pendingAll = true;
}
