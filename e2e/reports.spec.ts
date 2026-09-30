import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
import { PDFDocument } from "pdf-lib";
import { strFromU8, unzipSync } from "fflate";
import {
  reportViews,
  reportLabels,
  type AnalyticsReport,
} from "../shared/analytics";
import { dateInput, money } from "../src/lib/format";

const artifacts = "artifacts/analytics-verification";
async function login(page: Page, role = "admin") {
  await page.goto("/login?demo=true");
  await page.getByLabel("Demo workspace role").selectOption(role);
  await page.getByRole("button", { name: /^Explore .* workspace$/ }).click();
  await expect(page).toHaveURL(/\/app$/);
}
async function accessible(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        reason: n.failureSummary,
      })),
    })),
  ).toEqual([]);
}
async function downloaded(page: Page, button: string) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: button, exact: false }).click();
  const file = await pending;
  expect(await file.failure()).toBeNull();
  return {
    name: file.suggestedFilename(),
    bytes: await readFile((await file.path())!),
  };
}
test.beforeAll(async () => {
  await mkdir(artifacts, { recursive: true });
});

test("all eight reports show their live API values, responsive charts and accessible definitions", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page);
  const payload = page.waitForResponse(
    (r) => r.url().includes("/api/reports/analytics") && r.ok(),
  );
  await page.goto("/app/reports");
  const report = (await (await payload).json()) as AnalyticsReport;
  await expect(
    page.getByRole("heading", { level: 1, name: "Reports & analytics" }),
  ).toBeVisible();
  for (const id of reportViews) {
    const view = report.views.find((v) => v.id === id)!;
    await page
      .getByRole("navigation", { name: "Report categories" })
      .getByRole("button", { name: new RegExp(reportLabels[id].title) })
      .click();
    await expect(page.locator(".analytics-intro h2")).toHaveText(view.title);
    for (const metric of view.metrics) {
      const expected =
        metric.value === null
          ? "—"
          : metric.format === "money"
            ? money(metric.value, report.currency)
            : `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(metric.value)}${metric.format === "percent" ? "%" : ""}`;
      await expect(
        page.locator(`[data-metric="${metric.key}"] .analytics-metric-value`),
      ).toHaveText(expected);
    }
    await page
      .getByRole("button", { name: /^How .* is calculated$/ })
      .first()
      .click();
    await expect(
      page.getByRole("dialog").locator(".analytics-definition p"),
    ).toHaveText(view.metrics[0].definition);
    await page.getByRole("button", { name: "Close dialog" }).click();
    await accessible(page);
    await page.screenshot({
      path: `${artifacts}/${id}-desktop.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("navigation", { name: "Report categories" })
    .getByRole("button", { name: /Finance/ })
    .click();
  await expect(page.locator(".analytics-intro h2")).toHaveText("Finance");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await accessible(page);
  await page.screenshot({
    path: `${artifacts}/finance-mobile.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("report filters, source drill-downs, Tableau, CSV, Power Query and printable PDF work with actual data", async ({
  page,
}) => {
  await login(page);
  await page.goto("/app/reports?view=finance");
  await expect(page.locator(".analytics-intro h2")).toHaveText("Finance");
  await page
    .getByRole("button", { name: "Export & connect", exact: true })
    .click();
  await page
    .getByLabel("Export dataset", { exact: true })
    .selectOption("aging");
  const csv = await downloaded(page, "Download CSV");
  expect(csv.name).toContain("finance-aging");
  const rows = parse(csv.bytes, { columns: true, bom: true });
  expect(rows).toHaveLength(6);
  expect(
    rows.every(
      (r: any) => r.measurement_scope === "current" && r.currency === "INR",
    ),
  ).toBe(true);
  await writeFile(`${artifacts}/invoice-aging.csv`, csv.bytes);
  const connection = await downloaded(page, "Connect Power BI / Power Query");
  expect(connection.name).toMatch(/\.m$/);
  expect(connection.bytes.toString()).toContain(
    "api/integration/reports/analytics",
  );
  expect(connection.bytes.toString()).not.toMatch(/phk_[a-f0-9]{64}/);
  await writeFile(`${artifacts}/Finance-PowerQuery.m`, connection.bytes);
  const tableau = await downloaded(page, "Download Tableau dashboards");
  expect(tableau.name).toMatch(/\.twbx$/);
  const workbook = unzipSync(tableau.bytes);
  const manifest = JSON.parse(strFromU8(workbook["manifest.json"]));
  expect(manifest.dashboards.map((view: any) => view.id)).toEqual([
    ...reportViews,
  ]);
  expect(workbook[manifest.workbook]).toBeTruthy();
  expect(workbook["Data/finance_aging.csv"]).toBeTruthy();
  await writeFile(`${artifacts}/VS-PartnerHub-Tableau.twbx`, tableau.bytes);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".skip-link")).toBeHidden();
  await expect(page.locator(".analytics-print-trend")).toBeVisible();
  await expect(page.locator(".analytics-print-notes")).toContainText(
    "Only completed payment records reduce balances",
  );
  await expect(page.locator(".analytics-print-notes")).toContainText(
    "KPI definitions",
  );
  const pdf = await page.pdf({
    format: "A4",
    printBackground: true,
    margin: { top: "14mm", bottom: "14mm", left: "10mm", right: "10mm" },
  });
  expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(0);
  await writeFile(`${artifacts}/Finance-Report.pdf`, pdf);
  await page.emulateMedia({ media: "screen" });
  await page.getByLabel("From date", { exact: true }).fill("2000-01-01");
  await page.getByLabel("To date", { exact: true }).fill("2000-01-31");
  await page
    .getByLabel("Reporting currency", { exact: true })
    .selectOption("USD");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(
    page.locator('[data-metric="invoices"] .analytics-metric-value'),
  ).toHaveText("0");
  await expect(
    page.getByRole("heading", { name: "No activity in this period" }),
  ).toBeVisible();
  await page
    .getByRole("link", {
      name: "View approved invoice value records",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(
    /\/app\/invoices\?.*from=2000-01-01.*currency=USD/,
  );
  await expect(page.getByLabel("Filter by currency")).toHaveValue("USD");
  await expect(
    page.getByRole("heading", { name: "No matching records" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Clear date filter" }),
  ).toBeVisible();
  await page.goto(
    "/app/reports?from=2000-01-01&to=2000-01-31&view=procurement",
  );
  await expect(
    page.locator('[data-metric="average_quotation"] .analytics-metric-value'),
  ).toHaveText("—");
  await page.getByLabel("From date", { exact: true }).fill("2001-01-01");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(
    page.getByText("Choose a start date on or before the end date.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Last 180 days", exact: true })
    .click();
  await expect(page.locator(".analytics-intro h2")).toHaveText("Procurement");
  await expect(page.getByLabel("From date", { exact: true })).toHaveValue(
    dateInput(-179),
  );
});

test("integration tokens expose only selected reporting sources and can be revoked in the browser", async ({
  page,
}) => {
  await login(page);
  await page.goto("/app/integrations");
  await expect(
    page.getByRole("heading", { name: "Business systems & reporting" }),
  ).toBeVisible();
  await page
    .getByLabel("Token name", { exact: true })
    .fill("Browser finance analytics QA");
  await expect(
    page.getByRole("button", { name: "Create API token", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Finance reports", exact: true })
    .click();
  await page.getByLabel("Token expiry", { exact: true }).selectOption("30");
  const result = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/integrations/tokens") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Create API token", exact: true })
    .click();
  const response = await result;
  expect(response.status()).toBe(201);
  const { token } = await response.json();
  const permitted = await page.request.get(
    "/api/integration/reports/analytics",
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(permitted.status()).toBe(200);
  expect((await permitted.json()).views.map((v: any) => v.id)).toEqual([
    "executive",
    "finance",
  ]);
  expect(
    (
      await page.request.get("/api/integration/records/rfqs", {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).status(),
  ).toBe(403);
  await page.reload();
  await expect(page.locator(".one-time-secret")).toHaveCount(0);
  const connection = page
    .locator(".connection-row")
    .filter({ hasText: "Browser finance analytics QA" });
  await expect(connection).toContainText("Reports & analytics");
  await connection.getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(connection).toContainText("Revoked");
  expect(
    (
      await page.request.get("/api/integration/reports/analytics", {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).status(),
  ).toBe(401);
  await accessible(page);
});

test("hiring requirements reveal and persist the maximum notice period", async ({
  page,
}) => {
  await login(page, "buyer");
  await page.goto("/app/requirements?new=true");
  const dialog = page.getByRole("dialog");
  await dialog
    .locator('[name="title"]')
    .fill("Browser hiring notice period verification");
  await dialog.locator('[name="requirement_type"]').selectOption("hiring");
  await dialog
    .getByLabel("Maximum notice period", { exact: true })
    .fill("Up to 30 days");
  await dialog.locator('[name="required_date"]').fill(dateInput(30));
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/records/requirements") &&
      r.request().method() === "POST",
  );
  await dialog.locator('button[type="submit"]').click();
  const response = await saved;
  expect(response.status()).toBe(201);
  const record = await response.json();
  expect(record.payload.notice_period).toBe("Up to 30 days");
  await page.goto(`/app/requirements/${record.id}`);
  await expect(page.getByText("Up to 30 days", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Up to 30 days", { exact: true })).toBeVisible();
});
