import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { _android, expect as playwrightExpect } from "@playwright/test";
import { unzipSync, strFromU8 } from "fflate";
import { startNativeFixture } from "./native-fixture.mjs";

const pkg = "com.vijaysoftwaresolutions.partnerhub";
const workspaceWindow =
  /com\.vijaysoftwaresolutions\.partnerhub\/[^\s}]*MainActivity/;
const expect = playwrightExpect.configure({ timeout: 30000 });
const out = path.resolve("artifacts/native-verification/android-acceptance");
await fs.mkdir(out, { recursive: true });
const checks = [],
  errors = [],
  fileIntegrity = [],
  nativeWindows = [],
  hostAlerts = [];
const automationCleanup = {
  driversStopped: false,
  deviceClosed: false,
  fixtureClosed: false,
};
const dismissedHostWindows = new Set();
let fixture, device, page;
const adb = (args) =>
  execFileSync("adb", args, {
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 8 * 1024 * 1024,
  });
async function within(promise, milliseconds, description) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(description + " timed out.")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function check(name, action) {
  await action();
  checks.push({ name, passed: true });
  console.log("PASS " + name);
}
async function focusedWindow() {
  const dump = adb(["shell", "dumpsys", "window"]);
  const focus = dump.match(/^\s*mCurrentFocus=(.*)$/m)?.[1]?.trim() || "";
  // A cold emulator can raise an unrelated launcher ANR. Recover only that
  // named host component; an application ANR must still fail acceptance.
  if (/Application (?:Error|Not Responding)/.test(focus)) {
    // WindowManager can retain the closing window briefly. Never tap it twice
    // or reuse an old UI dump after the native automation returns no root.
    if (dismissedHostWindows.has(focus)) return "";
    const title = await device.info({
      pkg: "android",
      res: "android:id/alertTitle",
    });
    assert(
      /^Pixel Launcher isn't responding$/.test(title.text),
      "An application stopped responding; inspect the native failure evidence.",
    );
    assert(hostAlerts.length < 2, "The emulator launcher is not stable.");
    const filename = `launcher-alert-${hostAlerts.length + 1}`;
    await fs.writeFile(
      path.join(out, filename + ".json"),
      JSON.stringify({ focus, title }, null, 2),
    );
    await device.screenshot({ path: path.join(out, filename + ".png") });
    await device.tap({ pkg: "android", res: "android:id/aerr_close" });
    await device.wait(
      { pkg: "android", res: "android:id/alertTitle", text: title.text },
      { state: "gone" },
    );
    dismissedHostWindows.add(focus);
    hostAlerts.push({ application: "Pixel Launcher", action: "Close app" });
    return "";
  }
  return focus;
}
async function waitForNativeWindow(pattern, stage) {
  let focus;
  await expect
    .poll(
      async () => {
        focus = await focusedWindow();
        return focus;
      },
      { timeout: 45000, intervals: [300, 500, 1000] },
    )
    .toMatch(pattern);
  nativeWindows.push({ stage, focus, checkedAt: new Date().toISOString() });
}
async function waitForShareSheet(filename, stage) {
  // Activity history includes old and not-yet-visible choosers. Before sending
  // Back, require the current input window and the actual native file label.
  await waitForNativeWindow(/ChooserActivity/, stage + " focused");
  await device.wait({ text: filename });
  await waitForNativeWindow(/ChooserActivity/, stage + " visible");
}
async function dismissShareSheet(stage) {
  const location = page.url();
  await waitForNativeWindow(/ChooserActivity/, stage + " before Back");
  await device.shell("input keyevent KEYCODE_BACK");
  await waitForNativeWindow(workspaceWindow, stage + " dismissed");
  await expect(page).toHaveURL(location);
}
async function readPrivateFile(file, source) {
  assert(
    /^cache\/partnerhub-exports\/[a-f0-9-]+\/[^/]+$/.test(file),
    "Inspect only a generated private export.",
  );
  const quoted = "'" + file.replaceAll("'", "'\\''") + "'";
  const size = Number(
    adb(["shell", "-T", `run-as ${pkg} stat -c %s ${quoted}`]).trim(),
  );
  const remoteHash = adb([
    "shell",
    "-T",
    `run-as ${pkg} sha256sum ${quoted}`,
  ]).match(/^[a-f0-9]{64}/)?.[0];
  assert(remoteHash, "The app container must report its actual file hash.");
  // Read printable data through the shell-v2 protocol. Verify the transfer
  // against the hash calculated inside the app container and the HTTP body.
  const encoded = adb([
    "shell",
    "-T",
    `run-as ${pkg} base64 ${quoted}`,
  ]).replace(/\s/g, "");
  assert(/^[A-Za-z0-9+/]*={0,2}$/.test(encoded));
  const bytes = Buffer.from(encoded, "base64");
  const digest = (value) => createHash("sha256").update(value).digest("hex");
  const evidence = {
    filename: path.basename(file),
    cacheBytes: size,
    transferredBytes: bytes.length,
    sourceBytes: source.length,
    cacheSha256: remoteHash,
    transferredSha256: digest(bytes),
    sourceSha256: digest(source),
  };
  fileIntegrity.push(evidence);
  await fs.writeFile(path.join(out, path.basename(file)), bytes);
  await fs.writeFile(
    path.join(out, "file-integrity.json"),
    JSON.stringify(fileIntegrity, null, 2),
  );
  assert.equal(bytes.length, size, "The entire cached file must be read.");
  assert.equal(evidence.transferredSha256, remoteHash);
  assert.equal(
    remoteHash,
    evidence.sourceSha256,
    "The file saved by the app must match the actual HTTP response byte for byte.",
  );
  return bytes;
}
async function navigate(name) {
  await waitForNativeWindow(workspaceWindow, "navigate " + name);
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page
    .getByLabel("Main navigation", { exact: true })
    .getByRole("link", { name, exact: true })
    .click();
}
try {
  fixture = await startNativeFixture();
  adb(["reverse", "tcp:4207", "tcp:4207"]);
  [device] = await _android.devices();
  assert(device, "An Android emulator is required.");
  device.setDefaultTimeout(45000);
  await device.installApk(
    await fs.readFile("android/app/build/outputs/apk/debug/app-debug.apk"),
  );
  await device.shell(`am force-stop ${pkg}`);
  await device.shell(`am start -n ${pkg}/.MainActivity`);
  await waitForNativeWindow(workspaceWindow, "initial app launch");
  page = await (await device.webView({ pkg })).page();
  page.setDefaultTimeout(45000);
  page.on("pageerror", (error) => errors.push(error.message));
  const { demoAccounts, demoPassword } = await import("../shared/demo.ts");
  await check(
    "Installed Android WebView signs in with a scoped account through the real API",
    async () => {
      await expect(
        page.getByLabel("Work email", { exact: false }),
      ).toBeVisible();
      await page
        .getByLabel("Work email", { exact: false })
        .fill(demoAccounts.find((a) => a.key === "admin").email);
      await page.getByLabel("Password", { exact: true }).fill(demoPassword);
      await page
        .getByRole("button", { name: "Sign in to PartnerHub", exact: true })
        .click();
      await expect(page).toHaveURL(/\/app$/);
      assert.equal(
        await page.evaluate(() => window.Capacitor.getPlatform()),
        "android",
      );
      await expect(
        page.getByRole("button", { name: "Open navigation", exact: true }),
      ).toBeVisible();
      await device.screenshot({
        path: path.join(out, "authenticated-workspace.png"),
      });
    },
  );
  await check(
    "Native report navigation, calculations and dashboard tabs work at phone size",
    async () => {
      await navigate("Reports & analytics");
      await page
        .getByRole("button", { name: "Power BI preview", exact: true })
        .click();
      await expect(page.locator(".bi-canvas-heading h2")).toHaveText(
        "Executive overview",
      );
      await page.locator(".bi-kpi").first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await device.screenshot({ path: path.join(out, "native-report.png") });
    },
  );
  await check(
    "Report download writes the exact authorized archive and opens Android file sharing",
    async () => {
      const report = await page.evaluate(() =>
        fetch("/api/reports/analytics").then((r) => r.json()),
      );
      await page
        .getByRole("button", { name: "Download Power BI project", exact: true })
        .click();
      await waitForNativeWindow(/ChooserActivity/, "report share requested");
      const original = fixture.downloadedReport();
      assert(
        original?.length > 0,
        "The actual report bytes sent by the fixture must be captured.",
      );
      await fs.writeFile(path.join(out, "http-report.zip"), original);
      const names = adb([
        "shell",
        "run-as",
        pkg,
        "find",
        "cache/partnerhub-exports",
        "-type",
        "f",
      ])
        .trim()
        .split(/\r?\n/);
      const file = names.find((name) =>
        /^cache\/partnerhub-exports\/[a-f0-9-]+\/VS-PartnerHub-Power-BI-[\d-]+\.zip$/.test(
          name,
        ),
      );
      assert(
        file,
        "The archive must be held in the application's private cache.",
      );
      await waitForShareSheet(path.basename(file), "report share");
      await device.screenshot({
        path: path.join(out, "native-file-sharing.png"),
      });
      const bytes = await readPrivateFile(file, original);
      const source = JSON.parse(
        strFromU8(unzipSync(bytes)["data/analytics.json"]),
      );
      assert.deepEqual(source.views, report.views);
      await dismissShareSheet("report share");
      await expect(
        page.getByRole("button", {
          name: "Download Power BI project",
          exact: true,
        }),
      ).toBeEnabled();
    },
  );
  await check(
    "Private document links open the native file sheet without leaving the document workspace",
    async () => {
      await navigate("Documents");
      const link = page.getByRole("link", { name: /^Download / }).first();
      await expect(link).toBeVisible();
      const address = await link.getAttribute("href");
      const original = Buffer.from(
        await page.evaluate(async (url) => {
          const response = await fetch(url);
          if (!response.ok)
            throw new Error("The authorized document was not returned.");
          return Array.from(new Uint8Array(await response.arrayBuffer()));
        }, address),
      );
      await link.click();
      await waitForNativeWindow(/ChooserActivity/, "document share requested");
      const files = adb([
        "shell",
        "run-as",
        pkg,
        "find",
        "cache/partnerhub-exports",
        "-type",
        "f",
      ])
        .trim()
        .split(/\r?\n/);
      const file = files.find((name) => name.endsWith(".pdf"));
      assert(file, "The private PDF must be prepared in the app cache.");
      await waitForShareSheet(path.basename(file), "document share");
      await device.screenshot({
        path: path.join(out, "native-document-sharing.png"),
      });
      const cached = await readPrivateFile(file, original);
      assert.equal(
        createHash("sha256").update(cached).digest("hex"),
        createHash("sha256").update(original).digest("hex"),
      );
      await dismissShareSheet("document share");
      await expect(page).toHaveURL(/\/app\/documents(?:\?.*)?$/);
      await expect(link).not.toHaveAttribute("aria-busy", "true");
    },
  );
  await check(
    "Returning from the background refreshes records created by another authorized session",
    async () => {
      await navigate("Requirements");
      await expect(
        page.getByRole("link", { name: /Native resume verification/ }),
      ).toHaveCount(0);
      await device.shell("input keyevent KEYCODE_HOME");
      await fixture.requirement();
      await device.shell(`am start -n ${pkg}/.MainActivity`);
      await expect(
        page.getByRole("link", { name: /Native resume verification/ }),
      ).toBeVisible();
    },
  );
  await check(
    "Android Back returns from a record to its workspace list",
    async () => {
      await page
        .getByRole("link", { name: /Native resume verification/ })
        .click();
      await expect(page).toHaveURL(/\/app\/requirements\/[^/]+$/);
      await device.shell("input keyevent KEYCODE_BACK");
      await expect(page).toHaveURL(/\/app\/requirements(?:\?.*)?$/);
    },
  );
  await check(
    "A server interruption shows the packaged reconnect screen and recovers the session",
    async () => {
      const protocol = await page.context().newCDPSession(page);
      await fixture.offline();
      await page.reload().catch((error) => {
        if (!/net::|navigation|interrupted/i.test(error.message)) throw error;
      });
      // Capacitor's errorPath navigation paints the local page but does not
      // finish Playwright's pending remote-navigation lifecycle. Read the real
      // installed WebView and deliver a touch through its public CDP session.
      // No page state, connection result or user action is mocked here.
      await expect
        .poll(async () => {
          const { result } = await protocol.send("Runtime.evaluate", {
            expression: `(() => {
            const logo = document.querySelector('[data-workspace-logo]');
            return { path: location.pathname, heading: document.querySelector('h1')?.textContent.trim(), logo: !!(logo?.complete && logo.naturalWidth > 0) };
          })()`,
            returnByValue: true,
          });
          return result.value;
        })
        .toEqual({
          path: "/offline.html",
          heading: "Let’s get you reconnected.",
          logo: true,
        });
      await device.screenshot({ path: path.join(out, "native-offline.png") });
      await fixture.online();
      const { result } = await protocol.send("Runtime.evaluate", {
        expression: `(() => {
          const link = document.querySelector('[data-workspace-link]');
          const bounds = link.getBoundingClientRect();
          return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, href: link.href, width: innerWidth, height: innerHeight };
        })()`,
        returnByValue: true,
      });
      const target = result.value;
      assert.equal(target.href, "http://127.0.0.1:4207/app");
      assert(
        target.x > 0 &&
          target.x < target.width &&
          target.y > 0 &&
          target.y < target.height,
      );
      await protocol.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: target.x, y: target.y }],
      });
      await protocol.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await expect(page).toHaveURL(/\/app$/);
      await expect(
        page.getByRole("button", { name: "Open navigation", exact: true }),
      ).toBeVisible();
      await protocol.detach();
    },
  );
  await check(
    "Signing out removes the native session and cached private exports",
    async () => {
      // Reconnect starts a new page and clears old startup cache. Create a fresh
      // file now so the logout assertion cannot pass against an already empty cache.
      await navigate("Reports & analytics");
      await page
        .getByRole("button", { name: "Power BI preview", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Download Power BI project", exact: true })
        .click();
      await waitForNativeWindow(/ChooserActivity/, "logout share requested");
      const files = adb([
        "shell",
        "run-as",
        pkg,
        "find",
        "cache/partnerhub-exports",
        "-type",
        "f",
      ])
        .trim()
        .split(/\r?\n/);
      const file = files.find((name) => name.endsWith(".zip"));
      assert(file, "A fresh private archive must exist before logout.");
      await waitForShareSheet(path.basename(file), "logout share");
      await dismissShareSheet("logout share");
      await expect(
        page.getByRole("button", {
          name: "Download Power BI project",
          exact: true,
        }),
      ).toBeEnabled();
      assert(
        adb(["shell", "run-as", pkg, "ls", "cache"]).includes(
          "partnerhub-exports",
        ),
      );
      await page
        .getByRole("button", { name: "Open navigation", exact: true })
        .click();
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await expect(page).toHaveURL(/\/login/);
      await expect
        .poll(() => adb(["shell", "run-as", pkg, "ls", "cache"]))
        .not.toContain("partnerhub-exports");
      assert.equal(
        await page.evaluate(() =>
          fetch("/api/reports/power-bi").then((r) => r.status),
        ),
        401,
      );
      assert.deepEqual(errors, []);
    },
  );
} catch (error) {
  process.exitCode = 1;
  checks.push({
    name: "Android acceptance failure",
    passed: false,
    error: String(error),
  });
  console.error(error);
  await device
    ?.screenshot({ path: path.join(out, "failure.png") })
    .catch(() => {});
  try {
    await fs.writeFile(
      path.join(out, "failure-window.txt"),
      adb(["shell", "dumpsys", "window"]),
    );
  } catch {}
} finally {
  let cleanupFailed = false;
  try {
    if (device) {
      // Playwright's Android driver owns a long-running `am instrument`
      // connection. Stop only its test packages before closing the device;
      // otherwise that connection can keep Node alive after every check passes.
      for (const automationPackage of [
        "com.microsoft.playwright.androiddriver",
        "com.microsoft.playwright.androiddriver.test",
      ]) {
        adb(["shell", "am", "force-stop", automationPackage]);
      }
      automationCleanup.driversStopped = true;
      await within(
        device.close(),
        10000,
        "Android automation connection cleanup",
      );
      automationCleanup.deviceClosed = true;
    }
  } catch (error) {
    cleanupFailed = true;
    process.exitCode = 1;
    checks.push({
      name: "Android automation cleanup failure",
      passed: false,
      error: String(error),
    });
    console.error(error);
  }
  try {
    await within(fixture?.close(), 10000, "Native fixture cleanup");
    automationCleanup.fixtureClosed = true;
  } catch (error) {
    cleanupFailed = true;
    process.exitCode = 1;
    checks.push({
      name: "Android fixture cleanup failure",
      passed: false,
      error: String(error),
    });
    console.error(error);
  }
  await fs.writeFile(
    path.join(out, "report.json"),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        commit: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
        checks,
        errors,
        fileIntegrity,
        nativeWindows,
        hostAlerts,
        automationCleanup,
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
  console.log("Android acceptance evidence and automation cleanup recorded.");
  // A failed cleanup must retain its report and fail promptly, even when the
  // native driver has left an open connection. Successful runs exit normally.
  if (cleanupFailed) process.exit(1);
}
