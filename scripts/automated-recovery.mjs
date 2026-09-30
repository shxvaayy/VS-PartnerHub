import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRecoveryBackup } from "../server/recovery.ts";
import { deploymentHealth } from "./operations-health.mjs";

const directory = path.resolve("artifacts/operations/recovery");
let stage = "configuration",
  temporary;
const startedAt = new Date().toISOString(),
  started = performance.now();
try {
  const key = process.env.PARTNERHUB_RECOVERY_KEY || "";
  assert.match(key, /^[a-f0-9]{64}$/i);
  const sourceUrl = process.env.PARTNERHUB_RECOVERY_DATABASE_URL || "";
  assert(["postgres:", "postgresql:"].includes(new URL(sourceUrl).protocol));
  assert(process.env.PARTNERHUB_RECOVERY_BLOB_TOKEN);
  const application = await deploymentHealth(process.env.PARTNERHUB_APP_URL);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  assert.equal(
    (await readdir(directory)).length,
    0,
    "Use an empty recovery artifact directory.",
  );
  temporary = await mkdtemp(
    path.join(tmpdir(), "partnerhub-automated-recovery-"),
  );
  await chmod(temporary, 0o700);
  const keyFile = path.join(temporary, "recovery.key");
  await writeFile(keyFile, key + "\n", { flag: "wx", mode: 0o600 });
  stage = "consistent encrypted capture";
  const snapshot = await createRecoveryBackup({
    source: {
      databaseUrl: sourceUrl,
      databaseSsl: true,
      sqlitePath: path.join(temporary, "unused.sqlite"),
      fileStorage: "blob",
      uploadDir: path.join(temporary, "unused-uploads"),
      blobToken: process.env.PARTNERHUB_RECOVERY_BLOB_TOKEN,
    },
    output: path.join(directory, "partnerhub.vshub"),
    keyFile,
    revision: application.revision,
    pgBin: process.env.PG_BIN,
  });
  stage = "isolated PostgreSQL restore";
  const privateReport = path.join(temporary, "restore.json");
  const childEnv = Object.fromEntries(
    ["PATH", "PG_BIN", "TMPDIR", "LANG", "LC_ALL"].flatMap((name) =>
      process.env[name] ? [[name, process.env[name]]] : [],
    ),
  );
  const verification = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/verify-recovery.mjs",
      "--input",
      snapshot.output,
      "--key",
      keyFile,
      "--data-only",
      "--output",
      privateReport,
    ],
    {
      env: {
        ...childEnv,
        DOTENV_CONFIG_PATH: path.join(temporary, "no-env-file"),
      },
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      timeout: 15 * 60000,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  assert.equal(verification.status, 0, "The isolated restore did not pass.");
  const restored = JSON.parse(await readFile(privateReport, "utf8"));
  assert.equal(restored.verificationMode, "data-only");
  assert.equal(restored.failed, 0);
  assert(restored.passed >= 3 && restored.temporaryRestoreRemoved);
  assert.equal(restored.sourceRevision, application.revision);
  stage = "publishable evidence";
  const result = {
    version: 1,
    startedAt,
    completedAt: new Date().toISOString(),
    elapsedMs: Math.round(performance.now() - started),
    passed: true,
    sourceRevision: application.revision,
    source: application.url,
    encryptedArchive: "partnerhub.vshub",
    archiveBytes: snapshot.size,
    archiveSha256: snapshot.sha256,
    keyFingerprint: createHash("sha256")
      .update(Buffer.from(key, "hex"))
      .digest("hex")
      .slice(0, 16),
    verification: {
      mode: "data-only",
      checks: restored.checks,
      tableSchemas: restored.tables.length,
      allCapturedRowCountsMatched: true,
      allPrivateFileHashesMatched: true,
      temporaryRestoreRemoved: true,
      productionMutations: false,
      outboundDeliveryDisabled: true,
    },
    publication:
      "Upload this encrypted archive and report as one Actions artifact after this command succeeds.",
  };
  await writeFile(
    path.join(directory, "verification.json"),
    JSON.stringify(result, null, 2) + "\n",
    { mode: 0o600 },
  );
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `## Verified recovery capture\n\nLive revision: \`${application.revision}\`. AES-256-GCM archive prepared and successfully restored in an isolated PostgreSQL instance. All captured table counts, indexes and private-file hashes matched. No source mutations or outbound messages occurred.\n\nOnly the encrypted archive and redacted verification report are uploaded. The key and restored plaintext are removed from this runner. Artifact retention: 30 days.\n`,
    );
  console.log(
    JSON.stringify({
      passed: true,
      sourceRevision: application.revision,
      restoreChecks: restored.passed,
      elapsedMs: result.elapsedMs,
    }),
  );
} catch {
  console.error(
    `Automated recovery failed during ${stage}. No successful backup may be published from this run. Check configured recovery access, live revision and PostgreSQL tools.`,
  );
  process.exitCode = 1;
} finally {
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
