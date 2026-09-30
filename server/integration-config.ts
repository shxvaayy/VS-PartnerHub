import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { db, now, type Database } from "./db.js";
import { config } from "./config.js";

const encryptionKey = () =>
  createHash("sha256")
    .update(
      process.env.INTEGRATION_ENCRYPTION_KEY ||
        `${config.sessionSecret}:integration-settings:v1`,
    )
    .digest();
export function encryptSecret(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}
export function decryptSecret<T>(value: string): T {
  const [version, iv, tag, encrypted] = value.split(":");
  if (version !== "v1" || !encrypted)
    throw new Error("Unsupported integration configuration.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64")),
      decipher.final(),
    ]).toString("utf8"),
  );
}
export async function readIntegration<T extends object>(
  key: string,
  defaults: T,
  k: Database = db,
): Promise<T> {
  const row = await k("integration_settings").where({ key }).first();
  return row
    ? { ...defaults, ...decryptSecret<T>(row.encrypted_value) }
    : defaults;
}
export async function writeIntegration(
  key: string,
  value: object,
  userId: string,
) {
  await db("integration_settings")
    .insert({
      key,
      encrypted_value: encryptSecret(value),
      updated_by: userId,
      updated_at: now(),
    })
    .onConflict("key")
    .merge({
      encrypted_value: encryptSecret(value),
      updated_by: userId,
      updated_at: now(),
      checked_at: null,
      check_status: null,
    });
}
export interface EmailConfiguration {
  enabled: boolean;
  provider: "smtp" | "resend";
  from: string;
  replyTo: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  apiKey: string;
  webhookSecret: string;
}
export const emailConfiguration = (k: Database = db) =>
  readIntegration<EmailConfiguration>(
    "email",
    {
      enabled: Boolean(config.smtp.host || process.env.RESEND_API_KEY),
      provider: process.env.RESEND_API_KEY ? "resend" : "smtp",
      from: config.smtp.from,
      replyTo: process.env.MAIL_REPLY_TO || "",
      host: config.smtp.host || "",
      port: config.smtp.port,
      secure: config.smtp.secure,
      username: config.smtp.user || "",
      password: config.smtp.password || "",
      apiKey: process.env.RESEND_API_KEY || "",
      webhookSecret: process.env.RESEND_WEBHOOK_SECRET || "",
    },
    k,
  );
export const emailConfigured = (c: EmailConfiguration) =>
  c.enabled && Boolean(c.from && (c.provider === "resend" ? c.apiKey : c.host));
export interface GeminiConfiguration {
  enabled: boolean;
  apiKey: string;
  model: string;
  dailyLimit: number;
}
export const geminiConfiguration = (k: Database = db) =>
  readIntegration<GeminiConfiguration>(
    "gemini",
    {
      enabled: Boolean(process.env.GEMINI_API_KEY),
      apiKey: process.env.GEMINI_API_KEY || "",
      model: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
      dailyLimit: Number(process.env.GEMINI_DAILY_USER_LIMIT || 100),
    },
    k,
  );
