import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { _android, expect as playwrightExpect } from "@playwright/test";
import { unzipSync, strFromU8 } from "fflate";
import { startNativeFixture } from "./native-fixture.mjs";

const pkg = "com.vijaysoftwaresolutions.partnerhub";
const expect = playwrightExpect.configure({ timeout: 30000 });
const out = path.resolve("artifacts/native-verification/android-acceptance");
await fs.mkdir(out, { recursive: true });
const checks = [],
  errors = [];
let fixture, device, page;
const adb = (args) =>
  execFileSync("adb", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
async function check(name, action) {
  await action();
  checks.push({ name, passed: true });
  console.log("PASS " + name);
}
async function navigate(name) {
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
      await expect
        .poll(() => adb(["shell", "dumpsys", "activity", "activities"]), {
          timeout: 30000,
        })
        .toMatch(/ChooserActivity/);
      await device.screenshot({
        path: path.join(out, "native-file-sharing.png"),
      });
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
      const bytes = execFileSync("adb", [
        "exec-out",
        "run-as",
        pkg,
        "cat",
        file,
      ]);
      const source = JSON.parse(
        strFromU8(unzipSync(bytes)["data/analytics.json"]),
      );
      assert.deepEqual(source.views, report.views);
      await device.shell("input keyevent KEYCODE_BACK");
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
      await expect
        .poll(() => adb(["shell", "dumpsys", "activity", "activities"]))
        .toMatch(/ChooserActivity/);
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
      const cached = execFileSync("adb", [
        "exec-out",
        "run-as",
        pkg,
        "cat",
        file,
      ]);
      assert.equal(
        createHash("sha256").update(cached).digest("hex"),
        createHash("sha256").update(original).digest("hex"),
      );
      await device.shell("input keyevent KEYCODE_BACK");
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
      await fixture.offline();
      await page.reload().catch((error) => {
        if (!/net::|navigation|interrupted/i.test(error.message)) throw error;
      });
      await expect(
        page.getByRole("heading", { name: "Let’s get you reconnected." }),
      ).toBeVisible();
      assert(
        await page
          .locator("[data-workspace-logo]")
          .evaluate((image) => image.complete && image.naturalWidth > 0),
        "The native offline logo must render without a server connection.",
      );
      await device.screenshot({ path: path.join(out, "native-offline.png") });
      await fixture.online();
      await page
        .getByRole("link", { name: "Return to workspace", exact: true })
        .click();
      await expect(page).toHaveURL(/\/app$/);
      await expect(
        page.getByRole("button", { name: "Open navigation", exact: true }),
      ).toBeVisible();
    },
  );
  await check(
    "Signing out removes the native session and cached private exports",
    async () => {
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
} finally {
  await device?.close().catch(() => {});
  await fixture?.close();
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
