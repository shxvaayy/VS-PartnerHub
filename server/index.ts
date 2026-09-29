import { config } from "./config.js";
import { db, migrate } from "./db.js";
import { createApp } from "./app.js";
import { seed, ensureInternalOrganization } from "./seed.js";
import { deliverEmails } from "./events.js";
import { maintenance } from "./maintenance.js";
await migrate();
await ensureInternalOrganization();
if (config.demo) await seed();
const server = createApp().listen(
  config.port,
  process.env.HOST || "127.0.0.1",
  () => {
    console.log(
      `VS PartnerHub API ready at http://127.0.0.1:${config.port}${config.demo ? " · local demo enabled" : ""}`,
    );
  },
);
const emailTimer = setInterval(
  () => deliverEmails().catch((e) => console.error("Email worker:", e.message)),
  15000,
);
const maintenanceTimer = setInterval(
  () => maintenance().catch((e) => console.error("Maintenance:", e.message)),
  60 * 60000,
);
await maintenance();
async function shutdown() {
  clearInterval(emailTimer);
  clearInterval(maintenanceTimer);
  server.close(async () => {
    await db.destroy();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
