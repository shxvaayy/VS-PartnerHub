import type { ReportCell, ReportFormat, ReportViewId } from "./analytics.js";

export const biHighlights = 8;
export const biColors = [
  "#256c54",
  "#c99b22",
  "#557bc4",
  "#925cad",
  "#d47952",
  "#428a97",
  "#879447",
  "#a66579",
];
export const biAccent: Record<ReportViewId, string> = {
  executive: "#c99b22",
  partners: "#256c54",
  procurement: "#557bc4",
  performance: "#428a97",
  recruitment: "#925cad",
  finance: "#256c54",
  compliance: "#c99b22",
  support: "#d47952",
};

export function biValue(
  value: ReportCell | undefined,
  format: ReportFormat,
  currency: string,
  compact = false,
) {
  if (value === null || value === undefined || value === "") return "—";
  if (format === "text") return String(value);
  const number = Number(value);
  if (format === "money")
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      notation: compact ? "compact" : "standard",
      minimumFractionDigits: compact ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(number / 100);
  return (
    new Intl.NumberFormat("en-IN", {
      maximumFractionDigits: 2,
      notation: compact ? "compact" : "standard",
    }).format(number) + (format === "percent" ? "%" : "")
  );
}
