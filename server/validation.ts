import { z } from "zod";
import { emailSchema, passwordSchema, phoneSchema } from "../shared/auth.js";
import { webAddressSchema } from "../shared/urls.js";
import {
  organizationTypes,
  contactRoles,
  documentCategories,
} from "../shared/domain.js";
const text = (max = 2000) => z.string().trim().max(max);
export const uuid = z.string().uuid();
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Enter a valid date.",
  );
export const optionalDate = z.union([date, z.literal("")]).optional();
export const password = passwordSchema;
export const email = emailSchema;
export const companyDetailsSchema = z
  .object({
    company_type: text(100).optional(),
    contact_role: z.enum(contactRoles as [string, ...string[]]).optional(),
    pan: z
      .union([
        z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "Enter a valid PAN."),
        z.literal(""),
      ])
      .optional(),
    gst: z
      .union([
        z
          .string()
          .regex(
            /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/,
            "Enter a valid GSTIN.",
          ),
        z.literal(""),
      ])
      .optional(),
    cin: text(40).optional(),
    udyam: text(80).optional(),
    address: text().optional(),
    postal_code: text(20).optional(),
    linkedin: webAddressSchema.optional(),
    company_email: z
      .string()
      .trim()
      .pipe(z.union([email, z.literal("")]))
      .optional(),
    description: text(5000).optional(),
    capabilities: text(5000).optional(),
    products: text().optional(),
    services: text().optional(),
    locations: text().optional(),
    certifications: text().optional(),
    naics: text(50).optional(),
    sic: text(50).optional(),
    domains: text().optional(),
    hiring_types: z.array(text(100)).max(10).optional(),
    experience: z.coerce.number().min(0).max(200).optional(),
    recruiters: text().optional(),
    moq: z.coerce.number().min(0).max(10000000).optional(),
    lead_time: text(100).optional(),
    delivery_locations: text().optional(),
    warehouse: text().optional(),
    technologies: text().optional(),
    integrations: text().optional(),
    documentation_url: webAddressSchema.optional(),
    pricing_model: text(100).optional(),
    procurement_categories: text().optional(),
    annual_budget: text(100).optional(),
    payment_terms: text(300).optional(),
    resources: text().optional(),
    partner_contact: text().optional(),
    rate_card: text().optional(),
    bank_name: text(200).optional(),
    bank_account_last4: z
      .union([z.string().regex(/^\d{4}$/), z.literal("")])
      .optional(),
    bank_ifsc: text(20).optional(),
    verification_note: text(2000).optional(),
    logo_color: text(20).optional(),
  })
  .strict();
export const organizationSchema = z.object({
  type: z.enum(organizationTypes),
  legal_name: text(200).min(2),
  trade_name: text(200).default(""),
  industry: text(100).min(2),
  city: text(150).min(2),
  country: text(100).min(2).default("India"),
  website: webAddressSchema.default(""),
  contact_name: text(150).min(2),
  contact_email: email,
  contact_phone: phoneSchema,
  details: companyDetailsSchema.default({}),
});
export const registrationSchema = z
  .object({
    organization: organizationSchema,
    name: text(150).min(2),
    email,
    password,
    accept_terms: z.literal(true),
  })
  .superRefine((data, ctx) => {
    const details = data.organization.details;
    for (const [key, message] of [
      ["company_type", "Select your company type."],
      ["contact_role", "Select your authorized contact role."],
    ] as const)
      if (!details[key]?.trim())
        ctx.addIssue({
          code: "custom",
          path: ["organization", "details", key],
          message,
        });
    const required: Record<string, string[]> = {
      supplier: ["products", "lead_time", "delivery_locations"],
      recruitment: ["domains", "recruiters"],
      staffing: ["domains", "recruiters"],
      client: ["procurement_categories"],
      technology_partner: ["technologies", "integrations"],
      service_provider: ["services", "pricing_model"],
      vendor: ["services"],
      business_partner: ["services"],
      other: ["services"],
    };
    for (const key of [
      "description",
      "capabilities",
      "locations",
      ...(required[data.organization.type] || []),
    ])
      if (!String(details[key as keyof typeof details] || "").trim())
        ctx.addIssue({
          code: "custom",
          path: ["organization", "details", key],
          message:
            "This business information is required for your organization type.",
        });
    if (
      ["recruitment", "staffing"].includes(data.organization.type) &&
      !details.hiring_types?.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["organization", "details", "hiring_types"],
        message: "Select at least one hiring capability.",
      });
  });
export const lineItemSchema = z.object({
  catalog_item_id: uuid.nullable().optional(),
  name: text(200).min(1),
  specification: text(3000).default(""),
  quantity: z.coerce
    .number()
    .positive()
    .max(1000000)
    .refine(
      (v) => Math.round(v * 1000) / 1000 === v,
      "Use at most 3 decimal places.",
    ),
  unit: text(30).min(1).default("units"),
  unit_price: z.coerce
    .number()
    .min(0)
    .max(100000000)
    .refine(
      (v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.00001,
      "Use at most two decimal places for prices.",
    ),
  tax: z.coerce
    .number()
    .min(0)
    .max(100)
    .refine(
      (v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.00001,
      "Use at most two decimal places.",
    )
    .default(18),
  discount: z.coerce
    .number()
    .min(0)
    .max(100)
    .refine(
      (v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.00001,
      "Use at most two decimal places.",
    )
    .default(0),
});
export const recordSchema = z.object({
  title: text(200).min(3),
  parent_id: uuid.nullable().optional(),
  partner_org_id: uuid.nullable().optional(),
  buyer_org_id: uuid.nullable().optional(),
  currency: z.enum(["INR", "USD", "EUR", "GBP"]).default("INR"),
  payload: z
    .record(
      z.string().max(100),
      z.union([
        text(10000),
        z.number().finite().min(-1e12).max(1e12),
        z.boolean(),
        z.array(text(500)).max(100),
        z.null(),
      ]),
    )
    .default({}),
  items: z.array(lineItemSchema).max(100).default([]),
  invitations: z.array(uuid).max(100).default([]),
  version: z.number().int().positive().optional(),
  note: text(2000).default(""),
});
export type RecordInput = z.infer<typeof recordSchema>;
export const documentSchema = z.object({
  category: text(100).min(1),
  organization_id: uuid.optional(),
  record_id: uuid.optional(),
  expires_at: optionalDate,
  previous_id: uuid.optional(),
});
export const pagination = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: text(200).default(""),
  status: text(50).default(""),
  category: text(100).default(""),
  from: optionalDate,
  to: optionalDate,
});
