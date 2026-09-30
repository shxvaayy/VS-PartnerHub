import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import fs from "node:fs/promises";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import net from "node:net";
import { parseArgs } from "node:util";
import { Client } from "pg";

const { values } = parseArgs({
  options: {
    fixture: { type: "boolean" },
    input: { type: "string" },
    key: { type: "string" },
    credentials: { type: "string" },
    output: {
      type: "string",
      default: "artifacts/recovery-verification/restore.json",
    },
  },
});
assert(
  values.fixture || (values.input && values.key && values.credentials),
  "Use --fixture or provide --input, --key and --credentials (private JSON with email/password).",
);
assert(
  !(values.fixture && (values.input || values.key || values.credentials)),
  "Do not mix synthetic-fixture and existing-backup modes.",
);
const root = await fs.mkdtemp(path.join(tmpdir(), "partnerhub-restore-drill-"));
await fs.chmod(root, 0o700);
const bin =
  process.env.PG_BIN ||
  (existsSync("/opt/homebrew/opt/postgresql@18/bin")
    ? "/opt/homebrew/opt/postgresql@18/bin"
    : "");
const executable = (name) => (bin ? path.join(bin, name) : name);
const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");
const startedAt = new Date().toISOString();
const start = performance.now();
const checks = [],
  tables = [],
  limitations = [],
  blockedRequests = [];
let clusterStarted = false,
  sql,
  appDb,
  server,
  nativeFetch = globalThis.fetch;
const localPassword = randomBytes(32).toString("hex");
const localUser = "partnerhub_recovery";
const data = path.join(root, "pg-data");
let archive = values.input,
  keyFile = values.key,
  credentials;
