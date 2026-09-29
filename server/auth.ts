import { Router } from "express";
import { randomUUID, randomInt } from "node:crypto";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { db, now, nextNumber, parseJson } from "./db.js";
import { config } from "./config.js";
import { registrationSchema, email, password } from "./validation.js";
import { assert } from "./errors.js";
import {
  authenticated,
  createSession,
  getUser,
  hashCode,
  hashPassword,
  hashToken,
  secret,
  verifyPassword,
} from "./security.js";
import { audit, notifyOrganizations, queueEmail } from "./events.js";
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
  const user = await db("users").where({ email: data.email }).first();
  const valid = await verifyPassword(data.password, user?.password_hash || "");
  assert(valid && user?.active, 401, "The email or password is incorrect.");
  if (parseJson(user.preferences).mfa) {
    const challengeId = randomUUID(),
      code = String(randomInt(100000, 1000000));
    await db.transaction(async (k) => {
      await k("auth_tokens")
        .where({ user_id: user.id, kind: "login" })
        .delete();
      await k("auth_tokens").insert({
        id: challengeId,
        user_id: user.id,
        kind: "login",
        token_hash: hashCode(`${challengeId}:${code}`),
        expires_at: new Date(Date.now() + 10 * 60000).toISOString(),
        created_at: now(),
      });
      await queueEmail(
        k,
        user.email,
        "Your VS PartnerHub sign-in code",
        `Your sign-in code is ${code}. It expires in 10 minutes. If you did not attempt to sign in, change your password.`,
        user.id,
      );
    });
    res.json({
      requiresOtp: true,
      challengeId,
      ...(config.demo ? { verificationCode: code } : {}),
    });
    return;
  }
  if (req.sessionId) await db("sessions").where({ id: req.sessionId }).delete();
  const csrfToken = await createSession(res, user.id);
  const sessionUser = await getUser(user.id);
  await audit(db, sessionUser, "signed_in", "auth");
  res.json({ user: sessionUser, csrfToken });
});
authRouter.post("/verify-login", authLimit, async (req, res) => {
  const data = z
    .object({
      challengeId: z.string().uuid(),
      code: z.string().regex(/^\d{6}$/),
    })
    .parse(req.body);
  const challenge = await db("auth_tokens")
    .where({ id: data.challengeId, kind: "login" })
    .first();
  assert(
    challenge && challenge.expires_at > now() && challenge.attempts < 5,
    422,
    "This sign-in code has expired. Sign in again to request a new code.",
  );
  const attempted = await db("auth_tokens")
    .where({ id: challenge.id })
    .where("attempts", "<", 5)
    .increment("attempts", 1);
  assert(
    attempted &&
      challenge.token_hash === hashCode(`${data.challengeId}:${data.code}`),
    422,
    "That sign-in code is incorrect.",
  );
  const user = await getUser(challenge.user_id);
  assert(user, 401, "This account is no longer active.");
  await db.transaction(async (k) => {
    const consumed = await k("auth_tokens")
      .where({ id: challenge.id })
      .delete();
    assert(consumed, 409, "This code has already been used.");
    if (req.sessionId)
      await k("sessions").where({ id: req.sessionId }).delete();
    await audit(k, user, "signed_in_with_otp", "auth");
  });
  res.json({ user, csrfToken: await createSession(res, user.id) });
});
authRouter.post("/logout", authenticated, async (req, res) => {
  await db("sessions").where({ id: req.sessionId }).delete();
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
  const existing = await db("users").where({ email: data.email }).first();
  assert(
    !existing,
    409,
    "This email is already registered. Sign in or reset your password.",
  );
  const userId = randomUUID(),
    orgId = randomUUID(),
    code = String(randomInt(100000, 1000000));
  const passwordHash = await hashPassword(data.password);
  await db.transaction(async (k) => {
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
    await k("auth_tokens").insert({
      id: randomUUID(),
      user_id: userId,
      kind: "verify",
      token_hash: hashCode(code),
      expires_at: new Date(Date.now() + 10 * 60000).toISOString(),
      created_at: now(),
    });
    await queueEmail(
      k,
      data.email,
      "Verify your VS PartnerHub email",
      `Welcome to VS PartnerHub. Your verification code is ${code}. It expires in 10 minutes.`,
      userId,
    );
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
  });
  if (req.sessionId) await db("sessions").where({ id: req.sessionId }).delete();
  res.status(201).json({
    user: await getUser(userId),
    csrfToken: await createSession(res, userId),
    ...(config.demo ? { verificationCode: code } : {}),
  });
});
authRouter.post("/verify", authenticated, authLimit, async (req, res) => {
  const { code } = z
    .object({ code: z.string().regex(/^\d{6}$/) })
    .parse(req.body);
  const token = await db("auth_tokens")
    .where({ user_id: req.user.id, kind: "verify" })
    .orderBy("created_at", "desc")
    .first();
  assert(
    token && token.attempts < 5 && token.expires_at > now(),
    422,
    "This code has expired. Request a new code.",
  );
  await db("auth_tokens").where({ id: token.id }).increment("attempts", 1);
  assert(
    token.token_hash === hashCode(code),
    422,
    "That verification code is incorrect.",
  );
  await db.transaction(async (k) => {
    const consumed = await k("auth_tokens")
      .where({ id: token.id })
      .where("attempts", "<=", 5)
      .delete();
    assert(consumed, 409, "This code was already used.");
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
  assert(!req.user.email_verified, 409, "Your email is already verified.");
  const recent = await db("auth_tokens")
    .where({ user_id: req.user.id, kind: "verify" })
    .where("created_at", ">", new Date(Date.now() - 60000).toISOString())
    .first();
  assert(!recent, 429, "Please wait a minute before requesting another code.");
  const code = String(randomInt(100000, 1000000));
  await db.transaction(async (k) => {
    await k("auth_tokens")
      .where({ user_id: req.user.id, kind: "verify" })
      .delete();
    await k("auth_tokens").insert({
      id: randomUUID(),
      user_id: req.user.id,
      kind: "verify",
      token_hash: hashCode(code),
      expires_at: new Date(Date.now() + 10 * 60000).toISOString(),
      created_at: now(),
    });
    await queueEmail(
      k,
      req.user.email,
      "Your verification code",
      `Your VS PartnerHub verification code is ${code}. It expires in 10 minutes.`,
      req.user.id,
    );
  });
  res.json({ ok: true, ...(config.demo ? { verificationCode: code } : {}) });
});
authRouter.post("/forgot-password", authLimit, async (req, res) => {
  const input = z.object({ email }).parse(req.body);
  const user = await db("users")
    .where({ email: input.email, active: true })
    .first();
  if (user) {
    const token = secret();
    await db.transaction(async (k) => {
      await k("auth_tokens")
        .where({ user_id: user.id, kind: "reset" })
        .delete();
      await k("auth_tokens").insert({
        id: randomUUID(),
        user_id: user.id,
        kind: "reset",
        token_hash: hashToken(token),
        expires_at: new Date(Date.now() + 30 * 60000).toISOString(),
        created_at: now(),
      });
      await queueEmail(
        k,
        user.email,
        "Reset your VS PartnerHub password",
        `Reset your password: ${config.appUrl}/reset-password?token=${token}\n\nThis link expires in 30 minutes. If you did not request it, ignore this email.`,
        user.id,
      );
    });
  }
  res.json({
    message:
      "If this email is registered, a password reset link has been sent.",
  });
});
authRouter.post("/reset-password", authLimit, async (req, res) => {
  const data = z
    .object({ token: z.string().length(64), password })
    .parse(req.body);
  const passwordHash = await hashPassword(data.password);
  await db.transaction(async (k) => {
    const token = await k("auth_tokens")
      .where({ token_hash: hashToken(data.token), kind: "reset" })
      .where("expires_at", ">", now())
      .first();
    assert(token, 422, "This reset link has expired or has already been used.");
    const consumed = await k("auth_tokens").where({ id: token.id }).delete();
    assert(consumed, 409, "This reset link was already used.");
    await k("users")
      .where({ id: token.user_id })
      .update({ password_hash: passwordHash, updated_at: now() });
    await k("sessions").where({ user_id: token.user_id }).delete();
    await k("auth_tokens").where({ user_id: token.user_id }).delete();
    await audit(k, await getUser(token.user_id, k), "password_reset", "auth");
  });
  res.clearCookie("ph_session", { path: "/" });
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
    const hash = await hashPassword(data.password);
    await db.transaction(async (k) => {
      await k("users")
        .where({ id: user.id })
        .update({ password_hash: hash, updated_at: now() });
      await k("sessions").where({ user_id: user.id }).delete();
      await k("auth_tokens")
        .where({ user_id: user.id })
        .whereIn("kind", ["reset", "login"])
        .delete();
      await audit(k, req.user, "password_changed", "auth");
    });
    res.json({ ok: true, csrfToken: await createSession(res, user.id) });
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
  const user = await db("users").where({ id: req.user.id }).first();
  assert(
    req.user.email_verified,
    422,
    "Verify your email before enabling sign-in codes.",
  );
  assert(
    config.demo || config.smtp.host || !data.enabled,
    422,
    "Configure the email provider before enabling email sign-in codes.",
  );
  assert(
    await verifyPassword(data.current_password, user.password_hash),
    422,
    "Your current password is incorrect.",
  );
  await db.transaction(async (k) => {
    await k("users")
      .where({ id: user.id })
      .update({
        preferences: JSON.stringify({
          ...parseJson(user.preferences),
          mfa: data.enabled,
        }),
        updated_at: now(),
      });
    await k("sessions")
      .where({ user_id: user.id })
      .whereNot("id", req.sessionId)
      .delete();
    await k("auth_tokens").where({ user_id: user.id, kind: "login" }).delete();
    await audit(
      k,
      req.user,
      data.enabled ? "mfa_enabled" : "mfa_disabled",
      "auth",
    );
  });
  res.json({ ok: true, mfa: data.enabled });
});
authRouter.get("/invitation/:token", authLimit, async (req, res) => {
  const token = z.string().length(64).parse(req.params.token);
  const invite = await db("invitations")
    .where({ token_hash: hashToken(token), accepted_at: null })
    .where("expires_at", ">", now())
    .first();
  assert(invite, 404, "This invitation has expired or was already accepted.");
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
    const consumed = await k("invitations")
      .where({ id: invitation.id, accepted_at: null })
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
  });
  res.status(201).json({
    user: await getUser(userId),
    csrfToken: await createSession(res, userId),
  });
});
