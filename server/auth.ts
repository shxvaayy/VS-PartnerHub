import { Router } from "express";
import { randomUUID } from "node:crypto";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { db, now, nextNumber, parseJson, type Database } from "./db.js";
import { config } from "./config.js";
import { registrationSchema, email, password, uuid } from "./validation.js";
import {
  accountAttempt,
  clearAccountAttempts,
  codeMatches,
  invalidateTokens,
  issueCode,
  lockUser,
  resendCooldownMs,
} from "./auth-support.js";
import { assert } from "./errors.js";
import {
  authenticated,
  can,
  createSession,
  getUser,
  hashPassword,
  hashToken,
  secret,
  verifyPassword,
} from "./security.js";
import {
  audit,
  notifyOrganizations,
  queueEmail,
  requireEmailDelivery,
  deliverEmails,
} from "./events.js";
export const authRouter = Router();
const authLimit = rateLimit({
  windowMs: 15 * 60000,
  limit: config.demo ? 100 : 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "test",
  message: { error: "Too many attempts. Please try again in 15 minutes." },
});
authRouter.get("/session", async (req, res) => {
  res.json({
    user: req.user || null,
    csrfToken: req.csrfToken || null,
    demo: config.demo,
  });
});
authRouter.post("/login", authLimit, async (req, res) => {
  const data = z
    .object({ email, password: z.string().min(1).max(128) })
    .parse(req.body);
  assert(
    await accountAttempt("login", data.email),
    429,
    "Too many sign-in attempts for this address. Try again in 15 minutes or reset your password.",
  );
  const user = await db("users").where({ email: data.email }).first();
  const valid = await verifyPassword(data.password, user?.password_hash || "");
  assert(valid && user?.active, 401, "The email or password is incorrect.");
  await clearAccountAttempts("login", data.email);
  if (parseJson(user.preferences).mfa) {
    await requireEmailDelivery();
    assert(
      await accountAttempt("login-code", data.email),
      429,
      "Too many sign-in codes requested. Try again in 15 minutes.",
    );
    const challenge = await db.transaction(async (k) => {
      const current = await lockUser(k, user.id);
      assert(
        current.password_hash === user.password_hash,
        409,
        "Your account changed. Please sign in again.",
      );
      return issueCode(k, current, "login");
    });
    void deliverEmails().catch(() => {});
    res.json({
      requiresOtp: true,
      challengeId: challenge.id,
      expiresAt: challenge.expiresAt,
      resendAt: challenge.resendAt,
      ...(config.demo ? { verificationCode: challenge.code } : {}),
    });
    return;
  }
  const result = await db.transaction(async (k) => {
    const current = await lockUser(k, user.id);
    assert(
      current.password_hash === user.password_hash &&
        !parseJson(current.preferences).mfa,
      409,
      "Your account changed. Please sign in again.",
    );
    if (req.sessionId)
      await k("sessions").where({ id: req.sessionId }).delete();
    const sessionUser = await getUser(user.id, k);
    await audit(k, sessionUser, "signed_in", "auth");
    return {
      user: sessionUser,
      csrfToken: await createSession(res, user.id, k),
    };
  });
  res.json(result);
});
authRouter.post("/verify-login", authLimit, async (req, res) => {
  const data = z
    .object({
      challengeId: uuid,
      code: z
        .string()
        .regex(/^\d{6}$/, "Enter the six-digit code from your email."),
    })
    .parse(req.body);
  const challenge = await db("auth_tokens")
    .where({ id: data.challengeId, kind: "login" })
    .first();
  assert(
    challenge && challenge.expires_at > now() && challenge.attempts < 5,
    422,
    "This sign-in code has expired or reached its attempt limit. Sign in again to request a new code.",
  );
  const attempted = await db("auth_tokens")
    .where({ id: challenge.id })
    .where("expires_at", ">", now())
    .where("attempts", "<", 5)
    .increment("attempts", 1);
  assert(
    attempted &&
      codeMatches(challenge.token_hash, `${data.challengeId}:${data.code}`),
    422,
    "That sign-in code is incorrect.",
  );
  const result = await db.transaction(async (k) => {
    await lockUser(k, challenge.user_id);
    const consumed = await k("auth_tokens")
      .where({ id: challenge.id })
      .where("expires_at", ">", now())
      .delete();
    assert(
      consumed,
      409,
      "This code has already been used or replaced. Sign in again.",
    );
    const user = (await getUser(challenge.user_id, k))!;
    if (req.sessionId)
      await k("sessions").where({ id: req.sessionId }).delete();
    await audit(k, user, "signed_in_with_otp", "auth");
    return { user, csrfToken: await createSession(res, user.id, k) };
  });
  res.json(result);
});
async function deliveryStatus(token: any) {
  const mail = token.email_id
    ? await db("email_outbox").where({ id: token.email_id }).first()
    : null;
  return {
    status:
      token.expires_at <= now() || token.attempts >= 5
        ? "expired"
        : mail?.status || "unknown",
    expiresAt: token.expires_at,
    resendAt: new Date(
      Date.parse(token.created_at) + resendCooldownMs,
    ).toISOString(),
    sentAt: mail?.sent_at,
    deliveredAt: mail?.delivered_at,
  };
}
authRouter.get("/verification-delivery", authenticated, async (req, res) => {
  const token = await db("auth_tokens")
    .where({ user_id: req.user.id, kind: "verify" })
    .orderBy("created_at", "desc")
    .first();
  res.json(
    token
      ? await deliveryStatus(token)
      : { status: req.user.email_verified ? "verified" : "expired" },
  );
});
authRouter.get("/login-delivery/:id", async (req, res) => {
  const token = await db("auth_tokens")
    .where({ id: uuid.parse(req.params.id), kind: "login" })
    .first();
  assert(token, 404, "Sign-in request not found.");
  res.json(await deliveryStatus(token));
});
authRouter.post("/resend-login", authLimit, async (req, res) => {
  const { challengeId } = z.object({ challengeId: uuid }).parse(req.body);
  await requireEmailDelivery();
  const original = await db("auth_tokens")
    .where({ id: challengeId, kind: "login" })
    .first();
  assert(
    original && original.expires_at > now(),
    422,
    "Sign in again to request a fresh security code.",
  );
  const challenge = await db.transaction(async (k) => {
    const user = await lockUser(k, original.user_id);
    const token = await k("auth_tokens")
      .where({ id: challengeId, kind: "login" })
      .first();
    assert(
      token && token.expires_at > now(),
      409,
      "A new code was already requested. Use the latest sign-in request.",
    );
    assert(
      Date.parse(token.created_at) <= Date.now() - resendCooldownMs,
      429,
      "Wait one minute before requesting another code.",
    );
    return issueCode(k, user, "login");
  });
  void deliverEmails().catch(() => {});
  res.json({
    challengeId: challenge.id,
    expiresAt: challenge.expiresAt,
    resendAt: challenge.resendAt,
    ...(config.demo ? { verificationCode: challenge.code } : {}),
  });
});
authRouter.post("/logout", authenticated, async (req, res) => {
  await db.transaction(async (k) => {
    await k("sessions").where({ id: req.sessionId }).delete();
    await audit(k, req.user, "signed_out", "auth");
  });
  res.clearCookie("ph_session", {
    path: "/",
    secure: config.production,
    httpOnly: true,
    sameSite: "lax",
  });
  res.json({ ok: true });
});
authRouter.post("/register", authLimit, async (req, res) => {
  const data = registrationSchema.parse(req.body);
  await requireEmailDelivery();
  assert(
    !(await db("users").where({ email: data.email }).first()),
    409,
    "This email is already registered. Sign in or reset your password.",
  );
  const userId = randomUUID(),
    orgId = randomUUID(),
    passwordHash = await hashPassword(data.password);
  const challenge = await db.transaction(async (k) => {
    const { details, ...org } = data.organization;
    delete details.verification_note;
    await k("organizations").insert({
      ...org,
      id: orgId,
      number: await nextNumber(k, "ORG"),
      status: "registered",
      details: JSON.stringify(details),
      created_at: now(),
      updated_at: now(),
    });
    await k("organization_contacts").insert({
      id: randomUUID(),
      organization_id: orgId,
      name: org.contact_name,
      email: org.contact_email,
      phone: org.contact_phone,
      role: details.contact_role || "Authorized Representative",
      active: true,
      is_primary: true,
      created_at: now(),
      updated_at: now(),
    });
    await k("users").insert({
      id: userId,
      organization_id: orgId,
      name: data.name,
      email: data.email,
      password_hash: passwordHash,
      role: "org_admin",
      email_verified: false,
      active: true,
      created_at: now(),
      updated_at: now(),
    });
    const actor = {
      id: userId,
      organization_id: orgId,
      name: data.name,
      role: "org_admin",
    };
    await audit(
      k,
      actor,
      "registered",
      "organizations",
      { id: orgId },
      "registered",
    );
    await notifyOrganizations(
      k,
      [orgId],
      "Welcome to your partner workspace",
      "Verify your email and add your company documents to start your onboarding.",
      "/app/profile",
      "registration",
    );
    return issueCode(k, { id: userId, email: data.email }, "verify");
  });
  if (req.sessionId) await db("sessions").where({ id: req.sessionId }).delete();
  void deliverEmails().catch(() => {});
  res.status(201).json({
    user: await getUser(userId),
    csrfToken: await createSession(res, userId),
    expiresAt: challenge.expiresAt,
    resendAt: challenge.resendAt,
    ...(config.demo ? { verificationCode: challenge.code } : {}),
  });
});
authRouter.post("/verify", authenticated, authLimit, async (req, res) => {
  const { code } = z
    .object({
      code: z
        .string()
        .regex(/^\d{6}$/, "Enter the six-digit code from your email."),
    })
    .parse(req.body);
  const token = await db("auth_tokens")
    .where({ user_id: req.user.id, kind: "verify" })
    .orderBy("created_at", "desc")
    .first();
  assert(
    token && token.attempts < 5 && token.expires_at > now(),
    422,
    "This code has expired or reached its attempt limit. Request a new code.",
  );
  const attempted = await db("auth_tokens")
    .where({ id: token.id })
    .where("expires_at", ">", now())
    .where("attempts", "<", 5)
    .increment("attempts", 1);
  assert(
    attempted && codeMatches(token.token_hash, code),
    422,
    "That verification code is incorrect.",
  );
  await db.transaction(async (k) => {
    await lockUser(k, req.user.id);
    const consumed = await k("auth_tokens")
      .where({ id: token.id })
      .where("expires_at", ">", now())
      .delete();
    assert(
      consumed,
      409,
      "This code has already been used or replaced. Request a new code.",
    );
    await k("users")
      .where({ id: req.user.id })
      .update({ email_verified: true, updated_at: now() });
    if (req.user.organization_id)
      await k("organizations")
        .where({ id: req.user.organization_id, status: "registered" })
        .update({ status: "under_review", updated_at: now() });
    await audit(k, req.user, "email_verified", "auth");
    await notifyOrganizations(
      k,
      [req.user.organization_id],
      "Company verification started",
      `${req.user.organization?.legal_name} is ready for review. Add the required documents to complete your application.`,
      "/app/documents",
      "verification",
      ["super_admin", "verification"],
    );
  });
  res.json({ user: await getUser(req.user.id) });
});
authRouter.post("/resend-code", authenticated, authLimit, async (req, res) => {
  await requireEmailDelivery();
  const challenge = await db.transaction(async (k) => {
    const user = await lockUser(k, req.user.id);
    assert(!user.email_verified, 409, "Your email is already verified.");
    const recent = await k("auth_tokens")
      .where({ user_id: user.id, kind: "verify" })
      .where(
        "created_at",
        ">",
        new Date(Date.now() - resendCooldownMs).toISOString(),
      )
      .first();
    assert(
      !recent,
      429,
      "Please wait a minute before requesting another code.",
    );
    return issueCode(k, user, "verify");
  });
  void deliverEmails().catch(() => {});
  res.json({
    ok: true,
    expiresAt: challenge.expiresAt,
    resendAt: challenge.resendAt,
    ...(config.demo ? { verificationCode: challenge.code } : {}),
  });
});
authRouter.post(
  "/correct-email",
  authenticated,
  authLimit,
  async (req, res) => {
    const data = z
      .object({ email, current_password: z.string().min(1).max(128) })
      .parse(req.body);
    assert(
      !req.user.email_verified,
      409,
      "Your email is already verified. Contact VS support to change your verified account identity.",
    );
    await requireEmailDelivery();
    const user = await db("users").where({ id: req.user.id }).first();
    assert(
      await verifyPassword(data.current_password, user.password_hash),
      422,
      "Your password is incorrect.",
    );
    assert(
      data.email !== user.email,
      422,
      "Enter the corrected email address, or resend a code to your current address.",
    );
    const result = await db.transaction(async (k) => {
      const current = await lockUser(k, user.id);
      assert(
        !current.email_verified &&
          current.password_hash === user.password_hash &&
          current.email === user.email,
        409,
        "Your account changed. Refresh the page and try again.",
      );
      assert(
        !(await k("users").where({ email: data.email }).first()),
        409,
        "This email is already registered. Sign in with that account or use another address.",
      );
      await k("users")
        .where({ id: user.id })
        .update({ email: data.email, updated_at: now() });
      if (user.organization_id) {
        await k("organizations")
          .where({ id: user.organization_id, contact_email: user.email })
          .update({ contact_email: data.email, updated_at: now() });
        await k("organization_contacts")
          .where({ organization_id: user.organization_id, email: user.email })
          .update({ email: data.email, updated_at: now() });
      }
      await invalidateTokens(k, user.id, ["verify", "login", "reset"]);
      await k("sessions").where({ user_id: user.id }).delete();
      const challenge = await issueCode(
        k,
        { id: user.id, email: data.email },
        "verify",
      );
      await audit(k, req.user, "unverified_email_corrected", "auth");
      return {
        user: await getUser(user.id, k),
        csrfToken: await createSession(res, user.id, k),
        expiresAt: challenge.expiresAt,
        resendAt: challenge.resendAt,
        ...(config.demo ? { verificationCode: challenge.code } : {}),
      };
    });
    void deliverEmails().catch(() => {});
    res.json(result);
  },
);
const recoveryMessage = {
  message:
    "If this email is registered, a password reset email has been requested. Check your inbox and spam folder.",
};
authRouter.post("/forgot-password", authLimit, async (req, res) => {
  const input = z.object({ email }).parse(req.body);
  await requireEmailDelivery();
  if (!(await accountAttempt("recovery", input.email, 5))) {
    res.json(recoveryMessage);
    return;
  }
  const user = await db("users")
    .where({ email: input.email, active: true })
    .first();
  if (user) {
    await db.transaction(async (k) => {
      await lockUser(k, user.id);
      const recent = await k("auth_tokens")
        .where({ user_id: user.id, kind: "reset" })
        .where(
          "created_at",
          ">",
          new Date(Date.now() - resendCooldownMs).toISOString(),
        )
        .first();
      if (recent) return;
      const token = secret(),
        expiresAt = new Date(Date.now() + 30 * 60000).toISOString();
      await invalidateTokens(k, user.id, ["reset"]);
      const emailId = await queueEmail(
        k,
        user.email,
        "Reset your VS PartnerHub password",
        `Reset your password: ${config.appUrl}/reset-password?token=${token}\n\nThis link expires in 30 minutes and can be used once. If you did not request it, ignore this email.`,
        user.id,
        { expiresAt },
      );
      await k("auth_tokens").insert({
        id: randomUUID(),
        user_id: user.id,
        kind: "reset",
        token_hash: hashToken(token),
        expires_at: expiresAt,
        created_at: now(),
        email_id: emailId,
      });
    });
    void deliverEmails().catch(() => {});
  }
  res.json(recoveryMessage);
});
const resetToken = z
  .string()
  .regex(
    /^[a-f0-9]{64}$/,
    "This reset link is incomplete. Request a new password reset email.",
  );
