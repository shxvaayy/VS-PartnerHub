import {
  reportLabels,
  reportViews,
  type AnalyticsReport,
  type ReportMetric,
  type ReportView,
} from "../../shared/analytics.js";

export function analyticsFixture(): AnalyticsReport {
  const metrics: ReportMetric[] = [
    {
      key: "count",
      label: "Organizations",
      value: 17,
      format: "number",
      definition: "Count of authorized organizations.",
      scope: "current",
    },
    {
      key: "amount",
      label: "Approved value",
      value: 12345678,
      format: "money",
      definition: "Approved commitments, in minor units.",
      scope: "period",
    },
    {
      key: "response",
      label: "Response rate",
      value: 42.5,
      format: "percent",
      definition: "Responded invitations divided by eligible invitations.",
      scope: "period",
    },
    {
      key: "missing",
      label: "Delivery performance",
      value: null,
      format: "decimal",
      definition: "No confirmed deliveries with dated evidence.",
      scope: "period",
    },
  ];
  const view = (id: (typeof reportViews)[number]): ReportView => ({
    id,
    ...reportLabels[id],
    metrics: structuredClone(metrics),
    trendLabel: "Monthly activity",
    trend: [
      { month: "2041-06", value: 9 },
      { month: "2041-07", value: 13 },
    ],
    distributionLabel: "Organization status",
    distribution: [
      { name: "Active & verified", value: 17 },
      { name: '=HYPERLINK("https://example.test")', value: 0 },
    ],
    dataset: { columns: [], rows: [] },
    notes: ["Current authorized data only."],
    tables: [
      {
        id: "metrics",
        title: "All KPIs",
        description: "Calculation definitions and values",
        scope: "mixed",
        columns: [
          { key: "metric", label: "Metric key", format: "text" },
          { key: "label", label: "Metric", format: "text" },
          { key: "value", label: "Value", format: "decimal" },
          { key: "format", label: "Format", format: "text" },
          { key: "currency", label: "Currency", format: "text" },
          { key: "scope", label: "Scope", format: "text" },
          { key: "definition", label: "Calculation", format: "text" },
        ],
        rows: metrics.map((m) => ({
          metric: m.key,
          label: m.label,
          value: m.value,
          format: m.format,
          currency: m.format === "money" ? "INR" : null,
          scope: m.scope,
          definition: m.definition,
        })),
      },
      {
        id: "trend",
        title: "Monthly activity",
        description: "Creation period",
        scope: "period",
        columns: [
          { key: "month", label: "Month", format: "text" },
          { key: "records", label: "Records", format: "number" },
        ],
        rows: [
          { month: "2041-06", records: 9 },
          { month: "2041-07", records: 13 },
        ],
      },
      {
        id: "distribution",
        title: "Organization status",
        description: "Current status",
        scope: "current",
        columns: [
          { key: "category", label: "Category", format: "text" },
          { key: "records", label: "Records", format: "number" },
        ],
        rows: [
          { category: "Active & verified", records: 17 },
          { category: '=HYPERLINK("https://example.test")', records: 0 },
        ],
      },
    ],
  });
  return {
    version: 1,
    generatedAt: "2041-07-31T12:00:00.000Z",
    from: "2041-06-01",
    to: "2041-07-31",
    currency: "INR",
    views: reportViews.map(view),
  };
}
