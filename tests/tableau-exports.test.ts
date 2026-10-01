import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { DOMParser, type Element } from "@xmldom/xmldom";
import { parse } from "csv-parse/sync";
import { strFromU8, unzipSync } from "fflate";
import { tableauArchive, tableauFiles } from "../server/tableau-exports.js";
import { reportViews } from "../shared/analytics.js";
import { analyticsFixture } from "./fixtures/analytics-report.js";

const children = (parent: Element, name: string) =>
  Array.from(parent.childNodes).filter(
    (node): node is Element => node.nodeType === 1 && node.nodeName === name,
  );
const elements = (parent: Element, name: string) =>
  Array.from(parent.getElementsByTagName(name));
function workbook(files: Record<string, Uint8Array>) {
  const errors: string[] = [];
  const doc = new DOMParser({
    onError: (level, message) => errors.push(`${level}: ${message}`),
  }).parseFromString(strFromU8(files["VS PartnerHub.twb"]), "text/xml");
  expect(errors).toEqual([]);
  expect(doc.doctype).toBeNull();
  expect(doc.documentElement!.tagName).toBe("workbook");
  return doc.documentElement!;
}

describe("Packaged Tableau dashboards", () => {
  it("links all eight dashboards, sheets and CSV connections without missing fields or overlapping panels", () => {
    const report = analyticsFixture();
    const archive = tableauArchive(report);
    const files = unzipSync(archive);
    const root = workbook(files);
    const sources = children(children(root, "datasources")[0], "datasource");
    const sheets = children(children(root, "worksheets")[0], "worksheet");
    const dashboards = children(children(root, "dashboards")[0], "dashboard");
    const windows = children(children(root, "windows")[0], "window");
    // Native Tableau rejects a structurally valid XML file when the required
    // workbook provenance or window content-model elements are absent.
    expect(root.getAttribute("source-build")).toMatch(/\S/);
    for (const window of windows) {
      const nodes = Array.from(window.childNodes)
        .filter((node) => node.nodeType === 1)
        .map((node) => node.nodeName);
      expect(nodes).toEqual(
        window.getAttribute("class") === "dashboard"
          ? ["viewpoints", "active", "device-preview"]
          : ["cards", "viewpoint"],
      );
    }
    expect(
      dashboards.map((dashboard) => dashboard.getAttribute("name")),
    ).toEqual(report.views.map((view) => view.title));
    expect(
      new Set(sheets.map((sheet) => sheet.getAttribute("name"))).size,
    ).toBe(sheets.length);
    for (const source of sources) {
      const connection = elements(source, "connection").find(
        (item) => item.getAttribute("class") === "textscan",
      )!;
      const file = `${connection.getAttribute("directory")}/${connection.getAttribute("filename")}`;
      expect(file).toMatch(/^Data\/[a-z_]+\.csv$/);
      expect(connection.getAttribute("server")).toBe("");
      expect(files[file], file).toBeTruthy();
      const csv = parse(strFromU8(files[file]), { bom: true });
      expect(csv[0]).toEqual(
        children(source, "column").map((column) =>
          column.getAttribute("name")!.slice(1, -1),
        ),
      );
      expect(csv.every((row: unknown[]) => row.length === csv[0].length)).toBe(
        true,
      );
    }
    for (const sheet of sheets) {
      const dependency = elements(sheet, "datasource-dependencies")[0];
      const source = sources.find(
        (item) =>
          item.getAttribute("name") === dependency.getAttribute("datasource"),
      );
      expect(source).toBeTruthy();
      const known = children(source!, "column").map((column) =>
        column.getAttribute("name"),
      );
      for (const field of elements(dependency, "column-instance"))
        expect(known).toContain(field.getAttribute("column"));
      const instances = elements(dependency, "column-instance").map((column) =>
        column.getAttribute("name"),
      );
      for (const field of [
        ...elements(sheet, "text"),
        ...elements(sheet, "filter"),
      ]) {
        const value = field.getAttribute("column")!;
        expect(instances).toContain(value.slice(value.indexOf("].") + 2));
      }
      const chart = elements(sheet, "mark")[0];
      expect(["Text", "Line", "Bar"]).toContain(chart.getAttribute("class"));
    }
    for (const dashboard of dashboards) {
      const container = children(children(dashboard, "zones")[0], "zone")[0];
      const panels = children(container, "zone");
      const boxes: { x: number; y: number; w: number; h: number }[] = [];
      for (const panel of panels) {
        const box = Object.fromEntries(
          ["x", "y", "w", "h"].map((key) => [
            key,
            Number(panel.getAttribute(key)),
          ]),
        ) as (typeof boxes)[number];
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.w).toBeLessThanOrEqual(100000);
        expect(box.y + box.h).toBeLessThanOrEqual(100000);
        for (const other of boxes)
          expect(
            box.x + box.w <= other.x ||
              other.x + other.w <= box.x ||
              box.y + box.h <= other.y ||
              other.y + other.h <= box.y,
          ).toBe(true);
        boxes.push(box);
        if (panel.hasAttribute("name"))
          expect(
            sheets.some(
              (sheet) =>
                sheet.getAttribute("name") === panel.getAttribute("name"),
            ),
          ).toBe(true);
      }
      expect(
        windows.some(
          (window) =>
            window.getAttribute("class") === "dashboard" &&
            window.getAttribute("name") === dashboard.getAttribute("name"),
        ),
      ).toBe(true);
    }
    mkdirSync("artifacts/tableau-verification", { recursive: true });
    writeFileSync("artifacts/tableau-verification/test-workbook.twbx", archive);
  });

  it("keeps original money, rates, nulls and zeroes while presenting correctly formatted KPI values", () => {
    const report = analyticsFixture();
    const files = tableauFiles(report);
    expect(JSON.parse(strFromU8(files["Data/analytics.json"]))).toEqual(report);
    const rows = parse(strFromU8(files["Data/finance_metrics.csv"]), {
      columns: true,
      bom: true,
    });
    expect(rows.find((row: any) => row.metric === "amount")).toMatchObject({
      value: "12345678",
      display_value: "₹1,23,456.78",
      currency: "INR",
    });
    expect(rows.find((row: any) => row.metric === "response")).toMatchObject({
      value: "42.5",
      display_value: "42.5%",
    });
    expect(rows.find((row: any) => row.metric === "missing")).toMatchObject({
      value: "",
      display_value: "—",
    });
    expect(
      rows.every(
        (row: any) =>
          row.period_start === report.from &&
          row.period_end === report.to &&
          row.snapshot_at === report.generatedAt,
      ),
    ).toBe(true);
    const distribution = parse(
      strFromU8(files["Data/finance_distribution.csv"]),
      { columns: true, bom: true },
    );
    expect(distribution[1].records).toBe("0");
    expect(distribution[1].category).toBe(
      '\'=HYPERLINK("https://example.test")',
    );
  });

  it("escapes hostile text, keeps negative numeric values numeric, and includes no external credential or connection", () => {
    const report = analyticsFixture();
    const view = report.views[0];
    view.description =
      '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///private">]>&"\u0001';
    view.metrics[0].label = 'Count & <not-an-element> "quoted"';
    view.tables[0].rows[0].label = view.metrics[0].label;
    view.tables[0].rows[0].value = -42.5;
    const files = tableauFiles(report);
    const root = workbook(files);
    expect(elements(root, "not-an-element")).toHaveLength(0);
    const raw = parse(strFromU8(files["Data/executive_metrics.csv"]), {
      columns: true,
      bom: true,
    });
    expect(raw[0].value).toBe("-42.5");
    expect(raw[0].label).toBe(view.metrics[0].label);
    expect(strFromU8(files["VS PartnerHub.twb"])).not.toMatch(
      /phk_|Authorization|repository-location|<!DOCTYPE/,
    );
    expect(
      elements(root, "connection").every(
        (connection) => !connection.getAttribute("server"),
      ),
    ).toBe(true);
  });

  it("does not synthesize unauthorized dashboards or fill empty sources with sample records", () => {
    const report = analyticsFixture();
    report.views = report.views.filter((view) => view.id === "recruitment");
    report.views[0].trend = [];
    report.views[0].tables.find((table) => table.id === "trend")!.rows = [];
    const files = tableauFiles(report);
    const manifest = JSON.parse(strFromU8(files["manifest.json"]));
    expect(manifest.dashboards.map((view: any) => view.id)).toEqual([
      "recruitment",
    ]);
    for (const id of reportViews.filter((id) => id !== "recruitment"))
      expect(
        Object.keys(files).some((name) => name.startsWith(`Data/${id}_`)),
      ).toBe(false);
    const csv = parse(strFromU8(files["Data/recruitment_trend.csv"]), {
      columns: true,
      bom: true,
    });
    expect(csv).toEqual([]);
    expect(elements(workbook(files), "dashboard")).toHaveLength(1);
  });
});