let fixtureBackupMs, manifest, pgPort, base;
function command(name, args, env = process.env) {
  const result = spawnSync(name, args, {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    if (values.fixture) {
      mkdirSync(".local", { recursive: true, mode: 0o700 });
      writeFileSync(
        ".local/recovery-fixture-diagnostics.log",
        result.stderr || String(result.error || ""),
        { mode: 0o600 },
      );
    }
    throw new Error(
      `${path.basename(name)} failed during the isolated restore drill (exit ${result.status}). Check PostgreSQL client availability/version and local disk capacity.`,
    );
  }
  return result;
}
async function unusedPort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}
function check(name, operation) {
  return Promise.resolve()
    .then(operation)
    .then(() => checks.push({ name, passed: true }));
}
function url(database) {
  return `postgresql://${localUser}:${localPassword}@127.0.0.1:${pgPort}/${database}`;
}
const quote = (name) => `"${name.replaceAll('"', '""')}"`;
try {
  pgPort = await unusedPort();
  const passwordFile = path.join(root, "pg-password");
  await fs.writeFile(passwordFile, localPassword + "\n", { mode: 0o600 });
  command(executable("initdb"), [
    "-D",
    data,
    "--auth-local=trust",
    "--auth-host=scram-sha-256",
    "-U",
    localUser,
    "--pwfile",
    passwordFile,
    "--no-locale",
    "-E",
    "UTF8",
  ]);
  command(executable("pg_ctl"), [
    "-D",
    data,
    "-l",
    path.join(root, "postgres.log"),
    "-o",
    `-h 127.0.0.1 -p ${pgPort} -k ${root}`,
    "-w",
    "start",
  ]);
  clusterStarted = true;
  const admin = new Client({ connectionString: url("postgres") });
  await admin.connect();
  try {
    if (values.fixture)
      await admin.query("CREATE DATABASE partnerhub_source_fixture");
    await admin.query("CREATE DATABASE partnerhub_restored");
  } finally {
    await admin.end();
  }
  // Every source/target below is created in this new loopback-only cluster.
  // Never accept DATABASE_URL as a destination, and never use pg_restore --clean.
  const isolatedEnv = {
    ...process.env,
    DOTENV_CONFIG_PATH: path.join(root, "no-environment-file"),
    NODE_ENV: "production",
    VERCEL: "0",
    DEMO_MODE: "false",
    APP_URL: "https://restore.partnerhub.example",
    SESSION_SECRET: randomBytes(48).toString("hex"),
    DATABASE_URL: url("partnerhub_restored"),
    DATABASE_SSL: "false",
    FILE_STORAGE: "local",
    UPLOAD_DIR: path.join(root, "restore", "uploads"),
    SMTP_HOST: "",
    SMTP_USER: "",
    SMTP_PASSWORD: "",
    MAIL_FROM: "",
    MAIL_REPLY_TO: "",
    RESEND_API_KEY: "",
    RESEND_WEBHOOK_SECRET: "",
    GEMINI_API_KEY: "",
    BLOB_READ_WRITE_TOKEN: "",
    CRON_SECRET: "",
    INTEGRATION_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  };
  if (values.fixture) {
    const uploadDir = path.join(root, "fixture-uploads");
    command(process.execPath, ["--import", "tsx", "server/cli.ts", "seed"], {
      ...isolatedEnv,
      NODE_ENV: "test",
      DEMO_MODE: "true",
      DATABASE_URL: url("partnerhub_source_fixture"),
      UPLOAD_DIR: uploadDir,
    });
    keyFile = path.join(root, "fixture.key");
    archive = path.join(root, "fixture.vshub");
    command(
      process.execPath,
      ["--import", "tsx", "server/recovery-cli.ts", "keygen", "--key", keyFile],
      isolatedEnv,
    );
    const beforeBackup = performance.now();
    command(
      process.execPath,
      [
        "--import",
        "tsx",
        "server/recovery-cli.ts",
        "backup",
        "--key",
        keyFile,
        "--output",
        archive,
      ],
      {
        ...isolatedEnv,
        DATABASE_URL: url("partnerhub_source_fixture"),
        UPLOAD_DIR: uploadDir,
        BACKUP_REVISION: "isolated-recovery-fixture",
        PG_BIN: bin,
      },
    );
    fixtureBackupMs = Math.round(performance.now() - beforeBackup);
    const { demoAccounts, demoPassword } = await import("../shared/demo.ts");
    credentials = {
      email: demoAccounts.find((account) => account.key === "admin").email,
      password: demoPassword,
    };
  } else
    credentials = JSON.parse(await fs.readFile(values.credentials, "utf8"));
  const destination = path.join(root, "restore");
  command(
    process.execPath,
    [
      "--import",
      "tsx",
      "server/recovery-cli.ts",
      "unpack",
      "--input",
      archive,
      "--key",
      keyFile,
      "--destination",
      destination,
    ],
    isolatedEnv,
  );
  const restored = {
    destination,
    manifest: JSON.parse(
      await fs.readFile(path.join(destination, "manifest.json"), "utf8"),
    ),
  };
  manifest = restored.manifest;
  assert.equal(
    manifest.database.engine,
    "postgres",
    "This drill verifies PostgreSQL archives.",
  );
  checks.push({
    name: "Authenticated archive and verified database/private-file sizes and SHA-256 hashes",
    passed: true,
  });
  const emptyTarget = new Client({
    connectionString: url("partnerhub_restored"),
  });
  await emptyTarget.connect();
  try {
    const count = (
      await emptyTarget.query(
        "SELECT count(*)::int AS n FROM pg_catalog.pg_tables WHERE schemaname = 'public'",
      )
    ).rows[0].n;
    assert.equal(count, 0, "The freshly created restore target must be empty.");
    // pg_dump preserves CREATE SCHEMA public. Remove only the empty default
    // schema in our newly created database; never use CASCADE or --clean.
    await emptyTarget.query("DROP SCHEMA public");
  } finally {
    await emptyTarget.end();
  }
  command(
    executable("pg_restore"),
    [
      "--exit-on-error",
      "--single-transaction",
      "--no-owner",
      "--no-privileges",
      "--dbname=partnerhub_restored",
      path.join(restored.destination, "database.dump"),
    ],
    {
      PATH: process.env.PATH,
      PGHOST: "127.0.0.1",
      PGPORT: String(pgPort),
      PGUSER: localUser,
      PGPASSWORD: localPassword,
      PGSSLMODE: "disable",
    },
  );
  sql = new Client({ connectionString: url("partnerhub_restored") });
  await sql.connect();
  await check(
    "All restored table counts match the captured snapshot",
    async () => {
      const actual = (
        await sql.query(
          "SELECT tablename AS name FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename",
        )
      ).rows.map((row) => row.name);
      assert.deepEqual(
        actual,
        manifest.database.tables.map((table) => table.name).sort(),
      );
      for (const table of manifest.database.tables) {
        const count = (
          await sql.query(
            `SELECT count(*)::text AS n FROM public.${quote(table.name)}`,
          )
        ).rows[0].n;
        assert.equal(
          count,
          table.rows,
          `Restored count differs for ${table.name}`,
        );
        tables.push({ name: table.name, rows: count });
      }
      const invalid = await sql.query(
        "SELECT count(*)::int AS n FROM pg_index WHERE NOT indisvalid",
      );
      assert.equal(invalid.rows[0].n, 0, "Restored indexes must be valid.");
    },
  );
  const docs = (
    await sql.query(
      "SELECT id, organization_id, record_id, storage_key, size FROM documents",
    )
  ).rows;
  const logos = (
    await sql.query(
      "SELECT id, logo_key FROM organizations WHERE logo_key IS NOT NULL AND logo_key <> ''",
    )
  ).rows;
  await check(
    "Every finalized document/logo reference resolves to its restored file",
    async () => {
      assert.deepEqual(
        [
          ...docs.map((row) => row.storage_key),
          ...logos.map((row) => row.logo_key),
        ].sort(),
        manifest.files.map((file) => file.key).sort(),
      );
      for (const doc of docs)
        assert.equal(
          manifest.files.find((file) => file.key === doc.storage_key).size,
          Number(doc.size),
        );
    },
  );
  const recordRows = (
    await sql.query(
      "SELECT DISTINCT ON (kind) id, kind, title, status, number FROM records ORDER BY kind, created_at DESC",
    )
  ).rows;
  if (!recordRows.length)
    limitations.push(
      "This source snapshot has no business transactions. Record-chain restoration is covered separately with isolated fixtures, not claimed for absent production records.",
    );
  if (!docs.length)
    limitations.push(
      "This source snapshot contains no finalized documents to download.",
    );
  if (!logos.length)
    limitations.push(
      "This source snapshot contains no organization logos; logo-byte recovery is covered by the regression fixture.",
    );
  // Disable cloned outbound credentials/queues AFTER comparing the original
  // snapshot. Do not modify the original encrypted archive or live database.
  await sql.query("BEGIN");
  try {
    for (const table of [
      "integration_settings",
      "email_outbox",
      "webhook_deliveries",
      "sessions",
      "auth_tokens",
      "auth_attempts",
      "document_uploads",
      "job_leases",
    ])
      await sql.query(`DELETE FROM ${quote(table)}`);
    await sql.query("UPDATE webhook_endpoints SET active = false");
    await sql.query("UPDATE integration_tokens SET active = false");
    await sql.query("COMMIT");
  } catch (error) {
    await sql.query("ROLLBACK");
    throw error;
  }
  Object.assign(process.env, isolatedEnv);
  const { createApp } = await import("../server/app.ts");
  const { db } = await import("../server/db.ts");
  appDb = db;
  const app = createApp(); // Intentionally never import server/index.ts or run maintenance.
  server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    listener.once("error", reject);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  globalThis.fetch = async (input, init) => {
    const address =
      typeof input === "string" || input instanceof URL
        ? new URL(input)
        : new URL(input.url);
    if (address.origin !== base) {
      blockedRequests.push(address.origin);
      throw new Error(
        "External HTTP delivery is disabled in the recovery drill.",
      );
    }
    return nativeFetch(input, init);
  };
  let headers, account;
  await check(
    "Restored application health and existing password login",
    async () => {
      assert.equal((await fetch(base + "/api/health")).status, 200);
      const response = await fetch(base + "/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: isolatedEnv.APP_URL,
        },
        body: JSON.stringify(credentials),
      });
      assert.equal(
        response.status,
        200,
        "The supplied existing account must sign into the restored database. MFA delivery stays disabled in a drill.",
      );
      account = await response.json();
      assert.equal(
        Boolean(account.requiresOtp),
        false,
        "Use an authorized password account; do not bypass MFA or enable outbound email for a rehearsal.",
      );
      assert(
        account.user?.internal &&
          account.user?.permissions?.audit?.includes("view"),
        "Use an authorized internal review account.",
      );
      const cookie = response.headers.get("set-cookie");
      assert(cookie?.includes("Secure"));
      headers = {
        Cookie: cookie.split(";")[0],
        Origin: isolatedEnv.APP_URL,
        "X-CSRF-Token": account.csrfToken,
      };
      const session = await (
        await fetch(base + "/api/auth/session", { headers })
      ).json();
      assert.equal(session.user.id, account.user.id);
      const role = (
        await sql.query("SELECT permissions FROM roles WHERE id = $1", [
          account.user.role,
        ])
      ).rows[0];
      assert.deepEqual(account.user.permissions, JSON.parse(role.permissions));
    },
  );
  await check(
    "Dashboard, document list and audit API read restored data",
    async () => {
      for (const route of [
        "/api/dashboard",
        "/api/documents",
        "/api/admin/audit",
      ])
        assert.equal(
          (await fetch(base + route, { headers })).status,
          200,
          `Restored API failed: ${route}`,
        );
    },
  );
  for (const record of recordRows) {
    if (!account.user.permissions[record.kind]?.includes("view")) continue;
    await check(`Restored ${record.kind} record and history API`, async () => {
      const response = await fetch(
        `${base}/api/records/${record.kind}/${record.id}`,
        { headers },
      );
      assert.equal(response.status, 200);
      const item = await response.json();
      for (const field of ["id", "number", "title", "status"])
        assert.equal(item[field], record[field]);
      assert.equal(
        (
          await fetch(
            `${base}/api/records/${record.kind}/${record.id}/history`,
            { headers },
          )
        ).status,
        200,
      );
    });
  }
  if (docs.length)
    await check(
      "Authorized private downloads match backup hashes; anonymous requests are denied",
      async () => {
        for (const document of docs) {
          const route = `${base}/api/documents/${document.id}/download`;
          assert.equal((await fetch(route)).status, 401);
          const response = await fetch(route, { headers });
          assert.equal(response.status, 200);
          const bytes = Buffer.from(await response.arrayBuffer());
          const expected = manifest.files.find(
            (file) => file.key === document.storage_key,
          );
          assert.equal(bytes.length, expected.size);
          assert.equal(hash(bytes), expected.sha256);
        }
      },
    );
  await check(
    "No external delivery or scheduled maintenance ran during the rehearsal",
    async () => {
      assert.deepEqual(blockedRequests, []);
      for (const table of ["email_outbox", "webhook_deliveries", "job_leases"])
        assert.equal(
          (await sql.query(`SELECT count(*)::int AS n FROM ${quote(table)}`))
            .rows[0].n,
          0,
        );
      assert.equal((await fetch(base + "/api/jobs/maintenance")).status, 401);
    },
  );
} catch (error) {
  checks.push({
    name: "Isolated PostgreSQL restore drill",
    passed: false,
    error: error.code
      ? `Operation failed (${error.code}); inspect source/target access and local tools.`
      : error.message,
  });
  process.exitCode = 1;
} finally {
  globalThis.fetch = nativeFetch;
  if (server) await new Promise((resolve) => server.close(resolve));
  await appDb?.destroy();
  await sql?.end();
  if (clusterStarted)
    command(executable("pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]);
  await fs.rm(root, { recursive: true, force: true });
  const report = {
    startedAt,
    checkedAt: new Date().toISOString(),
    elapsedMs: Math.round(performance.now() - start),
    source: values.fixture
      ? "Synthetic fixtures in an isolated local PostgreSQL database"
      : "Existing encrypted PostgreSQL/private-file snapshot",
    fixtureBackupMs,
    sourceRevision: manifest?.revision,
    productionMutations: false,
    temporaryRestoreRemoved: true,
    outboundDeliveryDisabled: true,
    tables,
    documentFiles:
      manifest?.files.filter((file) => file.kind === "document").length || 0,
    logoFiles:
      manifest?.files.filter((file) => file.kind === "logo").length || 0,
    checks,
    passed: checks.filter((item) => item.passed).length,
    failed: checks.filter((item) => !item.passed).length,
    limitations: [
      ...limitations,
      "Local isolated recovery measurement, not an off-site recovery SLA or configured backup schedule.",
    ],
  };
  await fs.mkdir(path.dirname(values.output), { recursive: true });
  await fs.writeFile(values.output, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        failed: report.failed,
        elapsedMs: report.elapsedMs,
        tables: tables.length,
        documents: report.documentFiles,
        report: path.resolve(values.output),
        failures: checks.filter((item) => !item.passed),
      },
      null,
      2,
    ),
  );
}
