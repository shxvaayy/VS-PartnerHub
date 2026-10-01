import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import type {
  AnalyticsReport,
  ReportColumn,
  ReportMetric,
  ReportTable,
  ReportView,
} from "../shared/analytics.js";
import { biAccent, biColors, biHighlights } from "../shared/bi.js";

const schemas = {
  project:
    "https://developer.microsoft.com/json-schemas/fabric/pbip/pbipProperties/1.0.0/schema.json",
  reportProperties:
    "https://developer.microsoft.com/json-schemas/fabric/item/report/definitionProperties/2.0.0/schema.json",
  modelProperties:
    "https://developer.microsoft.com/json-schemas/fabric/item/semanticModel/definitionProperties/1.0.0/schema.json",
  report:
    "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/report/3.0.0/schema.json",
  reportVersion:
    "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/versionMetadata/1.0.0/schema.json",
  pages:
    "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/1.0.0/schema.json",
  page: "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/2.0.0/schema.json",
  visual:
    "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.1.0/schema.json",
};
type Files = Record<string, Uint8Array>;
const json = (value: unknown) => strToU8(JSON.stringify(value, null, 2) + "\n");
const identity = (value: string) =>
  createHash("sha256").update(value).digest("hex").slice(0, 20);
const mText = (value: string) =>
  '"' + value.replaceAll('"', '""').replaceAll("#(", "#(#)(") + '"';
const daxText = (value: string) => '"' + value.replaceAll('"', '""') + '"';
const literal = (value: string | number | boolean) => ({
  expr: {
    Literal: {
      Value:
        typeof value === "string"
          ? "'" + value.replaceAll("'", "''") + "'"
          : String(value) + (typeof value === "number" ? "D" : ""),
    },
  },
});
const fill = (color: string) => ({ solid: { color: literal(color) } });
const tableName = (view: ReportView, table: ReportTable) =>
  `${view.id}_${table.id}`;
const measureName = (view: ReportView, metric: ReportMetric) =>
  `${view.title}: ${metric.label}`;

function formatString(format: ReportMetric["format"], currency: string) {
  if (format === "money") return `"${currency} "#,0.00;"${currency} "-#,0.00`;
  if (format === "percent") return "0.0%";
  return format === "number" ? "#,0" : "#,0.00";
}

function partition(view: ReportView, table: ReportTable) {
  const columns = table.columns.map((column) => mText(column.key)).join(", ");
  const types = table.columns
    .map(
      (column) =>
        `{${mText(column.key)}, ${column.format === "text" ? "type text" : "type number"}}`,
    )
    .join(", ");
  return `let
    Source = if Text.Length(Text.Trim(PartnerHubAccessToken)) = 0 then PartnerHubSnapshot else PartnerHubOnline,
    Views = List.Select(Source[views], each [id] = ${mText(view.id)}),
    View = if List.IsEmpty(Views) then error "Your current integration token cannot access this report." else Views{0},
    Tables = List.Select(View[tables], each [id] = ${mText(table.id)}),
    Dataset = if List.IsEmpty(Tables) then error "Your current integration token cannot access this dataset." else Tables{0},
    Rows = Table.FromRecords(Dataset[rows], {${columns}}, MissingField.UseNull),
    Typed = Table.TransformColumnTypes(Rows, {${types}}, "en-US")
in
    Typed`;
}

