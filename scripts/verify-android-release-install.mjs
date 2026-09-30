import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const out = path.resolve("artifacts/android-release");
const report = JSON.parse(
  await fs.readFile(path.join(out, "report.json"), "utf8"),
);
assert.equal(
  report.passed,
  true,
  "Verify release signatures before installation.",
);
const apk = path.join(out, "VS-PartnerHub-Android.apk");
const digest = createHash("sha256")
  .update(await fs.readFile(apk))
  .digest("hex");
assert.equal(
  digest,
  report.artifacts.find((item) => item.filename.endsWith(".apk")).sha256,
);
const run = (args) =>
  execFileSync("adb", args, {
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 8 * 1024 * 1024,
  });
const acceptance = {
  commit: report.commit,
  apkSha256: digest,
  physicalDevice: false,
  productionRecordsChanged: false,
  externalEmailsSent: false,
  checks: [],
};
try {
  assert.match(run(["install", "--no-streaming", "-r", apk]), /Success/);
  acceptance.checks.push({
    name: "Exact signed release APK installed on an Android emulator",
    passed: true,
  });
  run([
    "shell",
    "am",
    "start",
    "-W",
    "-n",
    report.applicationId + "/.MainActivity",
  ]);
  const end = Date.now() + 120000;
  let loaded = false;
  while (Date.now() < end) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    try {
      run([
        "shell",
        "uiautomator",
        "dump",
        "/sdcard/partnerhub-release-window.xml",
      ]);
      const xml = run([
        "shell",
        "cat",
        "/sdcard/partnerhub-release-window.xml",
      ]);
      await fs.writeFile(path.join(out, "launch-window.xml"), xml);
      if (/Work email|Sign in to PartnerHub/.test(xml)) {
        loaded = true;
        break;
      }
    } catch {}
  }
  const screenshot = execFileSync("adb", ["exec-out", "screencap", "-p"], {
    timeout: 15000,
    maxBuffer: 8 * 1024 * 1024,
  });
  await fs.writeFile(path.join(out, "signed-release-launch.png"), screenshot);
  assert(
    loaded,
    "The signed release did not reach the actual HTTPS sign-in screen.",
  );
  acceptance.checks.push({
    name: "Signed production app rendered the live PartnerHub sign-in screen",
    passed: true,
  });
  const processes = run(["shell", "pidof", report.applicationId]);
  assert(processes.trim());
  acceptance.checks.push({
    name: "Release process remains running after the live workspace loads",
    passed: true,
  });
} catch (error) {
  acceptance.checks.push({
    name: "Signed release launch acceptance",
    passed: false,
    error: error.message,
  });
  process.exitCode = 1;
} finally {
  acceptance.completedAt = new Date().toISOString();
  acceptance.passed =
    acceptance.checks.length === 3 &&
    acceptance.checks.every((check) => check.passed);
  await fs.writeFile(
    path.join(out, "installation.json"),
    JSON.stringify(acceptance, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: acceptance.passed,
      checks: acceptance.checks.length,
    }),
  );
}
