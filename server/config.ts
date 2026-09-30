import "dotenv/config";
import path from "node:path";

const production = process.env.NODE_ENV === "production";
const serverless = process.env.VERCEL === "1";
const fileStorage = process.env.FILE_STORAGE || "local";
if (serverless && !process.env.DATABASE_URL)
  throw new Error("Vercel requires a persistent PostgreSQL DATABASE_URL.");
if (!["local", "blob"].includes(fileStorage))
  throw new Error("FILE_STORAGE must be local or blob.");
if (serverless && fileStorage !== "blob")
  throw new Error(
    "Vercel requires FILE_STORAGE=blob for persistent private files.",
  );
if (fileStorage === "blob" && !process.env.BLOB_READ_WRITE_TOKEN)
  throw new Error("Private file storage requires BLOB_READ_WRITE_TOKEN.");
const sessionSecret =
  process.env.SESSION_SECRET ||
  "local-development-secret-change-before-deploying";
if (
  production &&
  (!process.env.SESSION_SECRET ||
    sessionSecret.length < 32 ||
    /replace|local-development/i.test(sessionSecret))
)
  throw new Error("Set a unique SESSION_SECRET of at least 32 characters.");
const appUrl = process.env.APP_URL || "http://localhost:5173";
if (production && !appUrl.startsWith("https://"))
  throw new Error("APP_URL must use HTTPS in production.");
export const config = {
  production,
  serverless,
  fileStorage,
  blobToken: process.env.BLOB_READ_WRITE_TOKEN,
  demo: !production && process.env.DEMO_MODE === "true",
  port: Number(process.env.PORT || 4000),
  appUrl,
  sessionSecret,
  databaseUrl: process.env.DATABASE_URL,
  databaseSsl: process.env.DATABASE_SSL === "true",
  sqlitePath: path.resolve(
    process.env.SQLITE_PATH || "./data/partnerhub.sqlite",
  ),
  uploadDir: path.resolve(process.env.UPLOAD_DIR || "./uploads"),
  trustProxy: Number(process.env.TRUST_PROXY || 0),
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    from: process.env.MAIL_FROM || "",
  },
};
export const INTERNAL_ORG_ID = "00000000-0000-4000-8000-000000000001";