function model(report: AnalyticsReport, appUrl: string) {
  const address = new URL(appUrl);
  if (
    address.username ||
    address.password ||
    !["http:", "https:"].includes(address.protocol)
  )
    throw new Error("Use a public application origin without credentials.");
  const snapshot = Buffer.from(JSON.stringify(report)).toString("base64");
  return {
    name: "VS PartnerHub",
    compatibilityLevel: 1600,
    model: {
      culture: "en-US",
      defaultPowerBIDataSourceVersion: "powerBI_V3",
      sourceQueryCulture: "en-US",
      dataAccessOptions: {
        legacyRedirects: true,
        returnErrorValuesAsNull: true,
      },
      expressions: [
        {
          name: "PartnerHubSnapshot",
          kind: "m",
          expression: `Json.Document(Binary.FromText("${snapshot}", BinaryEncoding.Base64))`,
        },
        {
          name: "PartnerHubAccessToken",
          kind: "m",
          expression:
            '"" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=false]',
          description:
            "Leave blank to load the included snapshot. Set a revocable Reports integration token to refresh authorized data.",
        },
        {
          name: "PartnerHubOnline",
          kind: "m",
          expression: `Json.Document(Web.Contents(${mText(address.origin)}, [RelativePath="api/integration/reports/analytics", Query=[from=${mText(report.from)}, to=${mText(report.to)}, currency=${mText(report.currency)}], Headers=[Authorization="Bearer " & PartnerHubAccessToken], Timeout=#duration(0,0,2,0)]))`,
        },
      ],
      tables: report.views.flatMap((view) =>
        view.tables
          .filter((table) => table.columns.length)
          .map((table) => ({
            name: tableName(view, table),
            description: `${view.title} · ${table.title}. ${table.description}`,
            columns: [
              ...table.columns.map((column) => ({
                name: column.key,
                sourceColumn: column.key,
                dataType: column.format === "text" ? "string" : "double",
                description: column.label,
                summarizeBy: "none",
                ...(column.format === "text" ? {} : { formatString: "#,0.##" }),
              })),
              ...(table.id === "metrics"
                ? [
                    {
                      name: "display_value",
                      type: "calculated",
                      dataType: "string",
                      summarizeBy: "none",
                      description:
                        "KPI value with its currency or percentage unit. Absent evidence stays blank.",
                      expression:
                        'IF(ISBLANK([value]), BLANK(), SWITCH([format], "money", FORMAT([value] / 100, "#,0.00") & " " & [currency], "percent", FORMAT([value] / 100, "0.0%"), FORMAT([value], IF(ROUND([value], 2) = INT(ROUND([value], 2)), "#,0", "#,0.##"))))',
                    },
                  ]
                : []),
            ],
            partitions: [
              {
                name: tableName(view, table),
                mode: "import",
                source: { type: "m", expression: partition(view, table) },
              },
            ],
            ...(table.id === "metrics"
              ? {
                  measures: view.metrics.map((metric) => ({
                    name: measureName(view, metric),
                    description: `${metric.definition} Scope: ${metric.scope}.`,
                    expression: `CALCULATE(MAX('${tableName(view, table)}'[value]), '${tableName(view, table)}'[metric] = ${daxText(metric.key)})${["money", "percent"].includes(metric.format) ? " / 100" : ""}`,
                    formatString: formatString(metric.format, report.currency),
                  })),
                }
              : {}),
          })),
      ),
      annotations: [
        { name: "PartnerHubSnapshotAt", value: report.generatedAt },
        {
          name: "PartnerHubMeasurementScope",
          value:
            "Creation-period metrics and labelled current snapshots; no currency conversion.",
        },
      ],
    },
  };
}

function projection(
  table: string,
  column: string,
  kind: "Column" | "Measure" = "Column",
  displayName?: string,
) {
  return {
    field: {
      [kind]: {
        Expression: { SourceRef: { Entity: table } },
        Property: column,
      },
    },
    queryRef: `${table}.${column}`,
    ...(displayName ? { displayName } : {}),
  };
}
function countProjection(table: string) {
  return {
    field: {
      Aggregation: {
        Expression: {
          Column: {
            Expression: { SourceRef: { Entity: table } },
            Property: "records",
          },
        },
        Function: 0,
      },
    },
    queryRef: `Sum(${table}.records)`,
    displayName: "Records",
  };
}
type Position = { x: number; y: number; width: number; height: number };
function visual(
  name: string,
  type: string,
  title: string,
  position: Position,
  queryState?: Record<string, unknown>,
  objects?: Record<string, unknown>,
  sort?: { field: object; direction: "Ascending" | "Descending" },
) {
  return {
    $schema: schemas.visual,
    name: identity(name),
    position: {
      ...position,
      z: position.y * 10 + position.x,
      tabOrder: position.y * 10 + position.x,
    },
    visual: {
      visualType: type,
      ...(queryState
        ? {
            query: {
              queryState,
              ...(sort
                ? { sortDefinition: { sort: [sort], isDefaultSort: false } }
                : {}),
            },
          }
        : {}),
      ...(objects ? { objects } : {}),
      visualContainerObjects: {
        title: [
          {
            properties: {
              show: literal(type !== "textbox"),
              text: literal(title),
              fontSize: literal(11),
              bold: literal(true),
              fontColor: fill("#27352f"),
              titleWrap: literal(true),
            },
          },
        ],
        background: [
          {
            properties: {
              show: literal(type !== "textbox"),
              color: fill("#ffffff"),
              transparency: literal(0),
            },
          },
        ],
        border: [
          {
            properties: {
              show: literal(type !== "textbox"),
              color: fill("#e0e6e1"),
              radius: literal(4),
            },
          },
        ],
      },
    },
  };
}

