import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const page = await context.newPage();
const report = [];
const base = process.env.PREVIEW_URL || "http://127.0.0.1:5173";
const dashboardsOnly = process.argv.includes("--dashboards");
async function check(name) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  const violations = result.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    description: v.description,
    nodes: v.nodes.map((n) => ({
      target: n.target,
      message: n.failureSummary,
    })),
  }));
  report.push({ page: name, violations });
  console.log(
    name,
    violations.length
      ? violations.map((v) => `${v.id}: ${v.nodes.length}`).join(", ")
      : "passed",
  );
}
try {
  if (!dashboardsOnly) {
    await page.goto(base, { waitUntil: "networkidle" });
    await check("landing");
    await page.goto(`${base}/register`, { waitUntil: "networkidle" });
    await check("registration");
    await page.goto(`${base}/login?demo=true`, { waitUntil: "networkidle" });
    await check("login");
    await page
      .getByRole("button", { name: "Explore Super Admin workspace" })
      .click();
    await page.waitForURL("**/app");
    await page.locator(".stat-card").first().waitFor();
    await check("dashboard");
    const workspaces = [
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
      "ai",
      "approvals",
      "integrations",
      "master-data",
      "resources",
      "inquiries",
      "insights",
    ];
    for (const route of workspaces) {
      await page.goto(`${base}/app/${route}`, { waitUntil: "networkidle" });
      await check(route);
    }
    for (const kind of [
      "orders",
      "contracts",
      "invoices",
      "candidates",
      "catalog",
      "tickets",
    ]) {
      const result = await page.request.get(
        `${base}/api/records/${kind}?limit=1`,
      );
      const item = (await result.json()).items?.[0];
      if (item) {
        await page.goto(`${base}/app/${kind}/${item.id}`, {
          waitUntil: "networkidle",
        });
        await check(`${kind}-detail`);
      }
    }
    await page.goto(`${base}/app/rfqs`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /New rfq/i }).click();
    await page.getByRole("dialog").locator('input[name="title"]').waitFor();
    await check("rfq-form");
  }
  await page.goto(`${base}/login?demo=true`, { waitUntil: "networkidle" });
  const personas = await page
    .getByLabel("Demo workspace role")
    .locator("option")
    .evaluateAll((options) => options.map((option) => option.value));
  for (const persona of personas) {
    await page.goto(`${base}/login?demo=true`, { waitUntil: "networkidle" });
    await page.getByLabel("Demo workspace role").selectOption(persona);
    await page.getByRole("button", { name: /^Explore .* workspace$/ }).click();
    await page.waitForURL("**/app");
    await page.locator(".stat-card").first().waitFor();
    await check(`dashboard-${persona}`);
  }
  await mkdir("artifacts/local-verification", { recursive: true });
  await writeFile(
    `artifacts/local-verification/${dashboardsOnly ? "role-accessibility-report" : "accessibility-report"}.json`,
    JSON.stringify(report, null, 2),
  );
} finally {
  await browser.close();
}
if (report.some((r) => r.violations.length)) process.exitCode = 1;
