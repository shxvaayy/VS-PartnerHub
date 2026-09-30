import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Browser mutations always use disposable data, independent of the review workspace.
const directory = await mkdtemp(path.join(tmpdir(), "partnerhub-browser-"));
const env = {
  ...process.env,
  NODE_ENV: "test",
  DEMO_MODE: "true",
  DATABASE_URL: "",
  SQLITE_PATH: path.join(directory, "browser.sqlite"),
  UPLOAD_DIR: path.join(directory, "uploads"),
  PORT: "4103",
  WEB_PORT: "5183",
  HOST: "127.0.0.1",
  APP_URL: "http://127.0.0.1:5183",
  SESSION_SECRET: "isolated-browser-test-secret-never-for-production",
  SMTP_HOST: "",
  RESEND_API_KEY: "",
  GEMINI_API_KEY: "",
};
const children = [
  spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    env,
    stdio: "inherit",
  }),
  spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"],
    { env, stdio: "inherit" },
  ),
];
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  await Promise.all(
    children.map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null || child.signalCode) return resolve();
          child.once("exit", resolve);
          child.kill("SIGTERM");
          const timer = setTimeout(() => child.kill("SIGKILL"), 12000);
          timer.unref();
          child.once("exit", () => clearTimeout(timer));
        }),
    ),
  );
  await rm(directory, { recursive: true, force: true });
  process.exit(code);
}
for (const child of children) {
  child.once("error", (error) => {
    console.error(error);
    void stop(1);
  });
  child.once("exit", (code) => {
    if (!stopping) void stop(code || 1);
  });
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
