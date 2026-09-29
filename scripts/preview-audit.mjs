import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const output = path.resolve("artifacts/local-verification");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
  reducedMotion: "reduce",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
await page.screenshot({
  path: path.join(output, "01-landing-desktop.png"),
  fullPage: true,
});
await page.goto("http://127.0.0.1:5173/login?demo=true", {
  waitUntil: "networkidle",
});
await page
  .getByRole("button", { name: "Explore Super Admin workspace" })
  .click();
await page.waitForURL("**/app");
await page
  .getByRole("heading", { name: /Good (morning|afternoon|evening)/ })
  .waitFor();
await page.locator(".recharts-area-area").first().waitFor({ state: "visible" });
await page.screenshot({
  path: path.join(output, "02-admin-desktop.png"),
  fullPage: true,
});
const routes = [
  "organizations",
  "verification",
  "discovery",
  "requirements",
  "rfqs",
  "quotations",
  "orders",
  "deliveries",
  "contracts",
  "invoices",
  "payments",
  "catalog",
  "candidates",
  "interviews",
  "engagements",
  "timesheets",
  "milestones",
  "demos",
  "performance",
  "documents",
  "team",
  "roles",
  "reports",
  "audit",
  "settings",
  "notifications",
  "tickets",
];
const checks = [];
for (const route of routes) {
  await page.goto(`http://127.0.0.1:5173/app/${route}`, {
    waitUntil: "networkidle",
  });
  const text = await page.locator("main").innerText();
  checks.push({
    route,
    loaded:
      !/We couldn’t load this page|Let’s reconnect|API route not found|Your role cannot access/.test(
        text,
      ),
    heading: await page.locator("h1").first().textContent(),
  });
}
await page.goto("http://127.0.0.1:5173/app/discovery", {
  waitUntil: "networkidle",
});
await page.screenshot({
  path: path.join(output, "03-discovery-desktop.png"),
  fullPage: true,
});
await page.goto("http://127.0.0.1:5173/app/rfqs", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "New rfq", exact: false }).click();
await page.getByRole("dialog").waitFor();
await page.screenshot({ path: path.join(output, "04-rfq-form-desktop.png") });
await page.getByRole("button", { name: "Close dialog" }).click();
await page.setViewportSize({ width: 390, height: 844 });
await page.goto("http://127.0.0.1:5173/app", { waitUntil: "networkidle" });
await page.screenshot({
  path: path.join(output, "05-admin-mobile.png"),
  fullPage: true,
});
const overflow = await page.evaluate(() => ({
  width: innerWidth,
  scroll: document.documentElement.scrollWidth,
}));
await page.getByRole("button", { name: "Open navigation" }).click();
await page.screenshot({ path: path.join(output, "06-navigation-mobile.png") });
await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
await page.screenshot({
  path: path.join(output, "07-landing-mobile.png"),
  fullPage: true,
});
const landingOverflow = await page.evaluate(() => ({
  width: innerWidth,
  scroll: document.documentElement.scrollWidth,
}));
await page.setViewportSize({ width: 1440, height: 1050 });
for (const [index, role, route] of [
  ["08", "buyer", "/app"],
  ["09", "supplier", "/app/catalog"],
  ["10", "recruiter", "/app"],
  ["11", "hr", "/app/candidates"],
  ["12", "technology", "/app/demos"],
  ["13", "finance", "/app/invoices"],
]) {
  await page.goto("http://127.0.0.1:5173/login?demo=true", {
    waitUntil: "networkidle",
  });
  await page.getByLabel("Demo workspace role").selectOption(role);
  await page.getByRole("button", { name: /^Explore .* workspace$/ }).click();
  await page.waitForURL("**/app");
  await page.goto(`http://127.0.0.1:5173${route}`, {
    waitUntil: "networkidle",
  });
  await page.locator("main h1").waitFor();
  await page.screenshot({
    path: path.join(output, `${index}-${role}-desktop.png`),
    fullPage: true,
  });
}
await writeFile(
  path.join(output, "preview-report.json"),
  JSON.stringify(
    { routes: checks, errors, overflow, landingOverflow },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    { routes: checks, errors, overflow, landingOverflow, screenshots: output },
    null,
    2,
  ),
);
await browser.close();
if (
  errors.length ||
  checks.some((c) => !c.loaded) ||
  overflow.scroll > overflow.width ||
  landingOverflow.scroll > landingOverflow.width
)
  process.exitCode = 1;
