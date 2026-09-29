export const money = (
  minor: number | string,
  currency = "INR",
  compact = false,
) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: compact ? 1 : 2,
    minimumFractionDigits: 0,
    ...(compact ? { notation: "compact" } : {}),
  }).format(Number(minor || 0) / 100);
export const formatDate = (value?: string | null, long = false) =>
  value
    ? new Intl.DateTimeFormat("en-IN", {
        day: "numeric",
        month: long ? "long" : "short",
        year: "numeric",
      }).format(new Date(value))
    : "—";
export const formatTime = (value: string) =>
  new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
export function relativeTime(value: string) {
  const seconds = (Date.now() - Date.parse(value)) / 1000;
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return formatDate(value);
}
export const initials = (name = "") =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
export const dateInput = (offset = 0) =>
  new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
