import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import path from "node:path";
import {
  createRecoveryBackup,
  createRecoveryKey,
  unpackRecoveryBackup,
} from "./recovery.js";

const usage = `Recovery commands (keys are file paths, never secret arguments):
  recovery:keygen -- --key /private/path/recovery.key
  recovery:backup -- --key /private/path/recovery.key --output backups/release.vshub
  recovery:unpack -- --key /private/path/recovery.key --input backups/release.vshub --destination /private/path/new-restore

Backups use the configured database and private file store without migrations.
Unpack authenticates and checks all files, and only writes to a new directory.
It does not connect to a database or start the application. See docs/OPERATIONS.md.`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      key: { type: "string" },
      output: { type: "string" },
      input: { type: "string" },
      destination: { type: "string" },
      "max-bytes": { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) return console.log(usage);
  const command = positionals[0];
  if (
    positionals.length !== 1 ||
    !["keygen", "backup", "unpack"].includes(command) ||
    !values.key
  )
    throw new Error(usage);
  const keyFile = path.resolve(values.key);
  if (command === "keygen") {
    await createRecoveryKey(keyFile);
    console.log(
      `Recovery key created with owner-only permissions: ${keyFile}. Keep it separately from backups.`,
    );
  } else if (command === "backup") {
    if (!values.output)
      throw new Error("Set --output to a new encrypted backup path.");
    const { config } = await import("./config.js");
    let revision =
      process.env.BACKUP_REVISION || process.env.VERCEL_GIT_COMMIT_SHA;
    if (!revision) {
      try {
        revision = execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
      } catch {
        throw new Error(
          "Set BACKUP_REVISION to the deployed revision before backing up.",
        );
      }
    }
    const result = await createRecoveryBackup({
      source: config,
      output: values.output,
      keyFile,
      revision,
      pgBin: process.env.PG_BIN,
    });
    console.log(
      JSON.stringify(
        {
          output: result.output,
          engine: result.manifest.database.engine,
          tables: result.manifest.database.tables.length,
          privateFiles: result.manifest.files.length,
          size: result.size,
          sha256: result.sha256,
        },
        null,
        2,
      ),
    );
  } else {
    if (!values.input || !values.destination)
      throw new Error("Set --input and a NEW --destination directory.");
    const result = await unpackRecoveryBackup({
      source: values.input,
      keyFile,
      destination: values.destination,
      ...(values["max-bytes"] ? { maxBytes: Number(values["max-bytes"]) } : {}),
    });
    console.log(
      JSON.stringify(
        {
          destination: result.destination,
          engine: result.manifest.database.engine,
          tables: result.manifest.database.tables.length,
          privateFiles: result.manifest.files.length,
          revision: result.manifest.revision,
          next: "Restore into an empty isolated database; keep email, webhooks and scheduled jobs disabled during the rehearsal.",
        },
        null,
        2,
      ),
    );
  }
}

main().catch((error) => {
  // Do not print driver errors, source URLs or environment values.
  console.error(
    error instanceof Error && !(error as any).code
      ? error.message
      : "Recovery command failed. Check file paths, permissions and source access; no existing backup or restore target was overwritten.",
  );
  process.exitCode = 1;
});
