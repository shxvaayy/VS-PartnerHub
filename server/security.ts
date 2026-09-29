import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
  createHmac,
} from "node:crypto";
import { promisify } from "node:util";
import type { RequestHandler, Response } from "express";
import { db, now, parseJson, type Database } from "./db.js";
import { config } from "./config.js";
import { assert } from "./errors.js";
import {
  externalModules,
  type Action,
  type Module,
  type SessionUser,
  type Organization,
} from "../shared/domain.js";
const scrypt = promisify(scryptCallback);
export const secret = () => randomBytes(32).toString("hex");
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const hashCode = (code: string) =>
  createHmac("sha256", config.sessionSecret).update(code).digest("hex");
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${hash.toString("hex")}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [, salt, value] = stored.split(":");
  const hash = (await scrypt(
    password,
    salt || "invalid-password-salt",
    64,
  )) as Buffer;
  const expected = value ? Buffer.from(value, "hex") : Buffer.alloc(64);
  return (
    hash.length === expected.length &&
    timingSafeEqual(hash, expected) &&
    Boolean(value)
  );
}
export function serializeOrg(org: any): Organization {
  return { ...org, details: parseJson(org.details) };
}
export async function getUser(
  id: string,
  k: Database = db,
): Promise<SessionUser | null> {
  const raw = await k("users")
    .join("roles", "users.role", "roles.id")
    .where("users.id", id)
    .where("users.active", true)
    .select("users.*", "roles.internal", "roles.permissions")
    .first();
  if (!raw) return null;
  const org = raw.organization_id
    ? await k("organizations").where({ id: raw.organization_id }).first()
    : null;
  const permissions = parseJson(raw.permissions);
  if (!raw.internal && org)
    for (const key of Object.keys(permissions)) {
      if (
        Object.prototype.hasOwnProperty.call(externalModules, org.type) &&
        !externalModules[org.type as keyof typeof externalModules].includes(
          key as Module,
        ) &&
        [
          "requirements",
          "rfqs",
          "quotations",
          "orders",
          "deliveries",
          "contracts",
          "invoices",
          "payments",
          "catalog",
          "candidates",
          "interviews",
          "engagements",
          "timesheets",
          "milestones",
          "demos",
          "performance",
        ].includes(key)
      )
        delete permissions[key];
      if (key === "discovery" && org.type !== "client") delete permissions[key];
    }
  return {
    id: raw.id,
    name: raw.name,
    email: raw.email,
    role: raw.role,
    internal: Boolean(raw.internal),
    email_verified: Boolean(raw.email_verified),
    organization_id: raw.organization_id,
    organization: org ? serializeOrg(org) : null,
    permissions,
  };
}
declare global {
  namespace Express {
    interface Request {
      user: SessionUser;
      csrfToken: string;
      sessionId: string;
    }
  }
}
export const sessionMiddleware: RequestHandler = async (req, _res, next) => {
  try {
    const token = req.cookies?.ph_session;
    if (typeof token === "string" && token.length === 64) {
      const session = await db("sessions")
        .where({ id: hashToken(token) })
        .where("expires_at", ">", now())
        .first();
      if (session) {
        const user = await getUser(session.user_id);
        if (user) {
          req.user = user;
          req.csrfToken = session.csrf_token;
          req.sessionId = session.id;
        }
      }
    }
    next();
  } catch (e) {
    next(e);
  }
};
export const authenticated: RequestHandler = (req, _res, next) => {
  try {
    assert(req.user, 401, "Sign in to continue.");
    next();
  } catch (e) {
    next(e);
  }
};
export const csrf: RequestHandler = (req, _res, next) => {
  try {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.get("origin");
      const allowed = new Set([
        new URL(config.appUrl).origin,
        ...(!config.production
          ? ["http://localhost:5173", "http://127.0.0.1:5173"]
          : []),
      ]);
      assert(
        !origin || allowed.has(origin),
        403,
        "This request came from an untrusted origin.",
      );
      if (req.user) {
        const token = req.get("x-csrf-token") || "";
        assert(
          token.length === req.csrfToken.length &&
            timingSafeEqual(Buffer.from(token), Buffer.from(req.csrfToken)),
          403,
          "Your session changed. Refresh the page and try again.",
        );
      }
    }
    next();
  } catch (e) {
    next(e);
  }
};
export const can = (
  user: SessionUser,
  module: string,
  action: Action = "view",
) => Boolean(user.permissions[module]?.includes(action));
export function permit(
  module: string,
  action: Action = "view",
): RequestHandler {
  return (req, _res, next) => {
    try {
      assert(req.user, 401, "Sign in to continue.");
      assert(
        can(req.user, module, action),
        403,
        "Your role does not have access to this action.",
      );
      next();
    } catch (e) {
      next(e);
    }
  };
}
export function assertActive(user: SessionUser) {
  assert(user.email_verified, 403, "Verify your email before continuing.");
  assert(
    user.internal || user.organization?.status === "active",
    403,
    user.organization?.status === "suspended"
      ? "Your organization is suspended. Contact support for assistance."
      : "Your organization needs VS approval before you can transact.",
  );
}
export async function createSession(
  res: Response,
  userId: string,
  k: Database = db,
) {
  const token = secret();
  const csrfToken = secret();
  await k("sessions").insert({
    id: hashToken(token),
    user_id: userId,
    csrf_token: csrfToken,
    expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
    created_at: now(),
  });
  res.cookie("ph_session", token, {
    httpOnly: true,
    secure: config.production,
    sameSite: "lax",
    path: "/",
    maxAge: 12 * 60 * 60 * 1000,
  });
  return csrfToken;
}
