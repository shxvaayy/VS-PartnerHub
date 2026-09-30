import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { db, migrate, now } from "./db.js";
import { config, INTERNAL_ORG_ID } from "./config.js";
import { ensureInternalOrganization, seed } from "./seed.js";
import { hashPassword } from "./security.js";
import { email, password } from "./validation.js";
import { maintenance } from "./maintenance.js";
import { audit } from "./events.js";
try {
  await migrate();
  await ensureInternalOrganization();
  const command = process.argv[2];
  if (command === "migrate") console.log("Database migrations complete.");
  else if (command === "seed") {
    await seed();
    console.log("Local demo workspace is ready.");
  } else if (command === "admin") {
    const address = email.parse(process.env.ADMIN_EMAIL),
      pass = password.parse(process.env.ADMIN_PASSWORD);
    if (await db("users").where({ email: address }).first())
      throw new Error("This administrator email already exists.");
    const id = randomUUID();
    await db("users").insert({
      id,
      name: process.env.ADMIN_NAME || "Platform Administrator",
      email: address,
      password_hash: await hashPassword(pass),
      role: "super_admin",
      organization_id: INTERNAL_ORG_ID,
      email_verified: true,
      active: true,
      created_at: now(),
      updated_at: now(),
    });
    await audit(db, null, "administrator_bootstrapped", "team", { id });
    console.log(
      `Administrator created: ${address}. Remove ADMIN_PASSWORD from your environment.`,
    );
  } else if (command === "backup") {
    if (config.databaseUrl)
      throw new Error(
        "For PostgreSQL, use pg_dump and back up UPLOAD_DIR. See docs/OPERATIONS.md.",
      );
    await mkdir("backups", { recursive: true });
    const target = path.resolve(
      "backups",
      `partnerhub-${now().replaceAll(":", "-")}.sqlite`,
    );
    await db.raw("VACUUM INTO ?", [target]);
    console.log(
      `Consistent SQLite backup: ${target}. Back up the uploads directory alongside it.`,
    );
  } else if (command === "maintenance") {
    await maintenance();
    console.log("Expiry notifications and retention maintenance complete.");
  } else throw new Error("Use migrate, seed, admin, backup or maintenance.");
} finally {
  await db.destroy();
}
