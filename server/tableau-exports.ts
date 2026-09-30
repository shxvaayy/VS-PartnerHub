import { strToU8, zipSync } from "fflate";
import type {
  AnalyticsReport,
  ReportCell,
  ReportColumn,
  ReportFormat,
  ReportTable,
  ReportView,
} from "../shared/analytics.js";
import { biAccent, biValue } from "../shared/bi.js";

type Files = Record<string, Uint8Array>;
type Source = { id: string; caption: string; file: string; table: ReportTable };
type Sheet = { name: string; xml: string };
const workbookName = "VS PartnerHub.twb";
const width = 1366;
const height = 1040;

// Tableau's legacy relational workbook format remains editable in current Desktop.
// Format references and the independent parser check are documented in ANALYTICS.md.
const xml = (value: unknown) =>
  String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll("\r", "&#13;")
    .replaceAll("\n", "&#10;");
const attrs = (values: Record<string, unknown>) =>
  Object.entries(values)
    .map(([key, value]) => `${key}="${xml(value)}"`)
    .join(" ");
const tag = (
  name: string,
  attributes: Record<string, unknown> = {},
  children?: string,
) =>
  children === undefined
    ? `<${name} ${attrs(attributes)}/>`
    : `<${name} ${attrs(attributes)}>${children}</${name}>`;
const format = (attr: string, value: unknown) => tag("format", { attr, value });
const text = (value: unknown) => xml(value);
const stringType = (column: ReportColumn) => column.format === "text";
const datatype = (column: ReportColumn) =>
  stringType(column)
    ? "string"
    : column.format === "number"
      ? "integer"
      : "real";
const member = (key: string) => `[${key}]`;
const instance = (column: ReportColumn) =>
  stringType(column) ? `[none:${column.key}:nk]` : `[sum:${column.key}:qk]`;
const reference = (source: Source, column: ReportColumn) =>
  `[${source.id}].${instance(column)}`;

function csvCell(value: ReportCell | undefined) {
  let output = String(value ?? "");
  // A downloaded source may also be opened in a spreadsheet. Preserve negative
  // numeric values; neutralize formulas only in actual string fields.
  if (typeof value === "string" && /^[\s]*[=+@\-\t\r]/.test(value))
    output = "'" + output;
  return `"${output.replaceAll('"', '""')}"`;
}
function csv(source: Source) {
  return strToU8(
    "\uFEFF" +
      [
        source.table.columns.map((column) => csvCell(column.key)).join(","),
        ...source.table.rows.map((row) =>
          source.table.columns
            .map((column) => csvCell(row[column.key]))
            .join(","),
        ),
      ].join("\r\n") +
      "\r\n",
  );
}

function columnDefinition(column: ReportColumn) {
  return tag("column", {
    caption: column.label,
    datatype: datatype(column),
    name: member(column.key),
    role: stringType(column) ? "dimension" : "measure",
    type: stringType(column) ? "nominal" : "quantitative",
  });
}

