import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

assert.equal(process.env.GITHUB_ACTIONS, "true");
assert(process.env.RUNNER_TEMP, "Use the isolated desktop acceptance runner.");
const expected = JSON.parse(
  await fs.readFile(
    process.argv[3] || "artifacts/desktop-bi/input/expected.json",
    "utf8",
  ),
);
assert.equal(expected.syntheticData, true);
assert.equal(expected.productionDataRead, false);
assert.equal(expected.externalPublication, false);
const requested = process.argv[2] || "diagnostics";
const view = expected.pages.find((item) => item.id === requested);
assert(view || requested === "diagnostics", "Choose a known dashboard.");
const out = path.resolve(process.argv[4] || "artifacts/desktop-bi/power-bi");
const report = {
  source: "The installed Power BI Desktop report's Windows accessibility tree",
  page: requested,
  syntheticData: true,
  visualizationPreview: expected.visualizationPreview === true,
  passed: false,
  checks: [],
};
try {
  const name = view
    ? view.title.replace(/[^a-zA-Z0-9]+/g, "-")
    : "latest-controls";
  const controls = JSON.parse(
    (await fs.readFile(path.join(out, name + ".json"), "utf8")).replace(
      /^\uFEFF/,
      "",
    ),
  );
  const visible = controls.filter(
    (control) =>
      !control.offscreen &&
      control.bounds?.width > 0 &&
      control.bounds?.height > 0,
  );
  const text = visible
    .map((control) => control.name.replace(/\s+/g, " ").trim())
    .join("\n");
  await fs.writeFile(path.join(out, requested + "-rendered.txt"), text);
  if (view) {
    assert(
      text.includes("VS PARTNERHUB / " + view.title),
      "The requested report canvas is not visible.",
    );
    assert(
      !visible.some((control) =>
        /^(See details|Error fetching data)|something.s wrong|couldn.t load|unable to load/i.test(
          control.name,
        ),
      ),
      "A report visual displays an error.",
    );
    report.checks.push({
      name: "Requested report canvas is visible without visual-error panels",
      passed: true,
    });
    const canvas = visible.find(
      (control) =>
        control.type === "ControlType.Group" &&
        control.name === "Power BI Report",
    );
    assert(canvas, "The native report canvas bounds are unavailable.");
    const overlaps = (a, b) =>
      a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y;
    assert(
      !visible.some(
        (control) =>
          control.type === "ControlType.ToolTip" &&
          overlaps(control.bounds, canvas.bounds),
      ),
      "A native tooltip overlaps the report canvas.",
    );
    report.checks.push({
      name: "No native tooltip overlaps the report canvas",
      passed: true,
    });
    const images = visible.filter(
      (control) => control.type === "ControlType.Image",
    );
    for (const metric of view.metrics.slice(0, 8)) {
      const card = images.find((control) =>
        control.name.startsWith(metric.label + " "),
      );
      assert(card, `Missing rendered KPI card: ${metric.label}`);
      if (metric.value === null)
        assert(
          /\(Blank\)/i.test(card.name),
          "The missing-evidence card did not preserve a blank.",
        );
      else
        assert(
          !/\(Blank\)/i.test(card.name),
          `The populated ${metric.label} card is blank.`,
        );
    }
    if (!expected.visualizationPreview) {
      assert(
        /Organizations 17\b/.test(text),
        "The count card does not display 17.",
      );
      assert(
        /42\.50?\s*%/.test(text),
        "The response percentage is not rendered correctly.",
      );
      assert(
        text.includes("123,456.78 INR"),
        "The KPI table does not show the full major-unit amount.",
      );
      report.checks.push({
        name: "Populated KPI cards, full amount, percentage and blank evidence are visible",
        passed: true,
      });
    } else {
      for (const metric of view.metrics.slice(0, 8)) {
        if (
          metric.format !== "number" ||
          metric.value === null ||
          Math.abs(metric.value) >= 1000
        )
          continue;
        const card = images.find((control) =>
          control.name.startsWith(metric.label + " "),
        );
        assert(
          new RegExp("^" + metric.value + "(?:\\b|\\.)").test(
            card.name.slice(metric.label.length).trim(),
          ),
          `The ${metric.label} count does not match the report.`,
        );
      }
      report.checks.push({
        name: "The actual business KPI cards display populated values, correct counts and preserved blanks",
        passed: true,
      });
    }
    for (const title of [view.trendLabel, view.distributionLabel]) {
      assert(
        visible.some(
          (control) =>
            control.type === "ControlType.Group" &&
            control.name.trim() === title,
        ),
        `Missing rendered chart container: ${title}`,
      );
    }
    report.checks.push({
      name: "Both chart containers are visible; screenshots retain the rendered marks for review",
      passed: true,
    });
    assert(
      text.includes("All KPIs & measurement scope"),
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
    path.join(out, requested + "-render-report.json"),
    JSON.stringify(report, null, 2),
  );
}
console.log(
  JSON.stringify({
    page: requested,
    passed: report.passed,
    error: report.error,
  }),
);
