import fs from "node:fs/promises";
import path from "node:path";
import { powerBiFiles } from "../server/bi-exports.js";
import { tableauArchive } from "../server/tableau-exports.js";
import { analyticsFixture } from "../tests/fixtures/analytics-report.js";

// Desktop acceptance always uses disposable, explicitly synthetic data.
const report = analyticsFixture();
const root = path.resolve("artifacts/desktop-bi/input");
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
console.log(
  "Prepared eight offline dashboard fixtures for desktop acceptance.",
);
