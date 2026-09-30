import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { DatabaseRateLimitStore } from "./rate-limits.js";
import path from "node:path";
import { existsSync } from "node:fs";
import { config } from "./config.js";
import { db } from "./db.js";
import { csrf, sessionMiddleware } from "./security.js";
import { errorHandler } from "./errors.js";
import { authRouter } from "./auth.js";
import { organizationsRouter } from "./organizations.js";
import { recordsRouter } from "./records.js";
import { documentsRouter } from "./documents.js";
import { adminRouter } from "./admin.js";
import { dashboardRouter } from "./dashboard.js";
import { reportsRouter } from "./analytics.js";
import { aiRouter } from "./ai.js";
import { integrationsRouter, emailWebhook } from "./integrations.js";
import {
  businessIntegrationsRouter,
  integrationApiRouter,
} from "./business-integrations.js";
import { masterDataRouter } from "./master-data.js";
import { partnerOperationsRouter } from "./partner-operations.js";
import { importsRouter } from "./imports.js";
import { approvalsRouter } from "./approvals.js";
import { signaturesRouter } from "./signatures.js";
import { publicRouter, inquiriesRouter } from "./public.js";
import { insightsRouter } from "./insights.js";
import { jobsRouter, serverlessBackground } from "./jobs.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", config.trustProxy);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "blob:"],
          fontSrc: ["'self'"],
          connectSrc: [
            "'self'",
            // The browser SDK uploads through this API before private storage.
            "https://vercel.com/api/blob",
            "https://vercel.com/api/blob/",
            "https://blob.vercel-storage.com",
            "https://*.blob.vercel-storage.com",
          ],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: config.production ? [] : null,
        },
      },
      strictTransportSecurity: config.production
        ? { maxAge: 31536000, includeSubDomains: true }
        : false,
    }),
  );
  app.get("/api/health", async (_req, res) => {
    try {
      await db.raw("select 1");
      res.json({ status: "ok", service: "VS PartnerHub" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  app.use(
    "/api",
    rateLimit({
      store: new DatabaseRateLimitStore("api"),
      windowMs: 60000,
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      skip: () => process.env.NODE_ENV === "test",
      message: { error: "Too many requests. Please wait a minute." },
    }),
  );
  app.post(
    "/api/integrations/email/webhook",
    express.raw({ type: "application/json", limit: "128kb" }),
    emailWebhook,
  );
  app.use("/api/jobs", jobsRouter);
  app.use("/api", serverlessBackground);
  app.use(
    express.json({ limit: "2mb" }),
    cookieParser(),
    sessionMiddleware,
    csrf,
  );
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use("/api/auth", authRouter);
  app.use("/api/public", publicRouter);
  app.use("/api/inquiries", inquiriesRouter);
  app.use("/api/insights", insightsRouter);
  app.use("/api", partnerOperationsRouter);
  app.use("/api/master-data", masterDataRouter);
  app.use("/api/imports", importsRouter);
  app.use("/api/approvals", approvalsRouter);
  app.use("/api/signatures", signaturesRouter);
  app.use("/api/organizations", organizationsRouter);
  app.use("/api/records", recordsRouter);
  app.use("/api/documents", documentsRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/ai", aiRouter);
  app.use("/api/integrations", integrationsRouter);
  app.use("/api/integrations", businessIntegrationsRouter);
  app.use("/api/integration", integrationApiRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api", dashboardRouter);
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API route not found." });
  });
  const dist = path.resolve("dist");
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: "1h" }));
    app.get("/{*path}", (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(dist, "index.html"));
    });
  }
  app.use(errorHandler);
  return app;
}
