import { z } from "zod";

export const emailHint =
  "Use an email you can access. A company email is recommended.";
export const emailSchema = z
  .string()
  .trim()
  .max(254, "Use an email address with at most 254 characters.")
  .email("Enter a complete email address, for example name@company.com.")
  .transform((value) => value.toLowerCase());

export const passwordHint =
  "At least 12 characters, including uppercase, lowercase and a number.";
export const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(128, "Use at most 128 characters.")
  .refine(
    (value) => /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value),
    "Include uppercase, lowercase and a number.",
  );

export function emailError(value: string) {
  const result = emailSchema.safeParse(value);
  return result.success ? "" : result.error.issues[0].message;
}
