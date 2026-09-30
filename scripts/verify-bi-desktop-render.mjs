import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

assert.equal(process.env.GITHUB_ACTIONS, "true");
assert(process.env.RUNNER_TEMP, "Use the isolated desktop acceptance runner.");
const expected = JSON.parse(
  await fs.readFile("artifacts/desktop-bi/input/expected.json", "utf8"),
);
assert.equal(expected.syntheticData, true);
assert.equal(expected.productionDataRead, false);
assert.equal(expected.externalPublication, false);
const requested = process.argv[2] || "diagnostics";
const view = expected.pages.find((item) => item.id === requested);
assert(view || requested === "diagnostics", "Choose a known dashboard.");
const out = path.resolve("artifacts/desktop-bi/power-bi");
await fs.mkdir(out, { recursive: true });
const report = {
  source: "The report rendered inside the installed Power BI Desktop WebView2",
  page: requested,
  syntheticData: true,
  passed: false,
  checks: [],
  targets: [],
};
const normalize = (value) => value.replace(/\s+/g, " ").trim();
let browser;
try {
  browser = await chromium.connectOverCDP("http://127.0.0.1:9222", {
    timeout: 15000,
  });
  let frame;
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      for (const candidate of page.frames()) {
        const visualCount = await candidate.locator("visual-container").count();
        report.targets.push({
          url: candidate.url().split(/[?#]/)[0],
          visualCount,
        });
        if (visualCount && !frame) frame = candidate;
      }
    }
  }
  if (!frame && !view) {
    const pages = browser.contexts().flatMap((context) => context.pages());
    for (const [index, page] of pages.entries()) {
      await fs.writeFile(
        path.join(out, `desktop-target-${index}.txt`),
        await page.locator("body").innerText({ timeout: 10000 }),
      );
      await page.screenshot({
        path: path.join(out, `desktop-target-${index}.png`),
      });
    }
  }
  assert(frame, "No actual report canvas was found in Desktop's WebView2.");
  const containers = frame
    .locator("visual-container")
    .filter({ visible: true });
  const end = Date.now() + 60000;
  let visuals = [];
  let body = "";
  do {
    visuals = await containers.evaluateAll((elements) =>
      elements.map((element) => ({
        text: (element.innerText || "").replace(/\s+/g, " ").trim(),
        svgElements: element.querySelectorAll("svg").length,
        chartMarks: element.querySelectorAll("svg path, svg rect, svg circle")
          .length,
        html: element.outerHTML.slice(0, 120000),
      })),
    );
    body = normalize(await frame.locator("body").innerText());
    if (
      !view ||
      (body.includes(view.title) &&
        body.includes("123,456.78 INR") &&
        body.includes("42.5%") &&
        visuals.length >= view.metrics.length + 6)
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  } while (Date.now() < end);
  await fs.writeFile(path.join(out, `${requested}-rendered.txt`), body);
  await fs.writeFile(
    path.join(out, `${requested}-visuals.json`),
    JSON.stringify(visuals, null, 2),
  );
  await frame.page().screenshot({
    path: path.join(out, `${requested}-webview.png`),
    fullPage: true,
  });
  if (view) {
    assert(
      body.includes(view.title),
      "The requested report page is not rendered.",
    );
    assert.equal(
      visuals.length,
      view.metrics.length + 6,
      "Some report visuals are missing.",
    );
    assert(
      !visuals.some((item) =>
        /see details|error fetching data|something.s wrong|couldn.t load|couldn.t display|fix this|unable to load/i.test(
          item.text,
        ),
      ),
      "A report visual contains a data or rendering error.",
    );
    report.checks.push({
      name: "All page visuals rendered without error panels",
      passed: true,
    });
    for (const metric of view.metrics) {
      assert(
        visuals.some((item) => item.text.includes(metric.label)),
        `Missing rendered KPI: ${metric.label}`,
      );
    }
    assert(
      body.includes("123,456.78 INR"),
      "The table did not render the amount in major currency units.",
    );
    assert(
      body.includes("42.5%"),
      "The percentage is not rendered with the correct units.",
    );
    assert(
      /\b17\b/.test(body),
      "The populated organization count is not rendered.",
    );
    report.checks.push({
      name: "KPI titles, amount, percentage and count are visible",
      passed: true,
    });
    for (const title of [view.trendLabel, view.distributionLabel]) {
      assert(
        visuals.some(
          (item) =>
            item.text.includes(title) &&
            item.svgElements &&
            item.chartMarks > 1,
        ),
        `The ${title} chart has no rendered marks.`,
      );
    }
    report.checks.push({
      name: "Both charts render their data marks",
      passed: true,
    });
    assert(
      body.includes("All KPIs & measurement scope"),
      "The complete KPI table is missing.",
    );
    report.checks.push({
      name: "The complete KPI table is rendered",
      passed: true,
    });
    report.passed = true;
  }
} catch (error) {
  report.error = error.message;
  if (view) process.exitCode = 1;
} finally {
  report.completedAt = new Date().toISOString();
  await fs.writeFile(
    path.join(out, `${requested}-render-report.json`),
    JSON.stringify(report, null, 2),
  );
  await browser?.close();
}
console.log(
  JSON.stringify({
    page: requested,
    passed: report.passed,
    error: report.error,
  }),
);
