import { randomUUID, randomInt, timingSafeEqual } from "node:crypto";
import { db, now, type Database } from "./db.js";
import { assert } from "./errors.js";
import { queueEmail } from "./events.js";
import { hashCode } from "./security.js";

export const challengeLifetimeMs = 10 * 60000;
export const resendCooldownMs = 60000;

export async function invalidateTokens(
  k: Database,
  userId: string,
  kinds: string[],
) {
  const tokens = await k("auth_tokens")
    .where({ user_id: userId })
    .whereIn("kind", kinds)
    .select("email_id");
  const ids = tokens.map((token) => token.email_id).filter(Boolean);
  if (ids.length)
    await k("email_outbox")
      .whereIn("id", ids)
      .whereIn("status", ["queued", "blocked", "failed", "local"])
      .update({ status: "expired", body: "[Superseded security message]" });
  await k("auth_tokens")
    .where({ user_id: userId })
    .whereIn("kind", kinds)
    .delete();
}

export async function lockUser(k: Database, id: string) {
  let query = k("users").where({ id });
  if (db.client.config.client === "pg") query = query.forUpdate();
  const user = await query.first();
  assert(user?.active, 401, "This account is no longer active.");
  return user;
}

export async function issueCode(
  k: Database,
  user: { id: string; email: string },
  kind: "verify" | "login",
) {
  await invalidateTokens(k, user.id, [kind]);
  const id = randomUUID(),
    code = String(randomInt(100000, 1000000));
  const createdAt = now(),
    expiresAt = new Date(Date.now() + challengeLifetimeMs).toISOString();
  const subject =
    kind === "verify"
      ? "Verify your VS PartnerHub email"
      : "Your VS PartnerHub sign-in code";
  const body =
    kind === "verify"
      ? `Welcome to VS PartnerHub. Your verification code is ${code}. It expires in 10 minutes. Do not share this code with anyone.`
      : `Your sign-in code is ${code}. It expires in 10 minutes. Do not share it with anyone. If you did not attempt to sign in, change your password.`;
  const emailId = await queueEmail(k, user.email, subject, body, user.id, {
    expiresAt,
  });
  await k("auth_tokens").insert({
    id,
    user_id: user.id,
    kind,
    token_hash: hashCode(kind === "login" ? `${id}:${code}` : code),
    expires_at: expiresAt,
    created_at: createdAt,
    email_id: emailId,
  });
  return {
    id,
    code,
    expiresAt,
    resendAt: new Date(Date.parse(createdAt) + resendCooldownMs).toISOString(),
  };
}

export function codeMatches(expected: string, value: string) {
  const hash = hashCode(value);
  return (
    expected.length === hash.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(hash))
  );
}

// Database-backed limits apply per normalized address across application workers.
// HMAC keys avoid storing additional copies of email addresses, including unknown accounts.
export async function accountAttempt(
  kind: string,
  email: string,
  limit = 10,
  windowMs = 15 * 60000,
) {
  const key = hashCode(`auth-limit:${kind}:${email}`);
  const allowed = await db.transaction(async (k) => {
    await k("auth_attempts")
      .where({ key })
      .where("expires_at", "<=", now())
      .delete();
    await k("auth_attempts")
      .insert({
        key,
        attempts: 0,
        expires_at: new Date(Date.now() + windowMs).toISOString(),
      })
      .onConflict("key")
      .ignore();
    return k("auth_attempts")
      .where({ key })
      .where("attempts", "<", limit)
      .increment("attempts", 1);
  });
  return Boolean(allowed);
}

export async function clearAccountAttempts(
  kind: string,
  email: string,
  k: Database = db,
) {
  await k("auth_attempts")
    .where({ key: hashCode(`auth-limit:${kind}:${email}`) })
    .delete();
}
