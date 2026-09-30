import { modules } from "./domain.js";

export const reportViews = [
  "executive",
  "partners",
  "procurement",
  "performance",
  "recruitment",
  "finance",
  "compliance",
  "support",
] as const;
export type ReportViewId = (typeof reportViews)[number];
export const reportTableIds = [
  "summary",
  "metrics",
  "trend",
  "distribution",
  "aging",
  "verification",
] as const;
export type ReportTableId = (typeof reportTableIds)[number];
export const reportLabels: Record<
  ReportViewId,
  { title: string; description: string }
> = {
  executive: {
    title: "Executive overview",
    description:
      "Partner growth, business activity and commercial commitments.",
  },
  partners: {
    title: "Partner analytics",
    description:
      "Organization types, registration trends and verification status.",
  },
  procurement: {
    title: "Procurement",
    description: "Requirements, RFQ responses, quotations and purchase orders.",
  },
  performance: {
    title: "Partner performance",
    description: "Delivery evidence, published reviews and vendor responses.",
  },
  recruitment: {
    title: "Recruitment",
    description: "Hiring demand, candidate stages, interviews and joining.",
  },
  finance: {
    title: "Finance",
    description:
      "Invoice activity, completed payments and outstanding balances.",
  },
  compliance: {
    title: "Compliance",
    description: "Document reviews, required coverage and renewal windows.",
  },
  support: {
    title: "Support",
    description: "Ticket volume, current workload and recorded resolutions.",
  },
};
export const integrationScopes = [
  ...modules,
  "reports",
  "organizations",
  "documents",
] as const;
export type ReportFormat = "text" | "number" | "money" | "percent" | "decimal";
export type ReportCell = string | number | null;
export interface ReportMetric {
  key: string;
  label: string;
  value: number | null;
  format: Exclude<ReportFormat, "text">;
  definition: string;
  scope: "period" | "current";
  href?: string;
}
export interface ReportColumn {
  key: string;
  label: string;
  format: ReportFormat;
}
export interface ReportDataset {
  columns: ReportColumn[];
  rows: Record<string, ReportCell>[];
}
export interface ReportTable extends ReportDataset {
  id: ReportTableId;
  title: string;
  description: string;
  scope: "period" | "current" | "mixed";
}
export interface ReportView {
  id: ReportViewId;
  title: string;
  description: string;
  metrics: ReportMetric[];
  distribution: { name: string; value: number; href?: string }[];
  distributionLabel: string;
  trend: { month: string; value: number }[];
  trendLabel: string;
  dataset: ReportDataset;
  tables: ReportTable[];
  notes: string[];
}
export interface AnalyticsReport {
  version: 1;
  generatedAt: string;
  from: string;
  to: string;
  currency: string;
  views: ReportView[];
}