function sourceXml(source: Source) {
  const connection = `textscan.${source.id}`;
  const columns = source.table.columns;
  return tag(
    "datasource",
    {
      caption: source.caption,
      inline: "true",
      name: source.id,
      version: "10.5",
    },
    tag(
      "connection",
      { class: "federated" },
      tag(
        "named-connections",
        {},
        tag(
          "named-connection",
          { caption: source.caption, name: connection },
          tag("connection", {
            class: "textscan",
            directory: "Data",
            filename: source.file,
            password: "",
            server: "",
          }),
        ),
      ) +
        tag(
          "relation",
          {
            connection,
            name: source.file,
            table: `[${source.file.replace(/\.csv$/, "#csv")}]`,
            type: "table",
          },
          tag(
            "columns",
            {
              "character-set": "UTF-8",
              header: "yes",
              locale: "en_US",
              separator: ",",
              "text-qualifier": '"',
            },
            columns
              .map((column, ordinal) =>
                tag("column", {
                  datatype: datatype(column),
                  name: column.key,
                  ordinal,
                }),
              )
              .join(""),
          ),
        ) +
        tag(
          "cols",
          {},
          columns
            .map((column) =>
              tag("map", {
                key: member(column.key),
                value: `[${source.file}].${member(column.key)}`,
              }),
            )
            .join(""),
        ) +
        tag(
          "metadata-records",
          {},
          columns
            .map((column, ordinal) =>
              tag(
                "metadata-record",
                { class: "column" },
                tag("remote-name", {}, text(column.key)) +
                  tag(
                    "remote-type",
                    {},
                    stringType(column)
                      ? "129"
                      : column.format === "number"
                        ? "20"
                        : "5",
                  ) +
                  tag("local-name", {}, text(member(column.key))) +
                  tag("parent-name", {}, text(`[${source.file}]`)) +
                  tag("remote-alias", {}, text(column.key)) +
                  tag("ordinal", {}, String(ordinal)) +
                  tag("local-type", {}, datatype(column)) +
                  tag("aggregation", {}, stringType(column) ? "Count" : "Sum") +
                  tag("contains-null", {}, "true"),
              ),
            )
            .join(""),
        ),
    ) +
      tag("aliases", { enabled: "yes" }) +
      columns.map(columnDefinition).join(""),
  );
}

function worksheet(
  source: Source,
  name: string,
  title: string,
  options: {
    rows?: string[];
    cols?: string[];
    label?: string;
    metric?: string;
    mark?: "Text" | "Bar" | "Line";
    accent: string;
  },
): Sheet {
  const used = new Set([
    ...(options.rows || []),
    ...(options.cols || []),
    ...(options.label ? [options.label] : []),
    ...(options.metric ? ["metric"] : []),
  ]);
  const columns = source.table.columns.filter((column) => used.has(column.key));
  const resolve = (key: string) => {
    const column = columns.find((column) => column.key === key);
    if (!column)
      throw new Error(`Tableau source column missing: ${source.id}/${key}`);
    return reference(source, column);
  };
  const shelf = (keys: string[] = []) =>
    keys.length > 1
      ? `(${keys.map(resolve).join(" / ")})`
      : keys.map(resolve).join("");
  const mark = options.mark || "Text";
  return {
    name,
    xml: tag(
      "worksheet",
      { name },
      tag(
        "layout-options",
        {},
        tag(
          "title",
          {},
          tag(
            "formatted-text",
            {},
            tag(
              "run",
              {
                bold: "true",
                fontname: "Arial",
                fontsize: "12",
                fontcolor: "#27352f",
              },
              text(title),
            ),
          ),
        ),
      ) +
        tag(
          "table",
          {},
          tag(
            "view",
            {},
            tag(
              "datasources",
              {},
              tag("datasource", { caption: source.caption, name: source.id }),
            ) +
              tag(
                "datasource-dependencies",
                { datasource: source.id },
                columns.map(columnDefinition).join("") +
                  columns
                    .map((column) =>
                      tag("column-instance", {
                        column: member(column.key),
                        derivation: stringType(column) ? "None" : "Sum",
                        name: instance(column),
                        pivot: "key",
                        type: stringType(column) ? "nominal" : "quantitative",
                      }),
                    )
                    .join(""),
              ) +
              (options.metric
                ? tag(
                    "filter",
                    { class: "categorical", column: resolve("metric") },
                    tag("groupfilter", {
                      function: "member",
                      level: "[none:metric:nk]",
                      member: JSON.stringify(options.metric),
                    }),
                  )
                : "") +
              tag("aggregation", { value: "true" }),
          ) +
            tag(
              "style",
              {},
              tag(
                "style-rule",
                { element: "worksheet" },
                format("font-family", "Arial") + format("font-size", "10"),
              ) +
                tag(
                  "style-rule",
                  { element: "gridline" },
                  format("line-visibility", "off"),
                ),
            ) +
            tag(
              "panes",
              {},
              tag(
                "pane",
                {},
                tag("view", {}, tag("breakdown", { value: "auto" })) +
                  tag("mark", { class: mark }) +
                  (options.label
                    ? tag(
                        "encodings",
                        {},
                        tag("text", { column: resolve(options.label) }),
                      )
                    : "") +
                  tag(
                    "style",
                    {},
                    tag(
                      "style-rule",
                      { element: "mark" },
                      format("mark-color", options.accent) +
                        format(
                          "mark-labels-show",
                          options.label ? "true" : "false",
                        ) +
                        format("mark-labels-cull", "true") +
                        format("font-family", "Arial") +
                        format("font-size", options.metric ? "24" : "10"),
                    ),
                  ),
              ),
            ) +
            tag("rows", {}, text(shelf(options.rows))) +
            tag("cols", {}, text(shelf(options.cols))),
        ),
    ),
  };
}

