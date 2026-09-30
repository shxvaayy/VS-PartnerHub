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
  hostAlerts: [],
  reconnectAttempts: 0,
  accessibilityErrors: [],
};
function control(xml, predicate) {
  for (const [node] of xml.matchAll(/<node\b[^>]*>/g)) {
    const attribute = (name) =>
      node.match(new RegExp(`${name}="([^"]*)"`))?.[1] || "";
    if (!predicate(attribute)) continue;
    const bounds = attribute("bounds").match(
      /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/,
    );
    if (!bounds || bounds[1] === bounds[3] || bounds[2] === bounds[4]) continue;
    return {
      x: Math.round((Number(bounds[1]) + Number(bounds[3])) / 2),
      y: Math.round((Number(bounds[2]) + Number(bounds[4])) / 2),
    };
  }
}
function tap(point) {
  run(["shell", "input", "tap", String(point.x), String(point.y)]);
}
try {
  assert.match(run(["install", "--no-streaming", "-r", apk]), /Success/);
  acceptance.checks.push({
    name: "Exact signed release APK installed on an Android emulator",
    passed: true,
  });
  run(["logcat", "-c"]);
  run([
    "shell",
    "am",
    "start",
    "-W",
    "-n",
    report.applicationId + "/.MainActivity",
  ]);
  const end = Date.now() + 180000;
  let loaded = false;
  while (Date.now() < end) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    let xml;
    try {
      run([
        "shell",
        "uiautomator",
        "dump",
        "/sdcard/partnerhub-release-window.xml",
      ]);
      xml = run(["shell", "cat", "/sdcard/partnerhub-release-window.xml"]);
      await fs.writeFile(path.join(out, "launch-window.xml"), xml);
    } catch (error) {
      if (acceptance.accessibilityErrors.length < 5)
        acceptance.accessibilityErrors.push(error.message.slice(0, 800));
      continue;
    }
    assert(
      !/VS PartnerHub[^"<]*responding/.test(xml),
      "The installed release application stopped responding.",
    );
    // A cold emulator can show an unrelated Pixel Launcher ANR over the app.
    // Recover only that named host component; never dismiss a PartnerHub ANR.
    if (/Pixel Launcher[^"<]*responding/.test(xml)) {
      const close = control(
        xml,
        (attr) =>
          attr("package") === "android" &&
          attr("resource-id") === "android:id/aerr_close",
      );
      assert(
        close && acceptance.hostAlerts.length < 2,
        "The emulator launcher is not stable.",
      );
      acceptance.hostAlerts.push({
        application: "Pixel Launcher",
        action: "Close app",
      });
      tap(close);
      continue;
    }
    if (/Work email|Sign in to PartnerHub/.test(xml)) {
      loaded = true;
      break;
    }
    const reconnect = control(xml, (attr) =>
      /Return to workspace/.test(attr("text") + attr("content-desc")),
    );
    if (reconnect && acceptance.reconnectAttempts < 2) {
      acceptance.reconnectAttempts++;
      tap(reconnect);
    }
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
  try {
    const screenshot = execFileSync("adb", ["exec-out", "screencap", "-p"], {
      timeout: 15000,
      maxBuffer: 8 * 1024 * 1024,
    });
    await fs.writeFile(path.join(out, "signed-release-launch.png"), screenshot);
  } catch {}
  for (const [filename, args] of [
    [
      "native-launch.log",
      [
        "logcat",
        "-d",
        "-v",
        "time",
        "-s",
        "Capacitor:D",
        "Capacitor/Console:D",
        "chromium:E",
        "AndroidRuntime:E",
      ],
    ],
    ["connectivity.txt", ["shell", "dumpsys", "connectivity"]],
  ]) {
    try {
      await fs.writeFile(path.join(out, filename), run(args));
    } catch {}
  }
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
