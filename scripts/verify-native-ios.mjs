import assert from "node:assert/strict";
import { createWriteStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { strFromU8, unzipSync } from "fflate";
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
const cacheChecks = { populated: 0, empty: 0 };
try {
  fixture = await startNativeFixture({
    async captureNativeDiagnostics(device) {
      try {
        assert.equal(device, simulator);
        const log = run("xcrun", [
          "simctl",
          "spawn",
          device,
          "log",
          "show",
          "--style",
          "compact",
          "--last",
          "8m",
          "--predicate",
          'process == "App" OR process CONTAINS "WebKit"',
        ]);
        await fs.writeFile(path.join(out, "simulator-startup.log"), log);
      } catch (error) {
        await fs.writeFile(
          path.join(out, "simulator-diagnostics.json"),
          JSON.stringify({ error: error.message }),
        );
      }
    },
    async checkNativeCache(state, device, report) {
      assert.equal(
        device,
        simulator,
        "Inspect only the active test simulator.",
      );
      const container = run("xcrun", [
        "simctl",
        "get_app_container",
        device,
        "com.vijaysoftwaresolutions.partnerhub",
        "data",
      ]).trim();
      const cache = path.join(container, "Library/Caches/partnerhub-exports");
      if (state === "populated") {
        const files = [];
        for (const directory of await fs.readdir(cache)) {
          for (const name of await fs.readdir(path.join(cache, directory)))
            if (/^VS-PartnerHub-Power-BI-[\d-]+\.zip$/.test(name))
              files.push(path.join(cache, directory, name));
        }
        assert.equal(files.length, 1, "A fresh private report must be cached.");
        const archive = unzipSync(await fs.readFile(files[0]));
        const snapshot = JSON.parse(strFromU8(archive["data/analytics.json"]));
        assert.deepEqual(snapshot.views, report.views);
      } else {
        const deadline = Date.now() + 5000;
        while (existsSync(cache) && Date.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 100));
        assert(!existsSync(cache), "Logout must remove cached private files.");
      }
      cacheChecks[state]++;
    },
  });
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
  assert.deepEqual(cacheChecks, { populated: 2, empty: 1 });
  checks.push({
    name: "Private iOS archives matched the real API and sign out removed them",
    passed: true,
  });
  console.log(`iPhone acceptance: ${checks.length}/${checks.length} passed.`);
} catch (error) {
  process.exitCode = 1;
  checks.push({
    name: "iPhone acceptance failure",
    passed: false,
    error: String(error),
  });
  console.error(error);
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
      const manifest = JSON.parse(
        await fs.readFile(path.join(out, "attachments/manifest.json"), "utf8"),
      );
      for (const item of manifest.flatMap((test) => test.attachments || [])) {
        const name = item.suggestedHumanReadableName || "";
        const destination = name.startsWith("Failure screenshot_")
          ? "failure.png"
          : name.startsWith("Native sign out returns to the login screen_")
            ? "signed-out.png"
            : null;
        if (destination && /^[a-f0-9-]+\.png$/i.test(item.exportedFileName))
          await fs.copyFile(
            path.join(out, "attachments", item.exportedFileName),
            path.join(out, destination),
          );
      }
    } catch (error) {
      console.error("Could not export XCTest attachments:", error.message);
    }
  }
  await fixture?.close();
  if (simulator) {
    try {
      run("xcrun", ["simctl", "shutdown", simulator]);
    } catch {}
  }
  if (reuseBuild) await fs.rm(derivedData, { recursive: true, force: true });
  await fs.writeFile(
    path.join(out, "report.json"),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        commit: run("git", ["rev-parse", "HEAD"]).trim(),
        checks,
        testedSimulator,
        cacheChecks,
        fixtureRequests: fixture?.diagnostics().requests || [],
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