function prepareSource(
  view: ReportView,
  table: ReportTable,
  report: AnalyticsReport,
): Source {
  const derived =
    table.id === "metrics"
      ? [
          {
            key: "display_value",
            label: "Formatted value",
            format: "text" as const,
          },
        ]
      : [];
  const metadata: ReportColumn[] = [
    { key: "period_start", label: "Period start (UTC)", format: "text" },
    { key: "period_end", label: "Period end (UTC)", format: "text" },
    { key: "snapshot_at", label: "Snapshot timestamp (UTC)", format: "text" },
    { key: "measurement_scope", label: "Measurement scope", format: "text" },
  ];
  return {
    id: `partnerhub_${view.id}_${table.id}`,
    caption: `${view.title} · ${table.title}`,
    file: `${view.id}_${table.id}.csv`,
    table: {
      ...table,
      columns: [...table.columns, ...derived, ...metadata],
      rows: table.rows.map((row) => ({
        ...row,
        ...(table.id === "metrics"
          ? {
              display_value: biValue(
                row.value,
                row.format as ReportFormat,
                report.currency,
              ),
            }
          : {}),
        period_start: report.from,
        period_end: report.to,
        snapshot_at: report.generatedAt,
        measurement_scope: table.scope,
      })),
    },
  };
}

