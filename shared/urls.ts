import { z } from "zod";

export function normalizeWebAddress(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (
      !/^https?:$/.test(url.protocol) ||
      url.username ||
      url.password ||
      /\s/.test(trimmed) ||
      /[\\<>]/.test(trimmed)
    )
      return trimmed;
    return url.href;
  } catch {
    return trimmed;
  }
}
export function webAddressError(value: string): string {
  if (!value.trim()) return "";
  try {
    const url = new URL(normalizeWebAddress(value));
    const labels = url.hostname.split(".");
    if (
      /^https?:$/.test(url.protocol) &&
      !url.username &&
      !url.password &&
      !/[\s\\<>]/.test(value.trim()) &&
      labels.length >= 2 &&
      labels.every((label) =>
        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
      )
    )
      return "";
  } catch {
    /* A domain or HTTP(S) address is required. */
  }
  return "Enter a website such as company.com or https://company.com.";
}
export const webAddressSchema = z
  .string()
  .trim()
  .max(2000)
  .superRefine((value, context) => {
    const message = webAddressError(value);
    if (message) context.addIssue({ code: "custom", message });
  })
  .transform(normalizeWebAddress);
