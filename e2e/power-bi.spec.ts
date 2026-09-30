import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import { reportViews, type AnalyticsReport } from "../shared/analytics";

const directory = "artifacts/bi-verification/browser";
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
test.beforeAll(async () => {
  await mkdir(directory, { recursive: true });
});

test("Power BI preview shows all eight authorized dashboards with actual KPI definitions and an editable native project", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page);
  const response = page.waitForResponse(
    (r) => r.url().includes("/api/reports/analytics") && r.ok(),
  );
  await page.goto("/app/reports?presentation=power-bi");
  const report = (await (await response).json()) as AnalyticsReport;
  await expect(
    page.getByRole("heading", { level: 1, name: "Power BI preview" }),
  ).toBeVisible();
  expect(report.views.map((view) => view.id)).toEqual([...reportViews]);
  for (const view of report.views) {
    await page
      .getByRole("navigation", { name: "Power BI dashboard pages" })
      .getByRole("button", { name: new RegExp(view.title) })
      .click();
    await expect(page.locator(".bi-canvas-heading h2")).toHaveText(view.title);
    await expect(page.locator(".bi-measure-list button")).toHaveCount(
      view.metrics.length,
    );
    await page.locator(".bi-kpi").first().click();
    await expect(
      page.getByRole("dialog").locator(".bi-metric-detail p"),
    ).toHaveText(view.metrics[0].definition);
    await page.getByRole("button", { name: "Close dialog" }).click();
    if (["executive", "finance"].includes(view.id)) {
      await accessible(page);
      await page.screenshot({
        path: `${directory}/${view.id}-desktop.png`,
        fullPage: true,
      });
    }
  }
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download Power BI project", exact: true })
    .click();
  const download = await pending;
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toMatch(/Power-BI.*\.zip$/);
  const bytes = await readFile((await download.path())!);
  const files = unzipSync(bytes);
  const source = JSON.parse(strFromU8(files["data/analytics.json"]));
  expect(source.views).toEqual(report.views);
  expect(
    Object.keys(files).filter((file) => file.endsWith("/page.json")),
  ).toHaveLength(8);
  expect(strFromU8(files["VS PartnerHub.SemanticModel/model.bim"])).not.toMatch(
    /phk_[a-f0-9]{64}/,
  );
  await writeFile(`${directory}/Power-BI-Workspace.zip`, bytes);
  expect(errors).toEqual([]);
});

test("Power BI preview remains usable on narrow phones with accessible navigation, definitions and datasets", async ({
  page,
}) => {
  await login(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/app/reports?presentation=power-bi&view=finance");
  await expect(page.locator(".bi-canvas-heading h2")).toHaveText("Finance");
  await expect(
    page
      .getByRole("navigation", { name: "Power BI dashboard pages" })
      .getByRole("button", { name: /Finance/ }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.locator(".bi-kpi").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await accessible(page);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByLabel("Dataset", { exact: true }).selectOption("aging");
  await expect(
    page.getByRole("region", { name: /aging.*table/i }),
  ).toBeVisible();
  await accessible(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `${directory}/finance-mobile.png`,
    fullPage: true,
  });
});

test("Power BI preview links preserve reporting filters and direct links respect the current role", async ({
  page,
}) => {
  await login(page, "hr");
  await page.goto("/app/reports?from=2020-01-01&to=2020-01-31&currency=USD");
  await page
    .getByRole("button", { name: "Power BI preview", exact: true })
    .click();
  await expect(page).toHaveURL(/presentation=power-bi/);
  await expect(
    page.getByLabel("Reporting currency", { exact: true }),
  ).toHaveValue("USD");
  await expect(
    page
      .getByRole("navigation", { name: "Power BI dashboard pages" })
      .getByRole("button", { name: /Finance/ }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: "Power BI preview" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Reports & analytics" }),
  ).toBeVisible();
  await expect(page.getByLabel("From date", { exact: true })).toHaveValue(
    "2020-01-01",
  );
  await page.goBack();
  await expect(
    page.getByRole("heading", { level: 1, name: "Power BI preview" }),
  ).toBeVisible();
});