export function tableauFiles(report: AnalyticsReport): Files {
  const files: Files = {};
  const sources: Source[] = [];
  const sheets: Sheet[] = [];
  const dashboards: string[] = [];
  const dashboardWindows: string[] = [];
  for (const view of report.views) {
    const viewSources = view.tables
      .filter((table) => table.columns.length)
      .map((table) => prepareSource(view, table, report));
    sources.push(...viewSources);
    const source = (id: string) => {
      const found = viewSources.find((item) => item.table.id === id);
      if (!found) throw new Error(`Tableau dataset missing: ${view.id}/${id}`);
      return found;
    };
    const accent = biAccent[view.id];
    const viewSheets: Sheet[] = [];
    let id = 1;
    const zone = (
      x: number,
      y: number,
      w: number,
      h: number,
      properties: Record<string, unknown>,
      contents = "",
      background = "#ffffff",
    ) =>
      tag(
        "zone",
        {
          id: ++id,
          x: Math.round((x / width) * 100000),
          y: Math.round((y / height) * 100000),
          w: Math.floor((w / width) * 100000),
          h: Math.floor((h / height) * 100000),
          ...properties,
        },
        contents +
          tag(
            "zone-style",
            {},
            format("background-color", background) +
              format("border-style", "none") +
              format("margin", "12"),
          ),
      );
    const textZone = (
      x: number,
      y: number,
      w: number,
      h: number,
      runs: { value: string; size?: number; color?: string; bold?: boolean }[],
      background = "#f3f6f3",
    ) =>
      zone(
        x,
        y,
        w,
        h,
        { type: "text" },
        tag(
          "formatted-text",
          {},
          runs
            .map((run) =>
              tag(
                "run",
                {
                  fontname: "Arial",
                  fontsize: run.size || 10,
                  fontcolor: run.color || "#536359",
                  bold: run.bold ? "true" : "false",
                },
                text(run.value),
              ),
            )
            .join(""),
        ),
        background,
      );
    const sheetZone = (
      sheet: Sheet,
      x: number,
      y: number,
      w: number,
      h: number,
    ) => {
      viewSheets.push(sheet);
      return zone(x, y, w, h, { name: sheet.name, "show-title": "true" });
    };
    const zones: string[] = [
      textZone(24, 16, 1318, 102, [
        {
          value: "VS PARTNERHUB  /  BUSINESS INTELLIGENCE\n",
          size: 10,
          color: accent,
          bold: true,
        },
        { value: `${view.title}\n`, size: 26, color: "#20382d", bold: true },
        {
          value: `${report.from} — ${report.to} · ${report.currency} · ${view.description}`,
          size: 11,
        },
      ]),
    ];
    const highlighted = view.metrics.slice(0, 4);
    const gap = 16;
    const cardWidth =
      (1318 - gap * Math.max(0, highlighted.length - 1)) /
      Math.max(1, highlighted.length);
    highlighted.forEach((metric, index) =>
      zones.push(
        sheetZone(
          worksheet(
            source("metrics"),
            `${view.title} — ${metric.label}`,
            `${metric.label} · ${metric.scope === "current" ? "Current" : "Period"}`,
            { label: "display_value", metric: metric.key, accent },
          ),
          24 + index * (cardWidth + gap),
          130,
          cardWidth,
          130,
        ),
      ),
    );
    zones.push(
      sheetZone(
        worksheet(source("trend"), `${view.title} — Trend`, view.trendLabel, {
          rows: ["records"],
          cols: ["month"],
          mark: "Line",
          accent,
        }),
        24,
        280,
        736,
        288,
      ),
    );
    zones.push(
      sheetZone(
        worksheet(
          source("distribution"),
          `${view.title} — Distribution`,
          view.distributionLabel,
          {
            rows: ["category"],
            cols: ["records"],
            label: "records",
            mark: "Bar",
            accent,
          },
        ),
        776,
        280,
        566,
        288,
      ),
    );
    zones.push(
      sheetZone(
        worksheet(
          source("metrics"),
          `${view.title} — All KPIs`,
          "All KPIs · values, measurement scope and calculation",
          {
            rows: ["label", "scope", "definition"],
            label: "display_value",
            accent: "#27352f",
          },
        ),
        24,
        588,
        1318,
        324,
      ),
    );
    zones.push(
      textZone(24, 928, 1318, 92, [
        { value: `AUTHORIZED SNAPSHOT · ${report.generatedAt}\n`, bold: true },
        {
          value: [
            ...view.notes,
            "Blank rates mean there is no qualifying evidence. Detail datasets retain minor currency units; there is no exchange-rate conversion. Open the worksheet tabs or Data pane to inspect all included datasets.",
          ].join(" "),
          size: 9,
        },
      ]),
    );
    // Every authorized source remains available in the Data pane. Additional
    // worksheet tabs make detailed, aging and verification datasets inspectable.
    for (const detail of viewSources.filter(
      (item) => !["metrics", "trend", "distribution"].includes(item.table.id),
    )) {
      const fields = detail.table.columns.filter(
        (column) =>
          ![
            "period_start",
            "period_end",
            "snapshot_at",
            "measurement_scope",
          ].includes(column.key),
      );
      const dimensions = fields.filter(stringType).map((column) => column.key);
      const measures = fields.filter((column) => !stringType(column));
      if (measures.length) {
        for (const measure of measures)
          sheets.push(
            worksheet(
              detail,
              `${view.title} — ${detail.table.id} — ${measure.label}`,
              `${detail.table.title} · ${measure.label}${measure.format === "money" ? " (minor currency units)" : ""}`,
              { rows: dimensions, label: measure.key, accent: "#27352f" },
            ),
          );
      } else if (dimensions.length)
        sheets.push(
          worksheet(
            detail,
            `${view.title} — ${detail.table.id}`,
            detail.table.title,
            {
              rows: dimensions.slice(0, -1),
              label: dimensions.at(-1),
              accent: "#27352f",
            },
          ),
        );
    }
    sheets.push(...viewSheets);
    dashboards.push(
      tag(
        "dashboard",
        { name: view.title },
        tag(
          "style",
          {},
          tag(
            "style-rule",
            { element: "table" },
            format("background-color", "#f3f6f3"),
          ),
        ) +
          tag("size", {
            minwidth: width,
            maxwidth: width,
            minheight: height,
            maxheight: height,
          }) +
          tag(
            "zones",
            { "use-insets": "false" },
            tag(
              "zone",
              { type: "layout-basic", id: 1, x: 0, y: 0, w: 100000, h: 100000 },
              zones.join(""),
            ),
          ),
      ),
    );
    dashboardWindows.push(
      tag(
        "window",
        { class: "dashboard", name: view.title, maximized: "true" },
        tag(
          "viewpoints",
          {},
          viewSheets
            .map((sheet) =>
              tag(
                "viewpoint",
                { name: sheet.name },
                tag("zoom", { type: "entire-view" }),
              ),
            )
            .join(""),
        ),
      ),
    );
  }
  for (const source of sources) files[`Data/${source.file}`] = csv(source);
  files[workbookName] = strToU8(
    '<?xml version="1.0" encoding="utf-8"?>\n' +
      tag(
        "workbook",
        {
          version: "10.5",
          "source-platform": "win",
          "xmlns:user": "http://www.tableausoftware.com/xml/user",
        },
        tag("datasources", {}, sources.map(sourceXml).join("")) +
          tag("worksheets", {}, sheets.map((sheet) => sheet.xml).join("")) +
          tag("dashboards", {}, dashboards.join("")) +
          tag(
            "windows",
            {},
            dashboardWindows.join("") +
              sheets
                .map((sheet) =>
                  tag(
                    "window",
                    { class: "worksheet", name: sheet.name },
                    tag("viewpoint", {}, tag("zoom", { type: "fit-width" })),
                  ),
                )
                .join(""),
          ),
      ) +
      "\n",
  );
  files["Data/analytics.json"] = strToU8(
    JSON.stringify(report, null, 2) + "\n",
  );
  files["manifest.json"] = strToU8(
    JSON.stringify(
      {
        format: "PartnerHub Tableau packaged workbook",
        version: 1,
        workbook: workbookName,
        generatedAt: report.generatedAt,
        from: report.from,
        to: report.to,
        currency: report.currency,
        dashboards: report.views.map((view) => ({
          id: view.id,
          title: view.title,
        })),
        datasets: sources.map((source) => ({
          source: source.id,
          file: `Data/${source.file}`,
          scope: source.table.scope,
          rows: source.table.rows.length,
          columns: source.table.columns,
        })),
        refresh:
          "Authorized snapshot; download again from PartnerHub for current data.",
      },
      null,
      2,
    ) + "\n",
  );
  files["README.txt"] = strToU8(`VS PARTNERHUB — TABLEAU DASHBOARDS

Open this .twbx file in Tableau Desktop. It packages ${report.views.length} permitted dashboard(s), their editable worksheets and local CSV sources. No Tableau tenant, API token or database password is embedded. Keep all included files together if you unpack it.

Period: ${report.from} through ${report.to} (inclusive UTC creation dates)
Currency: ${report.currency}; no conversion between currencies
Authorized snapshot: ${report.generatedAt}

Dashboard KPI values are formatted in major currency units and percentages. Original numeric columns retain the API's units: money is in minor units (divide by 100), percent is 0–100, and counts are unchanged. Empty numeric fields are null, not zero. Dataset scope and snapshot timestamps are included. Formula-like string cells are prefixed with an apostrophe for safe spreadsheet opening; Data/analytics.json preserves the exact authorized source values.

Use dashboard tabs for an overview; worksheet tabs and the Data pane expose all included datasets and definitions. Charts, values and permissions match the exported snapshot. Re-download from PartnerHub for current data. This workbook does not claim a live external connection or scheduled refresh. Publish only to your organization's approved private Tableau workspace; this archive contains authorized business data and should not be uploaded to Tableau Public.

Tableau Desktop's renderer and private-server publication require their respective applications and access. Automated export acceptance checks the packaged XML, linked sources, permissions and values with Tableau's Document API and independent CSV/XML parsers; it does not substitute for Desktop rendering acceptance.
`);
  return files;
}

export const tableauArchive = (report: AnalyticsReport) =>
  Buffer.from(zipSync(tableauFiles(report), { level: 6 }));
