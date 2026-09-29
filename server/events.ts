import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { db, now, parseJson, type Database } from "./db.js";
import { config } from "./config.js";
import type { SessionUser } from "../shared/domain.js";
import { modules } from "../shared/domain.js";
export async function audit(
  k: Database,
  user: Pick<SessionUser, "id" | "name" | "role" | "organization_id"> | null,
  action: string,
  module: string,
  record?: { id?: string; number?: string; status?: string },
  nextStatus?: string,
  remarks = "",
) {
  await k("audit_logs").insert({
    id: randomUUID(),
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
    created_at: now(),
  });
}
export async function queueEmail(
  k: Database,
  to: string,
  subject: string,
  body: string,
  userId?: string,
) {
  await k("email_outbox").insert({
    id: randomUUID(),
    user_id: userId || null,
    to_address: to,
    subject,
    body,
    status: config.demo && !config.smtp.host ? "local" : "queued",
    attempts: 0,
    next_attempt: now(),
    created_at: now(),
  });
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
let delivering = false;
export async function deliverEmails() {
  if (delivering || !config.smtp.host) return;
  delivering = true;
  try {
    // Recover abandoned claims after a process restart. SMTP delivery is at-least-once.
    await db("email_outbox")
      .where({ status: "sending" })
      .where("next_attempt", "<", now())
      .update({ status: "queued" });
    const messages = await db("email_outbox")
      .where({ status: "queued" })
      .where("next_attempt", "<=", now())
      .orderBy("created_at")
      .limit(20);
    const transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user
        ? { user: config.smtp.user, pass: config.smtp.password }
        : undefined,
      connectionTimeout: 10000,
      socketTimeout: 20000,
    });
    for (const m of messages) {
      const claimed = await db("email_outbox")
        .where({ id: m.id, status: "queued" })
        .update({
          status: "sending",
          next_attempt: new Date(Date.now() + 5 * 60000).toISOString(),
        });
      if (!claimed) continue;
      try {
        await transport.sendMail({
          from: config.smtp.from,
          to: m.to_address,
          subject: m.subject,
          text: m.body,
          messageId: `<${m.id}@partnerhub>`,
        });
        await db("email_outbox")
          .where({ id: m.id })
          .update({
            status: "sent",
            sent_at: now(),
            body: "[Delivered; content removed]",
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
              "SMTP delivery failed. Check provider configuration and delivery logs.",
            next_attempt: new Date(
              Date.now() + Math.pow(2, m.attempts) * 60000,
            ).toISOString(),
          });
      }
    }
    transport.close();
  } finally {
    delivering = false;
  }
}
