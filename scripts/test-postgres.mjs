import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const root = mkdtempSync(path.join(tmpdir(), "partnerhub-postgres-"));
const data = path.join(root, "database"),
  log = path.join(root, "postgres.log");
const bin = process.env.PG_BIN || "/opt/homebrew/opt/postgresql@18/bin";
const port = process.env.PG_TEST_PORT || "55437";
let started = false;
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "pipe",
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0)
    throw new Error(
      `${path.basename(command)} failed: ${result.stderr || result.stdout || result.error}`,
    );
  return result;
}
try {
  run(path.join(bin, "initdb"), [
    "-D",
    data,
    "-A",
    "trust",
    "-U",
    "partnerhub",
    "--no-locale",
    "-E",
    "UTF8",
  ]);
  run(path.join(bin, "pg_ctl"), [
    "-D",
    data,
    "-l",
    log,
    "-o",
    `-h 127.0.0.1 -p ${port} -k ${root} -F`,
    "-w",
    "start",
  ]);
  started = true;
  run(path.join(bin, "createdb"), [
    "-h",
    "127.0.0.1",
    "-p",
    port,
    "-U",
    "partnerhub",
    "partnerhub_test",
  ]);
  console.log(
    `Running the full suite against isolated PostgreSQL on port ${port}.`,
  );
  const result = spawnSync(
    "npm",
    [
      "test",
      "--",
      "--reporter=json",
      "--outputFile=artifacts/local-verification/backend-postgres.json",
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        TEST_DATABASE_URL: `postgresql://partnerhub@127.0.0.1:${port}/partnerhub_test`,
      },
    },
  );
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error.message);
  if (existsSync(log)) console.error(readFileSync(log, "utf8").slice(-3000));
  process.exitCode = 1;
} finally {
  if (started)
    run(path.join(bin, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]);
  rmSync(root, { recursive: true, force: true });
}
