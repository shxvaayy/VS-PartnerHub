import fs from "node:fs/promises";
import path from "node:path";
import { powerBiFiles } from "../server/bi-exports.js";
import { tableauArchive } from "../server/tableau-exports.js";
import { analyticsFixture } from "../tests/fixtures/analytics-report.js";
import type { AnalyticsReport } from "../shared/analytics.js";
import { startNativeFixture } from "./native-fixture.mjs";

// Desktop acceptance always uses disposable, explicitly synthetic data.
async function prepare(
  report: AnalyticsReport,
  root: string,
  visualizationPreview = false,
) {
  await fs.mkdir(root, { recursive: true });
  for (const [name, data] of Object.entries(
    powerBiFiles(report, "https://partners.example.test"),
  )) {
    const filename = path.join(root, "power-bi", name);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, data);
  }
  await fs.writeFile(
    path.join(root, "VS-PartnerHub-Tableau.twbx"),
    tableauArchive(report),
  );
  await fs.writeFile(
    path.join(root, "expected.json"),
    JSON.stringify(
      {
        syntheticData: true,
        productionDataRead: false,
        externalPublication: false,
        visualizationPreview,
        currency: report.currency,
        pages: report.views.map((view) => ({
          id: view.id,
          title: view.title,
          trendLabel: view.trendLabel,
          distributionLabel: view.distributionLabel,
          tables: view.tables.map((table) => ({
            name: `${view.id}_${table.id}`,
            rows: table.rows.length,
            columns: table.columns,
            records: table.rows,
          })),
          metrics: view.metrics,
        })),
      },
      null,
      2,
    ),
  );
}

const root = path.resolve("artifacts/desktop-bi/input");
await prepare(analyticsFixture(), root);

// Capture the actual application's domain-specific reports as well as its
// deliberately repetitive numeric/escaping regression fixture. The additional
// report uses only the existing disposable local demo, never production rows.
const workspace = await startNativeFixture();
try {
  const report: AnalyticsReport = await workspace.analytics();
  for (const view of report.views)
    view.description = `ILLUSTRATIVE DATA · ${view.description}`;
  await prepare(report, path.join(root, "presentation"), true);
} finally {
  await workspace.close();
}
console.log("Prepared regression and illustrative native dashboard projects.");
