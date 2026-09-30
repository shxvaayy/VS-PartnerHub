import assert from "node:assert/strict";
import { createWriteStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { startNativeFixture } from "./native-fixture.mjs";

const out = path.resolve("artifacts/native-verification/ios-acceptance");
await fs.mkdir(out, { recursive: true });
const checks = [];
const resultBundle = path.join(out, "Acceptance.xcresult");
const reuseBuild = process.env.NATIVE_IOS_REUSE_BUILD === "true";
const derivedData = path.resolve(
  ".local",
  reuseBuild ? "native-ios-derived" : "native-acceptance-derived",
);
const run = (command, args) =>
  execFileSync(command, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
let fixture, simulator, testedSimulator;
try {
  fixture = await startNativeFixture();
  run("ruby", ["scripts/prepare-native-ios-tests.rb"]);
  const inventory = JSON.parse(
    run("xcrun", ["simctl", "list", "devices", "available", "--json"]),
  );
  const runtime = Object.keys(inventory.devices)
    .filter((name) => name.includes("iOS"))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .find((name) =>
      inventory.devices[name].some(
        (device) => device.isAvailable && device.name.startsWith("iPhone"),
      ),
    );
  const device = inventory.devices[runtime]?.find(
    (device) => device.isAvailable && device.name.startsWith("iPhone"),
  );
  assert(device, "An iPhone simulator is required.");
  simulator = device.udid;
  const logPath = path.join(out, "xcode-tests.log");
  const log = createWriteStream(logPath);
  const child = spawn(
    "xcodebuild",
    [
      "-project",
      "ios/App/App.xcodeproj",
      "-scheme",
      "PartnerHubAcceptance",
      "-configuration",
      "Debug",
      "-sdk",
      "iphonesimulator",
      "-destination",
      `id=${simulator}`,
      "-derivedDataPath",
      derivedData,
      "-resultBundlePath",
      resultBundle,
      "-parallel-testing-enabled",
      "NO",
      "CODE_SIGNING_ALLOWED=NO",
      "test",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  let pendingLine = "";
  child.stdout.on("data", (chunk) => {
    const lines = (pendingLine + String(chunk)).split(/\r?\n/);
    pendingLine = lines.pop();
    for (const line of lines) {
      const device = line.match(/PARTNERHUB_NATIVE_DEVICE: ([a-f0-9-]{36})/i);
      if (device) simulator = testedSimulator = device[1];
      if (/PARTNERHUB_NATIVE_PASS:|Test Case |Test Suite |error:/.test(line))
        console.log(line);
    }
  });
  let timedOut = false;
  const timeout = setTimeout(
    () => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 30000).unref();
    },
    12 * 60 * 1000,
  );
  timeout.unref();
  const [code] = await once(child, "close");
  clearTimeout(timeout);
  log.end();
  await once(log, "close");
  const text = await fs.readFile(logPath, "utf8");
  for (const name of new Set(
    [...text.matchAll(/PARTNERHUB_NATIVE_PASS: ([^\r\n]+)/g)].map(
      (match) => match[1],
    ),
  ))
    checks.push({ name, passed: true });
  assert.equal(
    code,
    0,
    timedOut
      ? "Native iOS acceptance exceeded its 12-minute execution limit; inspect the retained logs."
      : "Native iOS acceptance failed; inspect the XCTest result and screenshots.",
  );
  assert.equal(
    checks.length,
    7,
    "Every authenticated iPhone acceptance stage must finish.",
  );
  assert(
    testedSimulator,
    "Cache checks must use the simulator that actually executed XCTest.",
  );
  const container = run("xcrun", [
    "simctl",
    "get_app_container",
    simulator,
    "com.vijaysoftwaresolutions.partnerhub",
    "data",
  ]).trim();
  assert(
    !existsSync(path.join(container, "Library/Caches/partnerhub-exports")),
    "Signing out must remove cached private downloads.",
  );
  checks.push({
    name: "Native sign out removed cached private exports",
    passed: true,
  });
  run("xcrun", [
    "simctl",
    "io",
    simulator,
    "screenshot",
    path.join(out, "signed-out.png"),
  ]);
  console.log(`iPhone acceptance: ${checks.length}/${checks.length} passed.`);
} catch (error) {
  process.exitCode = 1;
  checks.push({
    name: "iPhone acceptance failure",
    passed: false,
    error: String(error),
  });
  console.error(error);
  if (simulator) {
    try {
      run("xcrun", [
        "simctl",
        "io",
        simulator,
        "screenshot",
        path.join(out, "failure.png"),
      ]);
    } catch {}
  }
} finally {
  if (existsSync(resultBundle)) {
    try {
      run("xcrun", [
        "xcresulttool",
        "export",
        "attachments",
        "--path",
        resultBundle,
        "--output-path",
        path.join(out, "attachments"),
      ]);
    } catch (error) {
      console.error("Could not export XCTest attachments:", error.message);
    }
  }
  await fixture?.close();
  if (reuseBuild) await fs.rm(derivedData, { recursive: true, force: true });
  await fs.writeFile(
    path.join(out, "report.json"),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        commit: run("git", ["rev-parse", "HEAD"]).trim(),
        checks,
        testedSimulator,
        isolatedFixtures: true,
        realNativeWebView: true,
        physicalDevice: false,
        productionRecordsChanged: false,
        externalEmailsSent: false,
      },
      null,
      2,
    ),
  );
}