authRouter.get("/reset-password/:token", authLimit, async (req, res) => {
  const token = await db("auth_tokens")
    .where({
      token_hash: hashToken(resetToken.parse(req.params.token)),
      kind: "reset",
    })
    .where("expires_at", ">", now())
    .first();
  assert(token, 404, "This reset link has expired or has already been used.");
  assert(
    await getUser(token.user_id),
    404,
    "This reset link is no longer available.",
  );
  res.json({ valid: true, expiresAt: token.expires_at });
});
authRouter.post("/reset-password", authLimit, async (req, res) => {
  const data = z.object({ token: resetToken, password }).parse(req.body);
  const passwordHash = await hashPassword(data.password);
  await db.transaction(async (k) => {
    const token = await k("auth_tokens")
      .where({ token_hash: hashToken(data.token), kind: "reset" })
      .where("expires_at", ">", now())
      .first();
    assert(token, 422, "This reset link has expired or has already been used.");
    const user = await lockUser(k, token.user_id);
    const consumed = await k("auth_tokens")
      .where({ id: token.id })
      .where("expires_at", ">", now())
      .delete();
    assert(consumed, 409, "This reset link was already used or replaced.");
    await k("users")
      .where({ id: user.id })
      .update({ password_hash: passwordHash, updated_at: now() });
    await k("sessions").where({ user_id: user.id }).delete();
    await invalidateTokens(k, user.id, ["verify", "login", "reset"]);
    await clearAccountAttempts("login", user.email, k);
    await audit(k, await getUser(user.id, k), "password_reset", "auth");
    await queueEmail(
      k,
      user.email,
      "Your VS PartnerHub password was changed",
      "Your password was reset and all existing sessions were signed out. If you did not make this change, reset your password immediately and contact the VS support team.",
      user.id,
    );
  });
  res.clearCookie("ph_session", {
    path: "/",
    secure: config.production,
    httpOnly: true,
    sameSite: "lax",
  });
  void deliverEmails().catch(() => {});
  res.json({ ok: true });
});
authRouter.post(
  "/change-password",
  authenticated,
  authLimit,
  async (req, res) => {
    const data = z
      .object({ current_password: z.string().min(1).max(128), password })
      .parse(req.body);
    const user = await db("users").where({ id: req.user.id }).first();
    assert(
      await verifyPassword(data.current_password, user.password_hash),
      422,
      "Your current password is incorrect.",
    );
    assert(
      data.password !== data.current_password,
      422,
      "Choose a new password different from your current password.",
    );
    const hash = await hashPassword(data.password);
    const csrfToken = await db.transaction(async (k) => {
      const current = await lockUser(k, user.id);
      assert(
        current.password_hash === user.password_hash,
        409,
        "Your password changed. Sign in again before changing it.",
      );
      await k("users")
        .where({ id: user.id })
        .update({ password_hash: hash, updated_at: now() });
      await k("sessions").where({ user_id: user.id }).delete();
      await invalidateTokens(k, user.id, ["reset", "login"]);
      await audit(k, req.user, "password_changed", "auth");
      await queueEmail(
        k,
        user.email,
        "Your VS PartnerHub password was changed",
        "Your password was updated and your other sessions were signed out. If you did not make this change, reset your password immediately and contact the VS support team.",
        user.id,
      );
      return createSession(res, user.id, k);
    });
    void deliverEmails().catch(() => {});
    res.json({ ok: true, csrfToken });
  },
);
authRouter.get("/sessions", authenticated, async (req, res) => {
  const rows = await db("sessions")
    .where({ user_id: req.user.id })
    .where("expires_at", ">", now())
    .orderBy("last_seen_at", "desc");
  res.json(
    rows.map((row) => ({
      id: row.public_id,
      current: row.id === req.sessionId,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at || row.created_at,
      expiresAt: row.expires_at,
      userAgent: row.user_agent,
    })),
  );
});
authRouter.delete("/sessions/:id", authenticated, async (req, res) => {
  const id = uuid.parse(req.params.id);
  const session = await db("sessions")
    .where({ public_id: id, user_id: req.user.id })
    .first();
  assert(session, 404, "This session is no longer active.");
  await db.transaction(async (k) => {
    await k("sessions").where({ public_id: id, user_id: req.user.id }).delete();
    await audit(k, req.user, "session_revoked", "auth", { id });
  });
  const signedOut = session.id === req.sessionId;
  if (signedOut)
    res.clearCookie("ph_session", {
      path: "/",
      secure: config.production,
      httpOnly: true,
      sameSite: "lax",
    });
  res.json({ ok: true, signedOut });
});
authRouter.post(
  "/sessions/revoke-others",
  authenticated,
  authLimit,
  async (req, res) => {
    const { current_password } = z
      .object({ current_password: z.string().min(1).max(128) })
      .parse(req.body);
    const user = await db("users").where({ id: req.user.id }).first();
    assert(
      await verifyPassword(current_password, user.password_hash),
      422,
      "Your password is incorrect.",
    );
    await db.transaction(async (k) => {
      const current = await lockUser(k, user.id);
      assert(
        current.password_hash === user.password_hash,
        409,
        "Your account changed. Sign in again.",
      );
      await k("sessions")
        .where({ user_id: user.id })
        .whereNot("id", req.sessionId)
        .delete();
      await invalidateTokens(k, user.id, ["login"]);
      await audit(k, req.user, "other_sessions_revoked", "auth");
    });
    res.json({ ok: true });
  },
);
authRouter.patch("/preferences", authenticated, async (req, res) => {
  const data = z.object({ email: z.boolean() }).parse(req.body);
  const user = await db("users").where({ id: req.user.id }).first();
  await db("users")
    .where({ id: req.user.id })
    .update({
      preferences: JSON.stringify({ ...parseJson(user.preferences), ...data }),
      updated_at: now(),
    });
  res.json(data);
});
authRouter.get("/preferences", authenticated, async (req, res) => {
  const user = await db("users").where({ id: req.user.id }).first();
  res.json({ email: true, mfa: false, ...parseJson(user.preferences) });
});
authRouter.post("/mfa", authenticated, authLimit, async (req, res) => {
  const data = z
    .object({
      enabled: z.boolean(),
      current_password: z.string().min(1).max(128),
    })
    .parse(req.body);
  if (data.enabled) await requireEmailDelivery();
  const user = await db("users").where({ id: req.user.id }).first();
  assert(
    req.user.email_verified,
    422,
    "Verify your email before enabling sign-in codes.",
  );
  assert(
    await verifyPassword(data.current_password, user.password_hash),
    422,
    "Your current password is incorrect.",
  );
  await db.transaction(async (k) => {
    const current = await lockUser(k, user.id);
    assert(
      current.password_hash === user.password_hash,
      409,
      "Your account changed. Sign in again.",
    );
    await k("users")
      .where({ id: user.id })
      .update({
        preferences: JSON.stringify({
          ...parseJson(current.preferences),
          mfa: data.enabled,
        }),
        updated_at: now(),
      });
    await k("sessions")
      .where({ user_id: user.id })
      .whereNot("id", req.sessionId)
      .delete();
    await invalidateTokens(k, user.id, ["login"]);
    await audit(
      k,
      req.user,
      data.enabled ? "mfa_enabled" : "mfa_disabled",
      "auth",
    );
    await queueEmail(
      k,
      user.email,
      "Your VS PartnerHub sign-in security changed",
      `Email sign-in verification was ${data.enabled ? "enabled" : "disabled"} for your account. Your other sessions have been signed out. If you did not make this change, reset your password and contact VS support.`,
      user.id,
    );
  });
  void deliverEmails().catch(() => {});
  res.json({ ok: true, mfa: data.enabled });
});
async function checkInvitation(invite: any, k: Database = db) {
  const inviter = await getUser(invite.invited_by, k);
  assert(
    inviter &&
      can(inviter, "team", "manage") &&
      inviter.email_verified &&
      (inviter.internal ||
        (inviter.organization?.status === "active" &&
          inviter.organization_id === invite.organization_id)),
    422,
    "This invitation is no longer authorized. Ask your administrator for a new invitation.",
  );
  if (invite.organization_id) {
    const org = await k("organizations")
      .where({ id: invite.organization_id })
      .first();
    assert(
      org?.status === "active",
      422,
      "This organization's invitations are unavailable. Contact VS support.",
    );
  }
  const role = await k("roles").where({ id: invite.role }).first();
  assert(
    role && (inviter.internal || !role.internal),
    422,
    "This invitation's role is no longer available.",
  );
}
authRouter.get("/invitation/:token", authLimit, async (req, res) => {
  const token = z.string().length(64).parse(req.params.token);
  const invite = await db("invitations")
    .where({ token_hash: hashToken(token), accepted_at: null })
    .where("expires_at", ">", now())
    .first();
  assert(invite, 404, "This invitation has expired or was already accepted.");
  await checkInvitation(invite);
  res.json({ name: invite.name, email: invite.email, role: invite.role });
});
authRouter.post("/accept-invitation", authLimit, async (req, res) => {
  const data = z
    .object({
      token: z.string().length(64),
      password,
      name: z.string().trim().min(2).max(150),
    })
    .parse(req.body);
  const hash = await hashPassword(data.password),
    userId = randomUUID();
  await db.transaction(async (k) => {
    const invitation = await k("invitations")
      .where({ token_hash: hashToken(data.token), accepted_at: null })
      .where("expires_at", ">", now())
      .first();
    assert(
      invitation,
      422,
      "This invitation has expired or was already accepted.",
    );
    await lockUser(k, invitation.invited_by);
    await checkInvitation(invitation, k);
    const consumed = await k("invitations")
      .where({ id: invitation.id, accepted_at: null })
      .where("expires_at", ">", now())
      .update({ accepted_at: now() });
    assert(consumed, 409, "This invitation was already used.");
    await k("users").insert({
      id: userId,
      organization_id: invitation.organization_id,
      email: invitation.email,
      name: data.name,
      password_hash: hash,
      role: invitation.role,
      active: true,
      email_verified: true,
      created_at: now(),
      updated_at: now(),
    });
    await audit(k, await getUser(userId, k), "invitation_accepted", "team");
    if (invitation.email_id)
      await k("email_outbox")
        .where({ id: invitation.email_id })
        .whereIn("status", ["queued", "failed", "blocked", "local"])
        .update({ status: "expired", body: "[Accepted invitation]" });
    if (req.sessionId)
      await k("sessions").where({ id: req.sessionId }).delete();
  });
  res.status(201).json({
    user: await getUser(userId),
    csrfToken: await createSession(res, userId),
  });
});
