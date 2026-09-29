import type { Module } from "../../shared/domain";
import { dateInput } from "./format";
export type FieldDef = {
  key: string;
  label: string;
  type?:
    | "text"
    | "textarea"
    | "number"
    | "date"
    | "datetime-local"
    | "select"
    | "url"
    | "email"
    | "checkbox";
  required?: boolean;
  options?: string[];
  default?: string | number | boolean;
  full?: boolean;
  hint?: string;
  hiring?: boolean;
};
const field = (
  key: string,
  label: string,
  options: Partial<FieldDef> = {},
): FieldDef => ({ key, label, type: "text", ...options });
const description = field("description", "Description / scope", {
  type: "textarea",
  full: true,
});
const category = field("category", "Category");
const location = field("location", "Location");
const date = (key: string, label: string, offset = 14, required = true) =>
  field(key, label, { type: "date", required, default: dateInput(offset) });
const text = (key: string, label: string, required = false) =>
  field(key, label, { required });
const number = (key: string, label: string, value = 0) =>
  field(key, label, { type: "number", default: value });
const select = (
  key: string,
  label: string,
  options: string[],
  value?: string,
) =>
  field(key, label, { type: "select", options, default: value || options[0] });
const terms = field("terms", "Terms & conditions", {
  type: "textarea",
  full: true,
});
export const formFields: Record<Module, FieldDef[]> = {
  requirements: [
    select("requirement_type", "Requirement type", ["procurement", "hiring"]),
    category,
    description,
    location,
    date("required_date", "Required by", 30),
    date("deadline", "Response deadline", 14, false),
    number("budget", "Indicative budget"),
    number("quantity", "Quantity", 1),
    text("criteria", "Eligible partner criteria"),
    { ...text("skills", "Required skills"), hiring: true },
    { ...text("experience", "Experience range"), hiring: true },
    { ...number("positions", "Open positions", 1), hiring: true },
    {
      ...select("employment_type", "Employment type", [
        "Permanent",
        "Contract",
        "Campus",
        "Executive",
      ]),
      hiring: true,
    },
  ],
  rfqs: [
    category,
    description,
    date("deadline", "Response deadline", 14),
    date("required_date", "Required delivery date", 30),
    text("delivery_address", "Delivery address", true),
    location,
    text("payment_terms", "Payment terms"),
    text("eligibility", "Partner eligibility"),
    terms,
  ],
  quotations: [
    description,
    date("delivery_date", "Promised delivery date", 21),
    date("validity", "Valid until", 30),
    { ...text("payment_terms", "Payment terms", true), default: "Net 30" },
    text("warranty", "Warranty"),
    number("delivery_charges", "Delivery charges"),
    terms,
    field("remarks", "Commercial remarks", { type: "textarea", full: true }),
  ],
  orders: [
    date("delivery_date", "Delivery date", 21),
    text("delivery_address", "Delivery address", true),
    { ...text("payment_terms", "Payment terms", true), default: "Net 30" },
    description,
    terms,
  ],
  deliveries: [
    text("carrier", "Carrier / logistics provider", true),
    text("tracking_number", "Tracking number", true),
    date("expected_date", "Expected delivery date", 7),
    date("dispatched_date", "Dispatch date", 0, false),
    text("received_by", "Received by"),
    text("proof_of_delivery", "Delivery confirmation notes"),
    description,
  ],
  contracts: [
    select("contract_type", "Contract type", [
      "Master service agreement",
      "Supply agreement",
      "Recruitment agreement",
      "NDA",
      "Statement of work",
      "Other",
    ]),
    date("start_date", "Effective date", 0),
    date("end_date", "End date", 365),
    number("renewal_notice_days", "Renewal notice (days)", 30),
    field("auto_renew", "Auto-renewal agreed in contract", {
      type: "checkbox",
      default: false,
    }),
    text("payment_terms", "Payment terms"),
    description,
    terms,
  ],
  invoices: [
    text("invoice_number", "Your invoice number", true),
    date("invoice_date", "Invoice date", 0),
    date("due_date", "Due date", 30),
    text("payment_terms", "Payment terms"),
    text("bank_name", "Bank name"),
    field("bank_account_last4", "Account last 4 digits", {
      hint: "Only the last four digits. Upload full bank documents securely if required.",
    }),
    text("bank_ifsc", "IFSC / routing code"),
    description,
  ],
  payments: [
    field("amount", "Payment amount", { type: "number", required: true }),
    text("reference", "Payment reference", true),
    text("transaction_id", "Bank transaction ID", true),
    date("payment_date", "Payment date", 0),
    select("method", "Payment method", [
      "Bank transfer",
      "NEFT",
      "RTGS",
      "IMPS",
      "UPI",
      "Cheque",
      "Other",
    ]),
    field("remarks", "Payment notes", { type: "textarea", full: true }),
  ],
  catalog: [
    select("item_type", "Catalog type", ["Product", "Service", "Technology"]),
    text("sku", "SKU / service code", true),
    category,
    description,
    field("specifications", "Specifications / capabilities", {
      type: "textarea",
      full: true,
    }),
    text("unit", "Unit of measure"),
    number("price", "Unit price / rate"),
    number("tax", "Tax (%)", 18),
    number("moq", "Minimum order quantity", 1),
    text("lead_time", "Lead time"),
    number("availability", "Available quantity"),
    text("warranty", "Warranty"),
    text("delivery_locations", "Service / delivery locations"),
    text("technologies", "Technologies"),
    text("integrations", "APIs & integrations"),
    field("documentation_url", "Documentation URL", { type: "url" }),
    field("demo_url", "Demo URL", { type: "url" }),
    text("certifications", "Certifications"),
  ],
  candidates: [
    field("email", "Candidate email", { type: "email", required: true }),
    text("phone", "Phone number", true),
    text("skills", "Skills", true),
    number("experience", "Experience (years)"),
    location,
    text("notice_period", "Notice period", true),
    number("current_compensation", "Current annual compensation"),
    number("expected_compensation", "Expected annual compensation"),
    date("availability", "Available from", 30),
    field("recruiter_notes", "Recruiter notes", {
      type: "textarea",
      full: true,
    }),
    field(
      "consent",
      "I confirm this candidate has consented to sharing their information for this hiring requirement.",
      { type: "checkbox", required: true, default: false, full: true },
    ),
    date("offer_date", "Offer date", 0, false),
    number("offer_compensation", "Offered annual compensation"),
    select("bgv_status", "Background verification", [
      "Not started",
      "In progress",
      "Clear",
      "Requires review",
    ]),
    date("joining_date", "Joining date", 30, false),
  ],
  interviews: [
    field("scheduled_at", "Interview date & time", {
      type: "datetime-local",
      required: true,
    }),
    number("duration", "Duration (minutes)", 60),
    text("interviewer", "Interviewer", true),
    location,
    field("meeting_link", "Meeting link", { type: "url" }),
    description,
    field("feedback", "Interview feedback", { type: "textarea", full: true }),
    select("recommendation", "Recommendation", [
      "Pending",
      "Proceed",
      "Hold",
      "Reject",
    ]),
  ],
  engagements: [
    text("resource_name", "Resource name", true),
    text("designation", "Designation", true),
    date("start_date", "Start date", 0),
    date("end_date", "End date", 180),
    number("rate", "Agreed rate"),
    select("rate_unit", "Rate per", ["hour", "day", "month"], "month"),
    text("manager", "Reporting manager", true),
    location,
    description,
  ],
  timesheets: [
    date("period_start", "Period start", -7),
    date("period_end", "Period end", -1),
    field("hours", "Hours worked", {
      type: "number",
      required: true,
      default: 40,
    }),
    field("work_summary", "Work completed", {
      type: "textarea",
      required: true,
      full: true,
    }),
  ],
  milestones: [
    date("due_date", "Due date", 14),
    number("amount", "Milestone value"),
    field("deliverable", "Expected deliverable", {
      type: "textarea",
      required: true,
      full: true,
    }),
    description,
    field("completion_notes", "Completion / revision notes", {
      type: "textarea",
      full: true,
    }),
  ],
  demos: [
    text("contact_name", "Contact name", true),
    field("contact_email", "Contact email", { type: "email", required: true }),
    date("preferred_date", "Preferred date", 7),
    field("use_case", "What would you like to explore?", {
      type: "textarea",
      required: true,
      full: true,
    }),
    field("scheduled_at", "Confirmed date & time", { type: "datetime-local" }),
    field("meeting_link", "Meeting link", { type: "url" }),
    description,
  ],
  performance: [
    field("quality", "Quality", {
      type: "number",
      default: 5,
      hint: "Rate 1 to 5",
    }),
    field("delivery", "Delivery", {
      type: "number",
      default: 5,
      hint: "Rate 1 to 5",
    }),
    field("communication", "Communication", {
      type: "number",
      default: 5,
      hint: "Rate 1 to 5",
    }),
    field("value", "Value for money", {
      type: "number",
      default: 5,
      hint: "Rate 1 to 5",
    }),
    date("review_date", "Review date", 0),
    field("feedback", "Partner feedback", {
      type: "textarea",
      required: true,
      full: true,
    }),
  ],
  tickets: [
    select("category", "Category", [
      "Account & access",
      "Verification",
      "Procurement",
      "Finance",
      "Recruitment",
      "Technical issue",
      "Other",
    ]),
    select(
      "priority",
      "Priority",
      ["low", "normal", "high", "urgent"],
      "normal",
    ),
    { ...description, required: true },
    select("assigned_team", "Assigned team", [
      "Support",
      "Verification",
      "Procurement",
      "Finance",
      "Recruitment",
    ]),
    field("resolution", "Resolution notes", { type: "textarea", full: true }),
  ],
};
export const parentLabels: Partial<Record<Module, string>> = {
  rfqs: "Linked requirement (optional)",
  quotations: "RFQ to respond to",
  orders: "Approved quotation",
  deliveries: "Purchase order",
  contracts: "Purchase order (optional)",
  invoices: "Fulfilled order / active contract",
  payments: "Approved invoice",
  candidates: "Assigned hiring requirement",
  interviews: "Candidate",
  engagements: "Active staffing contract",
  timesheets: "Active engagement",
  milestones: "Order / contract",
  demos: "Technology product",
  performance: "Order / contract",
};
