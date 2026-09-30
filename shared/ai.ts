import { z } from "zod";

// One deadline covers retrieval and generation; the browser allows time to receive
// the server's error response before enforcing its own network deadline.
export const aiRequestTimeout = (document = false) =>
  document ? 90000 : 60000;
export type DocumentAiStage =
  "uploaded" | "reading" | "extracting" | "validating" | "ready";
export interface DocumentAiProgress {
  stage: DocumentAiStage;
  pagesRead?: number;
  totalPages?: number;
}
export const documentLimits = {
  pages: 500,
  bytes: 10 * 1024 * 1024,
  retainedText: 1_000_000,
  analysisText: 60_000,
} as const;

export const identityLabels = {
  company_name: "Company name",
  gst: "GSTIN",
  pan: "PAN",
  cin: "CIN",
  registration_number: "Registration number",
  expiry_date: "Expiry date",
  certificate_type: "Certificate type",
  address: "Address",
} as const;
export type IdentityField = keyof typeof identityLabels;
export const extractedIdentitySchema = z.object({
  company_name: z.string().max(500).nullable(),
  gst: z.string().max(100).nullable(),
  pan: z.string().max(100).nullable(),
  cin: z.string().max(100).nullable(),
  registration_number: z.string().max(200).nullable(),
  expiry_date: z.string().max(100).nullable(),
  certificate_type: z.string().max(200).nullable(),
  address: z.string().max(2000).nullable(),
});
export type ExtractedIdentity = z.infer<typeof extractedIdentitySchema>;
export interface ExtractionValidation {
  field: IdentityField;
  status: "valid" | "missing" | "warning" | "invalid";
  message: string;
}
export const emptyIdentity = (): ExtractedIdentity => ({
  company_name: null,
  gst: null,
  pan: null,
  cin: null,
  registration_number: null,
  expiry_date: null,
  certificate_type: null,
  address: null,
});
export const operationalAlertLabels = {
  contract_expiry: "Contract expiry",
  document_expiry: "Document expiry",
  delayed_delivery: "Delivery commitments",
  invoice_aging: "Invoice aging",
  unusual_procurement: "Procurement activity",
  recruitment_aging: "Recruitment aging",
  vendor_response: "Partner response trends",
  rfq_deadline: "RFQ deadlines",
  milestone: "Milestones & joining",
} as const;
export type AlertCategory = keyof typeof operationalAlertLabels;
export interface InsightSource {
  id: string;
  type: "record" | "document" | "organization" | "module";
  title: string;
  href: string;
}
export interface OperationalAlert {
  id: string;
  category: AlertCategory;
  title: string;
  description: string;
  href: string;
  due: string;
  severity: "urgent" | "pending" | "attention";
  evidence: string;
  sources: InsightSource[];
  notificationKey: string;
}
