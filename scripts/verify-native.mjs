import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { existsSync, createWriteStream } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";

const platform = process.argv[2];
assert(["android", "ios"].includes(platform), "Choose android or ios.");
const origin = new URL(process.env.MOBILE_SERVER_URL || "");
assert.equal(origin.protocol, "https:");
assert(!origin.username && !origin.password && !origin.search && !origin.hash);
assert.equal(origin.pathname, "/", "Use a workspace origin without a path.");
const applicationId = "com.vijaysoftwaresolutions.partnerhub";
const output = path.resolve("artifacts/native-verification", platform);
await fs.mkdir(output, { recursive: true });
const checks = [];
const artifacts = [];
const startedAt = new Date().toISOString();
const run = (command, args) =>
  execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  });
let simulator, derivedData;
function verifyConfig(config) {
  assert.equal(config.appId, applicationId);
  assert.equal(config.appName, "VS PartnerHub");
  assert.equal(config.server.url, `${origin.origin}/app`);
  assert.equal(config.server.cleartext, false);
  assert.deepEqual(config.server.allowNavigation, [origin.hostname]);
  assert.equal(config.server.errorPath, "offline.html");
}
function verifyOffline(html) {
  assert.match(
    html,
    /data-workspace-logo\s+src="data:image\/png;base64,[A-Za-z0-9+/=]+"/,
    "The offline brand image must be bundled without a network request.",
  );
  const link = html.match(/<a\s+data-workspace-link\s+href="([^"]+)"/);
  assert(link, "The packaged offline page must have a reconnect link.");
  assert.equal(
    link[1],
    `${origin.origin}/app`,
    "Offline reconnect must return to the configured HTTPS workspace.",
  );
}
async function recordArtifact(filename, purpose) {
  const bytes = await fs.readFile(filename);
  assert(bytes.length > 0);
  artifacts.push({
    file: path.basename(filename),
    purpose,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
async function commandLog(command, args, filename) {
  const log = createWriteStream(filename);
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.on("error", () => log.end());
  const [code] = await once(child, "close");
  log.end();
  await once(log, "close");
  assert.equal(
    code,
    0,
    `${path.basename(command)} failed; inspect the uploaded build log.`,
  );
}
try {
  if (platform === "android") {
    const apk = path.resolve(
      "android/app/build/outputs/apk/debug/app-debug.apk",
    );
    const bundle = path.resolve(
      "android/app/build/outputs/bundle/release/app-release.aab",
    );
    assert(
      existsSync(apk) && existsSync(bundle),
      "Build the debug APK and release AAB first.",
    );
    for (const [filename, member] of [
      [apk, "assets/capacitor.config.json"],
      [bundle, "base/assets/capacitor.config.json"],
    ]) {
      verifyConfig(JSON.parse(run("unzip", ["-p", filename, member])));
      const offlineMember = member.replace(
        "capacitor.config.json",
        "public/offline.html",
      );
      verifyOffline(run("unzip", ["-p", filename, offlineMember]));
    }
    checks.push({
      name: "APK and AAB contain the expected HTTPS workspace, identity and offline fallback",
      passed: true,
    });
    const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
    assert(sdk, "Set the Android SDK location.");
    const badging = run(path.join(sdk, "build-tools/36.0.0/aapt"), [
      "dump",
      "badging",
      apk,
    ]);
    assert(badging.includes(`name='${applicationId}'`));
    assert.match(badging, /sdkVersion:'24'/);
    assert.match(badging, /targetSdkVersion:'36'/);
    assert(badging.includes("VS PartnerHub"));
    await fs.writeFile(path.join(output, "package-inspection.txt"), badging);
    checks.push({
      name: "Packaged Android identity, label and supported API levels verified",
      passed: true,
    });
    run(path.join(sdk, "build-tools/36.0.0/apksigner"), ["verify", apk]);
    checks.push({
      name: "Debug APK signature is valid for test installation",
      passed: true,
    });
    for (const [from, name, purpose] of [
      [
        apk,
        "VS-PartnerHub-debug.apk",
        "Debug-signed Android test build; not a production signing identity",
      ],
      [
        bundle,
        "VS-PartnerHub-release-unsigned.aab",
        "Release bundle awaiting company signing and distribution configuration",
      ],
    ]) {
      const destination = path.join(output, name);
      await fs.copyFile(from, destination);
      await recordArtifact(destination, purpose);
    }
  } else {
    const inventory = JSON.parse(
      run("xcrun", ["simctl", "list", "devices", "available", "--json"]),
    );
    const runtimes = Object.keys(inventory.devices)
      .filter((name) => name.includes("iOS"))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    let device;
    for (const runtime of runtimes) {
      device = inventory.devices[runtime].find(
        (item) => item.isAvailable && item.name.startsWith("iPhone"),
      );
      if (device) break;
    }
    assert(device, "An available iPhone simulator is required.");
    simulator = device.udid;
    derivedData = path.resolve(".local", `native-ios-derived-${process.pid}`);
    await fs.mkdir(derivedData, { recursive: true });
    await commandLog(
      "xcodebuild",
      [
        "-project",
        "ios/App/App.xcodeproj",
        "-scheme",
        "App",
        "-configuration",
        "Debug",
        "-sdk",
        "iphonesimulator",
        "-destination",
        `id=${simulator}`,
        "-derivedDataPath",
        derivedData,
        "CODE_SIGNING_ALLOWED=NO",
        "build",
      ],
      path.join(output, "xcode-build.log"),
    );
    checks.push({
      name: "iOS simulator application compiled successfully",
      passed: true,
    });
    const app = path.join(
      derivedData,
      "Build/Products/Debug-iphonesimulator/App.app",
    );
    verifyConfig(
      JSON.parse(
        await fs.readFile(path.join(app, "capacitor.config.json"), "utf8"),
      ),
    );
    const info = JSON.parse(
      run("plutil", [
        "-convert",
        "json",
        "-o",
        "-",
        path.join(app, "Info.plist"),
      ]),
    );
    assert.equal(info.CFBundleIdentifier, applicationId);
    assert.equal(info.CFBundleDisplayName, "VS PartnerHub");
    assert(
      info.NSCameraUsageDescription && info.NSPhotoLibraryUsageDescription,
    );
    verifyOffline(
      await fs.readFile(path.join(app, "public/offline.html"), "utf8"),
    );
    checks.push({
      name: "Packaged iOS identity and HTTPS workspace configuration verified",
      passed: true,
    });
    if (device.state !== "Booted") run("xcrun", ["simctl", "boot", simulator]);
    run("xcrun", ["simctl", "bootstatus", simulator, "-b"]);
    run("xcrun", ["simctl", "install", simulator, app]);
    const launched = run("xcrun", [
      "simctl",
      "launch",
      "--terminate-running-process",
      simulator,
      applicationId,
    ]);
    assert(launched.includes(applicationId));
    await new Promise((resolve) => setTimeout(resolve, 20000));
    const processes = run("xcrun", [
      "simctl",
      "spawn",
      simulator,
      "launchctl",
      "list",
    ]);
    assert(
      processes
        .split("\n")
        .some(
          (line) => line.includes(applicationId) && /^\d+\s/.test(line.trim()),
        ),
      "The app process must remain running after launch.",
    );
    const screenshot = path.join(output, "simulator-launch.png");
    run("xcrun", ["simctl", "io", simulator, "screenshot", screenshot]);
    checks.push({
      name: "App installed and remained running on an iPhone simulator; launch screenshot captured",
      passed: true,
    });
    await recordArtifact(
      screenshot,
      "Native launch screenshot for visual review; not proof of every authenticated workflow",
    );
    const archive = path.join(output, "VS-PartnerHub-ios-simulator.zip");
    run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, archive]);
    await recordArtifact(
      archive,
      "Unsigned iOS simulator app; device distribution requires the company's Apple signing identity",
    );
    await fs.writeFile(
      path.join(output, "toolchain.json"),
      JSON.stringify(
        {
          xcode: run("xcodebuild", ["-version"]).trim(),
          simulator: { name: device.name, udid: device.udid },
        },
        null,
        2,
      ),
    );
    await fs.rm(derivedData, { recursive: true, force: true });
  }
} catch (error) {
  checks.push({
    name: `${platform} native verification`,
    passed: false,
    error: error.message,
  });
  process.exitCode = 1;
} finally {
  if (derivedData) await fs.rm(derivedData, { recursive: true, force: true });
  if (simulator) {
    try {
      run("xcrun", ["simctl", "shutdown", simulator]);
    } catch {}
  }
  const report = {
    startedAt,
    checkedAt: new Date().toISOString(),
    commit: run("git", ["rev-parse", "HEAD"]).trim(),
    platform,
    applicationId,
    workspaceOrigin: origin.origin,
    checks,
    passed: checks.filter((check) => check.passed).length,
    failed: checks.filter((check) => !check.passed).length,
    artifacts,
    distributionReady: false,
    limitations: [
      "Company signing, store/private distribution and physical-device acceptance remain separate release steps.",
      "Build/launch verification complements browser/API acceptance; it does not certify every native file-picker, download or hardware interaction.",
    ],
  };
  await fs.writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        platform,
        passed: report.passed,
        failed: report.failed,
        failures: checks.filter((check) => !check.passed),
        report: path.join(output, "report.json"),
      },
      null,
      2,
    ),
  );
  await fs.appendFile(
    process.env.GITHUB_STEP_SUMMARY || path.join(output, "summary.md"),
    `\n### ${platform} native verification\n\n${report.passed} checks passed; ${report.failed} failed. Artifacts are test/unsigned builds, not store releases.\n`,
  );
}