function pageVisuals(view: ReportView, report: AnalyticsReport) {
  const metricTable = `${view.id}_metrics`;
  const accent = biAccent[view.id];
  const title = visual(
    `${view.id}-title`,
    "textbox",
    view.title,
    { x: 24, y: 16, width: 900, height: 72 },
    undefined,
    {
      general: [
        {
          properties: {
            paragraphs: [
              {
                textRuns: [
                  {
                    value: `VS PARTNERHUB  /  ${view.title}`,
                    textStyle: {
                      fontFamily: "Segoe UI",
                      fontSize: "20pt",
                      fontWeight: "bold",
                      color: "#ffffff",
                    },
                  },
                ],
              },
              {
                textRuns: [
                  {
                    value: view.description,
                    textStyle: {
                      fontFamily: "Segoe UI",
                      fontSize: "10pt",
                      color: "#d7e5de",
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    },
  );
  const period = visual(
    `${view.id}-period`,
    "textbox",
    "Reporting period and snapshot",
    { x: 924, y: 16, width: 332, height: 72 },
    undefined,
    {
      general: [
        {
          properties: {
            paragraphs: [
              {
                textRuns: [
                  {
                    value: `REPORTING PERIOD · ${report.currency}`,
                    textStyle: { fontSize: "9pt", color: "#d7e5de" },
                  },
                ],
              },
              {
                textRuns: [
                  {
                    value: `${report.from} – ${report.to}`,
                    textStyle: { fontSize: "12pt", color: "#ffffff" },
                  },
                ],
              },
              {
                textRuns: [
                  {
                    value: `Snapshot ${report.generatedAt.slice(0, 16).replace("T", " ")} UTC`,
                    textStyle: { fontSize: "9pt", color: "#d7e5de" },
                  },
                ],
              },
            ],
          },
        },
      ],
    },
  );
  for (const header of [title, period])
    header.visual.visualContainerObjects.background[0].properties = {
      show: literal(true),
      color: fill("#173f35"),
      transparency: literal(0),
    };
  const highlighted = view.metrics.slice(0, biHighlights);
  const cardColumns =
    highlighted.length <= 4
      ? Math.max(1, highlighted.length)
      : Math.ceil(highlighted.length / 2);
  const cards = highlighted.map((metric, index) => {
    const row = Math.floor(index / cardColumns);
    const rowCount = Math.min(
      cardColumns,
      highlighted.length - row * cardColumns,
    );
    const cardWidth = (1232 - (rowCount - 1) * 12) / rowCount;
    return visual(
      `${view.id}-metric-${metric.key}`,
      "card",
      metric.label,
      {
        x: 24 + (index % cardColumns) * (cardWidth + 12),
        y: 100 + row * 90,
        width: cardWidth,
        height: 78,
      },
      {
        Values: {
          projections: [
            projection(
              metricTable,
              measureName(view, metric),
              "Measure",
              metric.label,
            ),
          ],
        },
      },
      {
        labels: [
          { properties: { fontSize: literal(26), color: fill(accent) } },
        ],
        categoryLabels: [{ properties: { show: literal(false) } }],
      },
    );
  });
  const chartY = 102 + Math.max(1, Math.ceil(cards.length / cardColumns)) * 90;
  const chartObjects = {
    dataPoint: [{ properties: { defaultColor: fill(accent) } }],
    categoryAxis: [{ properties: { showAxisTitle: literal(false) } }],
    valueAxis: [{ properties: { showAxisTitle: literal(false) } }],
  };
  const charts = [
    visual(
      `${view.id}-trend`,
      "lineChart",
      view.trendLabel,
      { x: 24, y: chartY, width: 760, height: 486 - chartY },
      {
        Category: {
          projections: [
            projection(`${view.id}_trend`, "month", "Column", "Month"),
          ],
        },
        Y: { projections: [countProjection(`${view.id}_trend`)] },
      },
      chartObjects,
      {
        field: projection(`${view.id}_trend`, "month").field,
        direction: "Ascending",
      },
    ),
    visual(
      `${view.id}-distribution`,
      "barChart",
      view.distributionLabel,
      { x: 796, y: chartY, width: 460, height: 486 - chartY },
      {
        Category: {
          projections: [
            projection(
              `${view.id}_distribution`,
              "category",
              "Column",
              "Category",
            ),
          ],
        },
        Y: { projections: [countProjection(`${view.id}_distribution`)] },
      },
      chartObjects,
      {
        field: countProjection(`${view.id}_distribution`).field,
        direction: "Descending",
      },
    ),
  ];
  const metricsTable = view.tables.find((table) => table.id === "metrics")!;
  const details =
    view.tables.find(
      (table) => table.id === "aging" || table.id === "verification",
    ) ||
    view.tables.find(
      (table) => table.id === "summary" && table.columns.length,
    ) ||
    view.tables.find((table) => table.id === "distribution")!;
  const datasetVisual = (
    table: ReportTable,
    name: string,
    title: string,
    position: Position,
    columns: ReportColumn[],
  ) =>
    visual(
      name,
      "tableEx",
      title,
      position,
      {
        Values: {
          projections: columns.map((column) =>
            projection(
              tableName(view, table),
              column.key,
              "Column",
              column.label,
            ),
          ),
        },
      },
      {
        grid: [{ properties: { rowPadding: literal(4) } }],
        columnHeaders: [
          {
            properties: {
              fontSize: literal(10),
              backColor: fill("#edf3ef"),
              fontColor: fill("#243a30"),
            },
          },
        ],
        values: [{ properties: { fontSize: literal(10) } }],
        total: [{ properties: { show: literal(false) } }],
      },
    );
  return {
    height: 720,
    visuals: [
      title,
      period,
      ...cards,
      ...charts,
      datasetVisual(
        metricsTable,
        `${view.id}-all-metrics`,
        "All KPIs & measurement scope",
        { x: 24, y: 498, width: 610, height: 180 },
        [
          metricsTable.columns.find((column) => column.key === "label")!,
          { key: "display_value", label: "Value", format: "text" },
          metricsTable.columns.find((column) => column.key === "scope")!,
          metricsTable.columns.find((column) => column.key === "definition")!,
        ],
      ),
      datasetVisual(
        details,
        `${view.id}-details`,
        details.title,
        { x: 646, y: 498, width: 610, height: 180 },
        details.columns,
      ),
      visual(
        `${view.id}-scope`,
        "textbox",
        "Measurement notes",
        { x: 24, y: 684, width: 1232, height: 34 },
        undefined,
        {
          general: [
            {
              properties: {
                paragraphs: [
                  {
                    textRuns: [
                      {
                        value:
                          "KPI money is in major currency units; detail tables retain source units. Missing evidence stays blank. Period metrics use creation dates; current snapshots are labelled.",
                        textStyle: { fontSize: "8pt", color: "#56665e" },
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ),
    ],
  };
}

export function powerBiFiles(report: AnalyticsReport, appUrl: string): Files {
  if (!report.views.length)
    throw new Error("No authorized report views are available.");
  const reportDir = "VS PartnerHub.Report",
    modelDir = "VS PartnerHub.SemanticModel";
  const files: Files = {
    "VS PartnerHub.pbip": json({
      $schema: schemas.project,
      version: "1.0",
      artifacts: [{ report: { path: reportDir } }],
      settings: { enableAutoRecovery: true },
    }),
    [`${reportDir}/definition.pbir`]: json({
      $schema: schemas.reportProperties,
      version: "4.0",
      datasetReference: { byPath: { path: `../${modelDir}` } },
    }),
    [`${modelDir}/definition.pbism`]: json({
      $schema: schemas.modelProperties,
      version: "4.0",
      settings: { qnaEnabled: false },
    }),
    [`${modelDir}/model.bim`]: json(model(report, appUrl)),
    [`${reportDir}/definition/version.json`]: json({
      $schema: schemas.reportVersion,
      version: "2.0.0",
    }),
    [`${reportDir}/definition/report.json`]: json({
      $schema: schemas.report,
      themeCollection: {
        customTheme: {
          name: "VSPartnerHub",
          reportVersionAtImport: {
            visual: "2.1.0",
            page: "2.0.0",
            report: "3.0.0",
          },
          type: "RegisteredResources",
        },
      },
      resourcePackages: [
        {
          name: "RegisteredResources",
          type: "RegisteredResources",
          items: [
            {
              name: "VSPartnerHub",
              path: "VSPartnerHub.json",
              type: "CustomTheme",
            },
          ],
        },
      ],
    }),
    [`${reportDir}/StaticResources/RegisteredResources/VSPartnerHub.json`]:
      json({
        name: "VS PartnerHub",
        dataColors: biColors,
        background: "#f4f6f3",
        foreground: "#243a30",
        tableAccent: "#256c54",
        textClasses: {
          label: { fontFace: "Segoe UI", fontSize: 11, color: "#56665e" },
          title: { fontFace: "Segoe UI", fontSize: 14, color: "#243a30" },
        },
      }),
    [`${reportDir}/definition/pages/pages.json`]: json({
      $schema: schemas.pages,
      pageOrder: report.views.map((view) => view.id),
      activePageName: report.views[0].id,
    }),
    "data/analytics.json": json(report),
    "README.txt": strToU8(`VS PartnerHub — Power BI dashboard project

1. Extract the complete ZIP into one folder.
2. Open VS PartnerHub.pbip in a current Power BI Desktop release with Power BI Project support.
3. Select Refresh to load the included, authorized data snapshot. If Desktop prompts Apply changes, select it once and wait for loading to finish. No account or API token is needed for this snapshot.
4. Use the report page tabs to explore the ${report.views.length} included dashboards. All KPI definitions and source tables are available in the semantic model.

Period: ${report.from} through ${report.to} (inclusive UTC creation dates).
Reporting currency: ${report.currency}. Snapshot: ${report.generatedAt}.
KPI cards and the All KPIs table format money in major units and percentages correctly. Detail datasets retain the source units shown in their descriptions. Missing evidence stays blank; no exchange rates or sample business records are inserted.

Optional authorized refresh: in Transform data → Manage parameters, set PartnerHubAccessToken to an expiring integration token with Reports and the required source scopes. Configure ${new URL(appUrl).origin} as Anonymous for Power Query; the query authenticates using its explicit Bearer header. Refresh then requests the same reporting period with current permitted data. An expired token or removed permission fails instead of silently showing a fresh snapshot. Keep configured tokens private when saving or sharing a project.

The browser export preview is ${new URL("/app/reports?presentation=power-bi", appUrl).href}.
This file is a Power BI Desktop project. Publishing into the Power BI service is a separate action in your Microsoft workspace; downloading the project does not publish business data publicly.
`),
  };
  for (const view of report.views) {
    const page = pageVisuals(view, report);
    const directory = `${reportDir}/definition/pages/${view.id}`;
    files[`${directory}/page.json`] = json({
      $schema: schemas.page,
      name: view.id,
      displayName: view.title,
      displayOption: "FitToPage",
      width: 1280,
      height: page.height,
      objects: {
        background: [
          { properties: { color: fill("#f4f6f3"), transparency: literal(0) } },
        ],
      },
    });
    for (const item of page.visuals)
      files[`${directory}/visuals/${item.name}/visual.json`] = json(item);
  }
  return files;
}

export function powerBiArchive(report: AnalyticsReport, appUrl: string) {
  return Buffer.from(zipSync(powerBiFiles(report, appUrl), { level: 6 }));
}
