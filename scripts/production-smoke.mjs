import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const directory = await mkdtemp(path.join(tmpdir(), "partnerhub-production-"));
const application = path.resolve("build/server/index.js");
const cli = path.resolve("build/server/cli.js");
const base = "http://127.0.0.1:4105";
const env = {
  ...process.env,
  NODE_ENV: "production",
  DEMO_MODE: "true", // Production must override this deliberately unsafe setting.
  DATABASE_URL: "",
  SQLITE_PATH: path.join(directory, "production.sqlite"),
  UPLOAD_DIR: path.join(directory, "uploads"),
  APP_URL: "https://partnerhub.example.test",
  SESSION_SECRET: randomBytes(32).toString("hex"),
  ADMIN_EMAIL: "smoke.admin@example.test",
  ADMIN_PASSWORD: `Smoke${randomBytes(20).toString("hex")}1!`,
  ADMIN_NAME: "Production Smoke Administrator",
  HOST: "127.0.0.1",
  PORT: "4105",
  SMTP_HOST: "",
};
let child;
let output = "";
async function start() {
  child = spawn(process.execPath, [application], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (data) => {
    output = (output + data).slice(-8000);
  });
  child.stderr.on("data", (data) => {
    output = (output + data).slice(-8000);
  });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null)
      throw new Error(`Production server exited: ${output}`);
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Production server did not become healthy: ${output}`);
}
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode) return;
  const running = child;
  await new Promise((resolve) => {
    const timer = setTimeout(() => running.kill("SIGKILL"), 12000);
    running.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    running.kill("SIGTERM");
  });
}
try {
  for (const settings of [
    { SESSION_SECRET: "too-short" },
    { APP_URL: "http://unsafe.example.test" },
  ]) {
    const rejected = spawnSync(process.execPath, [cli, "migrate"], {
      env: { ...env, ...settings },
      encoding: "utf8",
    });
    assert.notEqual(
      rejected.status,
      0,
      "Unsafe production configuration must be rejected.",
    );
  }
  const bootstrapped = spawnSync(process.execPath, [cli, "admin"], {
    env,
    encoding: "utf8",
  });
  assert.equal(bootstrapped.status, 0, bootstrapped.stderr);
  await start();
  const session = await (await fetch(`${base}/api/auth/session`)).json();
  assert.equal(session.demo, false);
  assert.equal(session.user, null);
  const response = await fetch(base);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  assert.match(
    response.headers.get("strict-transport-security"),
    /max-age=31536000/,
  );
  assert.match(html, /VS PartnerHub/);
  const asset = html.match(/src="(\/assets\/[^\"]+\.js)"/);
  assert.ok(asset, "Compiled frontend entry must be served.");
  assert.equal((await fetch(`${base}${asset[1]}`)).status, 200);
  const signedIn = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: env.ADMIN_EMAIL,
      password: env.ADMIN_PASSWORD,
    }),
  });
  assert.equal(signedIn.status, 200);
  const cookie = signedIn.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  const login = await signedIn.json();
  assert.equal(login.user.role, "super_admin");
  assert.equal(login.verificationCode, undefined);
  const headers = {
    Cookie: cookie.split(";")[0],
    "X-CSRF-Token": login.csrfToken,
    "Content-Type": "application/json",
  };
  const created = await fetch(`${base}/api/records/requirements`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: "Restart persistence verification",
      currency: "INR",
      items: [],
      invitations: [],
      payload: {
        requirement_type: "procurement",
        required_date: new Date(Date.now() + 30 * 86400000)
          .toISOString()
          .slice(0, 10),
      },
    }),
  });
  const record = await created.json();
  assert.equal(created.status, 201, JSON.stringify(record));
  await stop();
  await start();
  const persisted = await fetch(
    `${base}/api/records/requirements/${record.id}`,
    { headers },
  );
  assert.equal(
    persisted.status,
    200,
    "Session and record must survive restart.",
  );
  assert.equal((await persisted.json()).title, record.title);
  const demo = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@vs.example",
      password: "PartnerHub@2026",
    }),
  });
  assert.equal(demo.status, 401, "Production must not seed demo credentials.");
  const backup = spawnSync(process.execPath, [cli, "backup"], {
    env,
    cwd: directory,
    encoding: "utf8",
  });
  assert.equal(backup.status, 0, backup.stderr);
  const files = await readdir(path.join(directory, "backups"));
  assert.equal(files.length, 1);
  const snapshot = new Database(path.join(directory, "backups", files[0]), {
    readonly: true,
  });
  try {
    assert.equal(
      snapshot.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
    );
    assert.equal(
      snapshot.prepare("SELECT title FROM records WHERE id = ?").get(record.id)
        .title,
      record.title,
    );
    assert.equal(
      snapshot.prepare("SELECT count(*) AS n FROM users").get().n,
      1,
    );
  } finally {
    snapshot.close();
  }
  await stop();
  env.SQLITE_PATH = path.join(directory, "backups", files[0]);
  await start();
  const restored = await fetch(
    `${base}/api/records/requirements/${record.id}`,
    { headers },
  );
  assert.equal(
    restored.status,
    200,
    "The application must boot and authenticate from the backup.",
  );
  assert.equal((await restored.json()).id, record.id);
  console.log(
    "Production smoke passed: configuration guards, compiled assets, headers, secure cookies, demo suppression, persistent restart and restorable SQLite backup.",
  );
} finally {
  await stop();
  await rm(directory, { recursive: true, force: true });
}
