import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { strFromU8, unzipSync } from "fflate";
import { powerBiArchive, powerBiFiles } from "../server/bi-exports.js";
import { reportLabels, reportViews } from "../shared/analytics.js";
import { biValue } from "../shared/bi.js";
import { analyticsFixture as fixture } from "./fixtures/analytics-report.js";

const schemaDirectory = path.resolve("tests/fixtures/power-bi-schemas");
const schemaIndex = JSON.parse(
  readFileSync(path.join(schemaDirectory, "index.json"), "utf8"),
);
const validator = new Ajv({ allErrors: true, strict: false });
addFormats(validator);
for (const [url, file] of Object.entries(schemaIndex))
  validator.addSchema(
    JSON.parse(readFileSync(path.join(schemaDirectory, String(file)), "utf8")),
    url,
  );

const read = (files: Record<string, Uint8Array>, name: string) =>
  JSON.parse(strFromU8(files[name]));

describe("Native Power BI workspace exports", () => {
  it("validates every project, report, page and visual against the independent Microsoft schemas", () => {
    const files = powerBiFiles(fixture(), "https://partners.example.test");
    let validated = 0;
    for (const [name, bytes] of Object.entries(files)) {
      if (!/\.(json|pbip|pbir|pbism)$/.test(name)) continue;
      const data = JSON.parse(strFromU8(bytes));
      if (!data.$schema) continue;
      const check = validator.getSchema(data.$schema);
      expect(check, name).toBeTypeOf("function");
      expect(check!(data), `${name}: ${JSON.stringify(check!.errors)}`).toBe(
        true,
      );
      validated++;
    }
    expect(validated).toBeGreaterThan(75);
  });

  it("packages all eight linked dashboard pages and resolves every visual field to the included semantic model", () => {
    const files = unzipSync(
      powerBiArchive(fixture(), "https://partners.example.test"),
    );
    const project = read(files, "VS PartnerHub.pbip");
    const reportPath = project.artifacts[0].report.path;
    const report = read(files, `${reportPath}/definition.pbir`);
    const modelPath = path.posix.normalize(
      `${reportPath}/${report.datasetReference.byPath.path}`,
    );
    const model = read(files, `${modelPath}/model.bim`).model;
    const measureNames = model.tables.flatMap((table: any) =>
      (table.measures || []).map((measure: any) =>
        measure.name.toLocaleLowerCase("en-US"),
      ),
    );
    // DAX measure names are model-wide, even when the measures have different
    // home tables. Our fixture deliberately repeats KPI labels across views.
    expect(new Set(measureNames).size).toBe(measureNames.length);
    const pages = read(files, `${reportPath}/definition/pages/pages.json`);
    expect(pages.pageOrder).toEqual([...reportViews]);
    for (const name of pages.pageOrder) {
      const page = read(
        files,
        `${reportPath}/definition/pages/${name}/page.json`,
      );
      expect(page.displayName).toBe(
        reportLabels[name as (typeof reportViews)[number]].title,
      );
      const positions: object[] = [];
      for (const [file, bytes] of Object.entries(files)) {
        if (!file.startsWith(`${reportPath}/definition/pages/${name}/visuals/`))
          continue;
        const visual = JSON.parse(strFromU8(bytes));
        const p = visual.position;
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.x + p.width).toBeLessThanOrEqual(page.width);
        expect(p.y + p.height).toBeLessThanOrEqual(page.height);
        for (const before of positions as (typeof p)[])
          expect(
            p.x + p.width <= before.x ||
              before.x + before.width <= p.x ||
              p.y + p.height <= before.y ||
              before.y + before.height <= p.y,
            file,
          ).toBe(true);
        positions.push(p);
        for (const state of Object.values(
          visual.visual.query?.queryState || {},
        ) as any[])
          for (const item of state.projections) {
            const field = item.field.Aggregation?.Expression || item.field;
            const member = field.Column || field.Measure;
            const table = model.tables.find(
              (t: any) => t.name === member.Expression.SourceRef.Entity,
            );
            expect(table, file).toBeTruthy();
            expect(
              (field.Column ? table.columns : table.measures).some(
                (c: any) => c.name === member.Property,
              ),
              file,
            ).toBe(true);
          }
      }
    }
  });

  it("retains zero, absent evidence, precise amounts and literal text without executing or interpolating source values", () => {
    const source = fixture(),
      files = powerBiFiles(source, "https://partners.example.test");
    const model = read(files, "VS PartnerHub.SemanticModel/model.bim").model;
    const encoded = model.expressions
      .find((item: any) => item.name === "PartnerHubSnapshot")
      .expression.match(/Binary\.FromText\("([A-Za-z0-9+/=]+)"/)[1];
    expect(JSON.parse(Buffer.from(encoded, "base64").toString("utf8"))).toEqual(
      source,
    );
    expect(read(files, "data/analytics.json")).toEqual(source);
    const metrics = model.tables.find(
      (item: any) => item.name === "finance_metrics",
    );
    expect(
      metrics.measures.find((item: any) =>
        item.name.endsWith(": Approved value"),
      ).expression,
    ).toMatch(/\/ 100$/);
    expect(
      metrics.measures.find((item: any) =>
        item.name.endsWith(": Response rate"),
      ).formatString,
    ).toBe("0.0%");
    expect(
      metrics.measures.find((item: any) =>
        item.name.endsWith(": Organizations"),
      ).expression,
    ).not.toContain("/ 100");
    expect(biValue(12345678, "money", "INR")).toBe("₹1,23,456.78");
    expect(biValue(42.5, "percent", "INR")).toBe("42.5%");
    expect(biValue(null, "number", "INR")).toBe("—");
    expect(biValue(0, "number", "INR")).toBe("0");
  });

  it("exports only supplied authorized views and keeps online refresh credentials empty", () => {
    const source = fixture();
    source.views = source.views.filter((view) => view.id === "recruitment");
    const files = powerBiFiles(source, "https://partners.example.test");
    expect(Object.keys(files).some((name) => name.includes("/finance/"))).toBe(
      false,
    );
    const model = read(files, "VS PartnerHub.SemanticModel/model.bim").model;
    expect(
      model.tables.every((table: any) => table.name.startsWith("recruitment_")),
    ).toBe(true);
    expect(
      model.expressions.find(
        (item: any) => item.name === "PartnerHubAccessToken",
      ).expression,
    ).toMatch(/^"" meta/);
    for (const table of model.tables) {
      expect(table.partitions[0].source.expression).toContain(
        "PartnerHubOnline",
      );
      expect(table.partitions[0].source.expression).toContain(
        'then error "Your current integration token cannot access',
      );
    }
    expect(() =>
      powerBiArchive(source, "https://password@partners.example.test"),
    ).toThrow();
  });
});
