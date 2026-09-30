import { randomUUID, timingSafeEqual } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { waitUntil } from "@vercel/functions";
import { db, now } from "./db.js";
import { config } from "./config.js";
import { deliverEmails } from "./events.js";
import { deliverWebhooks } from "./webhooks.js";
import { maintenance } from "./maintenance.js";
import { assert } from "./errors.js";

export async function runLeasedJob(
  name: string,
  task: () => Promise<void>,
  intervalMs: number,
) {
  const owner = randomUUID(),
    at = now();
  await db("job_leases")
    .insert({
      name,
      owner,
      expires_at: at,
      next_run_at: at,
    })
    .onConflict("name")
    .ignore();
  const claimed = await db("job_leases")
    .where({ name })
    .where("expires_at", "<=", at)
    .where("next_run_at", "<=", at)
    .update({
      owner,
      expires_at: new Date(Date.now() + 10 * 60000).toISOString(),
    });
  if (!claimed) return false;
  try {
    await task();
    await db("job_leases")
      .where({ name, owner })
      .update({
        expires_at: now(),
        next_run_at: new Date(Date.now() + intervalMs).toISOString(),
      });
    return true;
  } catch (error) {
    await db("job_leases")
      .where({ name, owner })
      .update({
        expires_at: now(),
        next_run_at: new Date(Date.now() + 60000).toISOString(),
      });
    throw error;
  }
}

let nextMaintenanceCheck = 0;
async function scheduledMaintenance(forceCheck = false) {
  if (!forceCheck && Date.now() < nextMaintenanceCheck) return;
  nextMaintenanceCheck = Date.now() + 60000;
  await runLeasedJob("maintenance", maintenance, 60 * 60000);
}

export async function drainBackgroundWork(forceCheck = false) {
  const results = await Promise.allSettled([
    deliverEmails(),
    deliverWebhooks(),
    scheduledMaintenance(forceCheck),
  ]);
  if (results.some((result) => result.status === "rejected"))
    throw new Error(
      "A scheduled task failed; its database queue will be retried.",
    );
}

// Functions can freeze after sending a response. Explicitly retain background
// delivery rather than relying on Node setInterval timers in serverless hosts.
let nextDeliveryCheck = 0;
export const serverlessBackground: RequestHandler = (req, res, next) => {
  if (config.serverless)
    res.once("finish", () => {
      const mutation = !["GET", "HEAD", "OPTIONS"].includes(req.method);
      if (!mutation && Date.now() < nextDeliveryCheck) return;
      nextDeliveryCheck = Date.now() + 15000;
      waitUntil(
        drainBackgroundWork().catch(() => {
          console.error("Background work requires a retry.");
        }),
      );
    });
  next();
};

export const jobsRouter = Router();
jobsRouter.get("/maintenance", async (req, res) => {
  const expected = Buffer.from(process.env.CRON_SECRET || "");
  const provided = Buffer.from(
    (req.get("authorization") || "").replace(/^Bearer /, ""),
  );
  assert(
    expected.length >= 32 &&
      provided.length === expected.length &&
      timingSafeEqual(provided, expected),
    401,
    "Unauthorized.",
  );
  await drainBackgroundWork(true);
  res.json({ ok: true });
});
