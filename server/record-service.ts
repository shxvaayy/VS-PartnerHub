import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Knex } from "knex";
import {
  db,
  now,
  nextNumber,
  parseJson,
  commercialKeys,
  type Database,
} from "./db.js";
import { INTERNAL_ORG_ID } from "./config.js";
import { assert } from "./errors.js";
import { assertActive, can } from "./security.js";
import { audit, notifyOrganizations } from "./events.js";
import { startApproval } from "./approvals.js";
import { calculate, amountMinor } from "./money.js";
import { webAddressSchema } from "../shared/urls.js";
import { emailSchema, phoneSchema } from "../shared/auth.js";
import { date, optionalDate, type RecordInput } from "./validation.js";
import {
  moduleDefinitions,
  transitions,
  type Module,
  type SessionUser,
  type WorkRecord,
  type LineItem,
} from "../shared/domain.js";

const text = (n = 3000) => z.string().trim().max(n);
const opt = text().default("");
const required = text().min(1);
const nonnegative = z.coerce.number().min(0).max(100000000);
const url = webAddressSchema.default("");
const common = {
  description: text(10000).default(""),
  category: text(150).default(""),
  location: text(300).default(""),
  remarks: opt,
};
const payloadSchemas: Record<Module, z.ZodType<any>> = {
  requirements: z
    .object({
      ...common,
      requirement_type: z
        .enum(["procurement", "hiring"])
        .default("procurement"),
      required_date: date,
      deadline: optionalDate,
      budget: nonnegative.default(0),
      quantity: nonnegative.default(1),
      skills: opt,
      experience: opt,
      technology: opt,
      delivery_requirements: opt,
      positions: z.coerce.number().int().min(1).max(10000).default(1),
      employment_type: text(100).default("Permanent"),
      criteria: opt,
    })
    .strict(),
  rfqs: z
    .object({
      ...common,
      deadline: date,
      required_date: date,
      delivery_address: required,
      payment_terms: opt,
      terms: text(10000).default(""),
      eligibility: opt,
    })
    .strict(),
  quotations: z
    .object({
      ...common,
      delivery_date: date,
      validity: date,
      payment_terms: required,
      warranty: opt,
      delivery_charges: nonnegative.default(0),
      terms: text(10000).default(""),
    })
    .strict(),
  orders: z
    .object({
      ...common,
      delivery_date: date,
      delivery_address: required,
      payment_terms: required,
      terms: text(10000).default(""),
      delivery_charges: nonnegative.default(0),
    })
    .strict(),
  deliveries: z
    .object({
      ...common,
      carrier: required,
      tracking_number: required,
      expected_date: date,
      dispatched_date: optionalDate,
      received_by: opt,
      proof_of_delivery: opt,
    })
    .strict(),
  contracts: z
    .object({
      ...common,
      contract_type: z
        .enum([
          "Master service agreement",
          "Supply agreement",
          "Recruitment agreement",
          "NDA",
          "Statement of work",
          "Other",
        ])
        .default("Master service agreement"),
      start_date: date,
      end_date: date,
      renewal_notice_days: z.coerce.number().int().min(1).max(365).default(30),
      auto_renew: z.boolean().default(false),
      payment_terms: opt,
      terms: text(10000).default(""),
      delivery_charges: nonnegative.default(0),
      amendment: opt,
    })
    .strict(),
  invoices: z
    .object({
      ...common,
      invoice_number: required,
      invoice_date: date,
      due_date: date,
      payment_terms: opt,
      bank_name: text(200).default(""),
      bank_account_last4: z
        .union([z.string().regex(/^\d{4}$/), z.literal("")])
        .default(""),
      bank_ifsc: text(20).default(""),
      delivery_charges: nonnegative.default(0),
    })
    .strict(),
  payments: z
    .object({
      ...common,
      amount: z.coerce.number().positive().max(1e12),
      reference: text(200).min(3),
      transaction_id: text(200).min(3),
      payment_date: date,
      method: z
        .enum([
          "Bank transfer",
          "NEFT",
          "RTGS",
          "IMPS",
          "UPI",
          "Cheque",
          "Other",
        ])
        .default("Bank transfer"),
    })
    .strict(),
  catalog: z
    .object({
      ...common,
      item_type: z
        .enum(["Product", "Service", "Technology"])
        .default("Product"),
      sku: text(100).min(1),
      specifications: opt,
      unit: text(30).default("units"),
      price: nonnegative.default(0),
      tax: z.coerce.number().min(0).max(100).default(18),
      moq: z.coerce.number().positive().max(1000000).default(1),
      lead_time: text(100).default(""),
      availability: z.coerce.number().min(0).max(100000000).default(0),
      warranty: opt,
      delivery_locations: opt,
      technologies: opt,
      integrations: opt,
      documentation_url: url,
      demo_url: url,
      certifications: opt,
    })
    .strict(),
  candidates: z
    .object({
      ...common,
      email: emailSchema,
      phone: phoneSchema,
      skills: required,
      experience: z.coerce.number().min(0).max(70),
      notice_period: text(100).min(1),
      current_compensation: nonnegative.default(0),
      expected_compensation: nonnegative.default(0),
      availability: date,
      recruiter_notes: opt,
      consent: z.literal(true, "Candidate consent is required."),
      offer_date: optionalDate,
      offer_compensation: nonnegative.optional(),
      bgv_status: z
        .enum(["Not started", "In progress", "Clear", "Requires review"])
        .default("Not started"),
      joining_date: optionalDate,
    })
    .strict(),
  interviews: z
    .object({
      ...common,
      scheduled_at: z.iso.datetime({ offset: true }),
      duration: z.coerce.number().int().min(15).max(480).default(60),
      interviewer: required,
      meeting_link: url,
      feedback: opt,
      recommendation: z
        .enum(["Pending", "Proceed", "Hold", "Reject"])
        .default("Pending"),
    })
    .strict(),
  engagements: z
    .object({
      ...common,
      resource_name: required,
      designation: required,
      start_date: date,
      end_date: date,
      rate: nonnegative,
      rate_unit: z.enum(["hour", "day", "month"]).default("month"),
      manager: required,
    })
    .strict(),
  timesheets: z
    .object({
      ...common,
      period_start: date,
      period_end: date,
      hours: z.coerce.number().positive().max(744),
      work_summary: required,
    })
    .strict(),
  milestones: z
    .object({
      ...common,
      due_date: date,
      deliverable: required,
      amount: nonnegative.default(0),
      completion_notes: opt,
    })
    .strict(),
  demos: z
    .object({
      ...common,
      contact_name: required,
      contact_email: z.email(),
      preferred_date: date,
      scheduled_at: z
        .union([z.iso.datetime({ offset: true }), z.literal("")])
        .default(""),
      meeting_link: url,
      use_case: required,
    })
    .strict(),
  performance: z
    .object({
      ...common,
      quality: z.coerce.number().int().min(1).max(5),
      delivery: z.coerce.number().int().min(1).max(5),
      communication: z.coerce.number().int().min(1).max(5),
      value: z.coerce.number().int().min(1).max(5),
      feedback: required,
      review_date: date,
    })
    .strict(),
  tickets: z
    .object({
      ...common,
      category: z
        .enum([
          "Account & access",
          "Verification",
          "Procurement",
          "Finance",
          "Recruitment",
          "Technical issue",
          "Other",
        ])
        .default("Other"),
      priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
      description: required,
      assigned_team: z
        .enum([
          "Support",
          "Verification",
          "Procurement",
          "Finance",
          "Recruitment",
        ])
        .default("Support"),
      resolution: opt,
    })
    .strict(),
};
export const serializeRecord = (row: any): WorkRecord => ({
  ...row,
  payload: parseJson(row.payload),
  amount_minor: Number(row.amount_minor),
});
export function scopeRecords(
  query: Knex.QueryBuilder,
  user: SessionUser,
  alias = "records",
) {
  if (user.internal) {
    if (user.role === "hr")
      query.where((q) =>
        q
          .whereNot(`${alias}.kind`, "requirements")
          .orWhere(`${alias}.payload`, "like", '%"requirement_type":"hiring"%'),
      );
    return query;
  }
  const org = user.organization_id;
  query.where((q) =>
    q
      .where(`${alias}.owner_org_id`, org)
      .orWhere(`${alias}.buyer_org_id`, org)
      .orWhere(`${alias}.partner_org_id`, org)
      .orWhere((sub) =>
        sub
          .whereIn(`${alias}.kind`, ["requirements", "rfqs"])
          .whereNot(`${alias}.status`, "draft")
          .whereExists(
            db("record_invitations")
              .whereRaw(`record_invitations.record_id = ${alias}.id`)
              .where("record_invitations.organization_id", org),
          ),
      ),
  );
  query.where((q) =>
    q
      .whereNotIn(`${alias}.kind`, ["quotations", "invoices"])
      .orWhereNot(`${alias}.status`, "draft")
      .orWhere(`${alias}.owner_org_id`, org)
      .orWhere(`${alias}.partner_org_id`, org),
  );
  return query;
}
export async function accessibleRecord(
  id: string,
  user: SessionUser,
  k: Database = db,
): Promise<WorkRecord> {
  const row = await scopeRecords(
    k("records").where("records.id", id),
    user,
  ).first();
  assert(
    row && can(user, row.kind),
    404,
    "This record was not found or is not available to your organization.",
  );
  return serializeRecord(row);
}
export const isBuyer = (u: SessionUser, r: WorkRecord) =>
  u.internal ||
  (u.organization?.type === "client" && r.buyer_org_id === u.organization_id);
export const isSeller = (u: SessionUser, r: WorkRecord) =>
  u.internal ||
  (u.organization?.type !== "client" && r.partner_org_id === u.organization_id);
export function canCreate(user: SessionUser, kind: Module) {
  if (!can(user, kind, "create")) return false;
  if (kind === "tickets") return true;
  if (
    !user.email_verified ||
    (!user.internal && user.organization?.status !== "active")
  )
    return false;
  if (user.internal) return true;
  const buyer = user.organization?.type === "client";
  if (
    [
      "requirements",
      "rfqs",
      "orders",
      "payments",
      "interviews",
      "engagements",
      "demos",
      "performance",
    ].includes(kind)
  )
    return buyer;
  if (
    [
      "quotations",
      "deliveries",
      "invoices",
      "catalog",
      "candidates",
      "timesheets",
      "milestones",
    ].includes(kind)
  )
    return !buyer;
  return true;
}
export function canEdit(user: SessionUser, r: WorkRecord) {
  if (!can(user, r.kind, "edit")) return false;
  if (
    !user.internal &&
    r.owner_org_id !== user.organization_id &&
    r.partner_org_id !== user.organization_id &&
    !(r.kind === "candidates" && isBuyer(user, r))
  )
    return false;
  if (r.kind === "tickets") return r.status !== "closed";
  if (r.kind === "catalog")
    return ["draft", "active", "unavailable"].includes(r.status);
  if (r.kind === "candidates")
    return (
      r.status === "submitted" ||
      (isBuyer(user, r) && !["joined", "closed"].includes(r.status))
    );
  if (r.kind === "interviews")
    return isBuyer(user, r) && r.status === "scheduled";
  if (r.kind === "demos") return ["requested", "scheduled"].includes(r.status);
  if (r.kind === "milestones")
    return ["planned", "in_progress", "revision"].includes(r.status);
  if (r.kind === "deliveries")
    return ["pending", "dispatched", "in_transit"].includes(r.status);
  if (r.kind === "engagements")
    return isBuyer(user, r) && r.status === "planned";
  return ["draft", "clarification", "rejected"].includes(r.status);
}
export function allowedTransitions(user: SessionUser, r: WorkRecord) {
  if (
    !can(user, r.kind, "edit") &&
    !can(user, r.kind, "review") &&
    !can(user, r.kind, "manage")
  )
    return [];
  if (
    r.kind !== "tickets" &&
    (!user.email_verified ||
      (!user.internal && user.organization?.status !== "active"))
  )
    return [];
  return (transitions[r.kind][r.status] || []).filter((target) => {
    const review = can(user, r.kind, "review"),
      edit = can(user, r.kind, "edit");
    switch (r.kind) {
      case "quotations":
        return target === "submitted"
          ? isSeller(user, r) && edit
          : isBuyer(user, r) && review;
      case "orders":
        return target === "acknowledged"
          ? isSeller(user, r) && edit
          : isBuyer(user, r) && (target === "approved" ? review : edit);
      case "deliveries":
        return target === "confirmed"
          ? isBuyer(user, r) && review
          : isSeller(user, r) && edit;
      case "invoices":
        return ["submitted", "draft"].includes(target)
          ? isSeller(user, r) && edit
          : isBuyer(user, r) && review;
      case "payments":
        return isBuyer(user, r) && review;
      case "contracts":
        return ["approved", "active", "terminated"].includes(target)
          ? isBuyer(user, r) && review
          : (user.internal || r.owner_org_id === user.organization_id) && edit;
      case "candidates":
      case "interviews":
      case "engagements":
        return isBuyer(user, r) && review;
      case "timesheets":
      case "milestones":
        return ["approved", "rejected", "revision"].includes(target)
          ? isBuyer(user, r) && review
          : isSeller(user, r) && edit;
      case "demos":
        return target === "cancelled" ? edit : isSeller(user, r) && edit;
      case "performance":
        return isBuyer(user, r) && review;
      case "requirements":
      case "rfqs":
        return isBuyer(user, r) && edit;
      case "tickets":
        return user.internal
          ? edit
          : ["closed", "open"].includes(target) && edit;
      default:
        return (
          edit && (user.internal || r.owner_org_id === user.organization_id)
        );
    }
  });
}
export async function getItems(
  id: string,
  k: Database = db,
): Promise<LineItem[]> {
  const rows = await k("line_items")
    .where({ record_id: id })
    .orderBy("position");
  return rows.map((r: any) => ({
    id: r.id,
    catalog_item_id: r.catalog_item_id || null,
    name: r.name,
    specification: r.specification,
    quantity: Number(r.quantity),
    unit: r.unit,
    unit_price: Number(r.unit_price_minor) / 100,
    tax: r.tax_bps / 100,
    discount: r.discount_bps / 100,
  }));
}
async function saveItems(k: Database, id: string, items: LineItem[]) {
  await k("line_items").where({ record_id: id }).delete();
  if (items.length)
    await k("line_items").insert(
      items.map((i, position) => ({
        id: randomUUID(),
        record_id: id,
        catalog_item_id: i.catalog_item_id || null,
        name: i.name,
        specification: i.specification || "",
        quantity: i.quantity,
        unit: i.unit,
        unit_price_minor: Math.round(i.unit_price * 100),
        tax_bps: Math.round(i.tax * 100),
        discount_bps: Math.round(i.discount * 100),
        position,
      })),
    );
}
export async function recordDetail(
  id: string,
  user: SessionUser,
  k: Database = db,
) {
  const record = await accessibleRecord(id, user, k);
  const orgIds = [
    record.buyer_org_id,
    record.partner_org_id,
    record.owner_org_id,
  ].filter(Boolean) as string[];
  const orgs = await k("organizations")
    .whereIn("id", orgIds)
    .select("id", "legal_name");
  const name = (id: string | null) => orgs.find((o) => o.id === id)?.legal_name;
  const parent = record.parent_id
    ? await k("records")
        .where({ id: record.parent_id })
        .select("number")
        .first()
    : null;
  const invitations = await k("record_invitations")
    .where({ record_id: id })
    .select("organization_id");
  const payments =
    record.kind === "invoices"
      ? await k("records")
          .where({ parent_id: id, kind: "payments", status: "completed" })
          .sum({ paid: "amount_minor" })
          .first()
      : null;
  return {
    ...record,
    items: await getItems(id, k),
    invitations: isBuyer(user, record)
      ? invitations.map((i) => i.organization_id)
      : [],
    buyer_name: name(record.buyer_org_id),
    partner_name: name(record.partner_org_id),
    owner_name: name(record.owner_org_id),
    parent_number: parent?.number,
    allowed_transitions: allowedTransitions(user, record),
    can_edit: canEdit(user, record),
    outstanding_minor:
      record.kind === "invoices"
        ? record.amount_minor - Number(payments?.paid || 0)
        : undefined,
  };
}
export async function snapshot(
  k: Database,
  r: WorkRecord,
  user: SessionUser,
  note: string,
) {
  await k("record_versions")
    .insert({
      id: randomUUID(),
      record_id: r.id,
      version: r.version,
      snapshot: JSON.stringify({ ...r, items: await getItems(r.id, k) }),
      created_by: user.id,
      note,
      created_at: now(),
    })
    .onConflict(["record_id", "version"])
    .ignore();
}
async function lockParent(k: Database, id: string) {
  let query = k("records").where({ id });
  if (configIsPostgres()) query = query.forUpdate();
  await query.first();
}
const configIsPostgres = () => db.client.config.client === "pg";
async function validatePartner(
  k: Database,
  id: string | null | undefined,
  types?: string[],
) {
  assert(id, 422, "Choose a partner organization.");
  const partner = await k("organizations")
    .where({ id, status: "active" })
    .first();
  assert(
    partner && (!types || types.includes(partner.type)),
    422,
    "Choose an active, eligible partner organization.",
  );
  return partner;
}

export async function saveRecord(
  user: SessionUser,
  kind: Module,
  input: RecordInput,
  existingId?: string,
  transaction?: Database,
) {
  if (kind !== "tickets") assertActive(user);
  assert(
    existingId ? can(user, kind, "edit") : canCreate(user, kind),
    403,
    "Your role cannot create or edit this type of record.",
  );
  let payload = payloadSchemas[kind].parse(input.payload);
  if (payload.start_date && payload.end_date)
    assert(
      payload.end_date >= payload.start_date,
      422,
      "The end date must be on or after the start date.",
    );
  if (payload.period_start && payload.period_end)
    assert(
      payload.period_end >= payload.period_start,
      422,
      "The timesheet end must be after its start.",
    );
  if (payload.invoice_date)
    assert(
      payload.due_date >= payload.invoice_date,
      422,
      "The due date must be on or after the invoice date.",
    );
  if (kind === "rfqs")
    assert(
      payload.required_date >= payload.deadline,
      422,
      "Delivery cannot be required before the response deadline.",
    );
  const work = async (k: Database) => {
    const existing = existingId
      ? await accessibleRecord(existingId, user, k)
      : null;
    if (existing) {
      assert(
        existing.kind === kind && canEdit(user, existing),
        403,
        "This record can no longer be edited.",
      );
      await k("approval_requests")
        .where({ record_id: existing.id, status: "pending" })
        .update({ status: "cancelled", updated_at: now() });
      assert(
        input.version === existing.version,
        409,
        "Someone updated this record. Refresh before saving.",
      );
    }
    const self = user.organization_id || INTERNAL_ORG_ID;
    let buyer: string | null =
      existing?.buyer_org_id ||
      (user.internal || user.organization?.type === "client" ? self : null);
    let partner: string | null =
      existing?.partner_org_id ||
      (user.organization?.type !== "client" && !user.internal
        ? self
        : input.partner_org_id || null);
    const parentId = existing?.parent_id || input.parent_id || null;
    assert(
      !existing || (input.parent_id || null) === existing.parent_id,
      422,
      "The linked record cannot be changed after creation.",
    );
    let parent: WorkRecord | null = null;
    if (parentId) {
      await lockParent(k, parentId);
      if (kind === "demos" && can(user, "discovery")) {
        const item = await k("records")
          .where({ id: parentId, kind: "catalog", status: "active" })
          .first();
        assert(item, 404, "This technology product is unavailable.");
        parent = serializeRecord(item);
      } else parent = await accessibleRecord(parentId, user, k);
    }
    let items: LineItem[] = input.items;
    let total = 0;
    const requiredParent: Partial<Record<Module, Module[]>> = {
      quotations: ["rfqs"],
      orders: ["quotations"],
      deliveries: ["orders"],
      invoices: ["orders", "contracts"],
      payments: ["invoices"],
      candidates: ["requirements"],
      interviews: ["candidates"],
      engagements: ["contracts"],
      timesheets: ["engagements"],
      milestones: ["orders", "contracts"],
      demos: ["catalog"],
      performance: ["orders", "contracts"],
    };
    if (requiredParent[kind])
      assert(
        parent && requiredParent[kind]!.includes(parent.kind),
        422,
        `Choose a valid linked ${requiredParent[kind]!.map((m: Module) => moduleDefinitions[m].singular.toLowerCase()).join(" or ")}.`,
      );
    if (kind === "rfqs" && parent)
      assert(
        parent.kind === "requirements" &&
          parent.status === "open" &&
          parent.payload.requirement_type === "procurement" &&
          isBuyer(user, parent),
        422,
        "Choose an open procurement requirement belonging to your organization.",
      );
    if (kind === "contracts" && parent)
      assert(
        parent.kind === "orders" &&
          ["approved", "sent", "acknowledged", "fulfilled", "closed"].includes(
            parent.status,
          ),
        422,
        "Choose an approved purchase order.",
      );
    if (
      parent &&
      !["quotations", "candidates", "demos", "rfqs"].includes(kind)
    ) {
      buyer = parent.buyer_org_id;
      partner = parent.partner_org_id;
    }
    if (["quotations", "candidates"].includes(kind)) {
      buyer = parent!.buyer_org_id;
      if (user.internal)
        await validatePartner(
          k,
          partner,
          kind === "candidates" ? ["recruitment", "staffing"] : undefined,
        );
      const invited = await k("record_invitations")
        .where({ record_id: parent!.id, organization_id: partner })
        .first();
      assert(
        invited,
        403,
        "Only invited partners can respond to this requirement.",
      );
      if (kind === "quotations") {
        assert(
          ["published", "evaluation"].includes(parent!.status),
          422,
          "This RFQ is not accepting quotations.",
        );
        assert(
          existing?.status === "clarification" ||
            parent!.payload.deadline >= now().slice(0, 10),
          422,
          "The response deadline has passed.",
        );
        assert(
          payload.validity >= now().slice(0, 10),
          422,
          "Quotation validity cannot be in the past.",
        );
        const duplicate = await k("records")
          .where({ kind, parent_id: parentId, partner_org_id: partner })
          .modify((q) => {
            if (existingId) q.whereNot("id", existingId);
          })
          .first();
        assert(
          !duplicate,
          409,
          "Your organization already has a quotation for this RFQ. Revise that quotation instead.",
        );
        assert(
          input.currency === parent!.currency,
          422,
          "Use the RFQ currency so quotations can be compared.",
        );
        const requested = await getItems(parentId!, k);
        assert(
          items.length === requested.length &&
            items.every(
              (item, i) =>
                item.name === requested[i].name &&
                item.quantity === requested[i].quantity &&
                item.unit === requested[i].unit,
            ),
          422,
          "The quotation must cover the RFQ line items and quantities.",
        );
      } else {
        assert(
          parent!.payload.requirement_type === "hiring" &&
            parent!.status === "open",
          422,
          "Choose an open hiring requirement.",
        );
        const duplicate = await k("records")
          .where({ kind, parent_id: parentId })
          .modify((q) => {
            if (existingId) q.whereNot("id", existingId);
          })
          .select("payload");
        assert(
          !duplicate.some(
            (r: any) =>
              parseJson(r.payload).email?.toLowerCase() ===
              payload.email.toLowerCase(),
          ),
          409,
          "This candidate has already been submitted for this requirement.",
        );
        const settings = parseJson(
          (await k("settings").where({ key: "platform" }).first())?.value,
        );
        payload.retention_until =
          existing?.payload.retention_until ||
          new Date(
            Date.now() + (settings.candidateRetentionDays || 365) * 86400000,
          ).toISOString();
        payload.consent_recorded_at =
          existing?.payload.consent_recorded_at || now();
        if (!isBuyer(user, { buyer_org_id: buyer } as WorkRecord)) {
          assert(
            !payload.offer_compensation &&
              !payload.offer_date &&
              !payload.joining_date &&
              payload.bgv_status === "Not started",
            403,
            "Offer and background-check decisions are managed by the hiring team.",
          );
        }
      }
    }
    if (kind === "orders") {
      assert(
        parent!.status === "approved" && isBuyer(user, parent!),
        422,
        "Purchase orders require an approved quotation.",
      );
      assert(
        !(await k("records")
          .where({ kind, parent_id: parentId })
          .modify((q) => {
            if (existingId) q.whereNot("id", existingId);
          })
          .first()),
        409,
        "A purchase order already exists for this quotation.",
      );
      items = await getItems(parentId!, k);
      payload.delivery_charges = parent!.payload.delivery_charges || 0;
      total = parent!.amount_minor;
    }
    if (kind === "deliveries")
      assert(
        ["sent", "acknowledged"].includes(parent!.status) &&
          isSeller(user, parent!),
        422,
        "Deliveries require a sent or acknowledged purchase order.",
      );
    if (kind === "invoices") {
      assert(
        (parent!.kind === "orders"
          ? ["fulfilled", "closed"]
          : ["active", "renewed"]
        ).includes(parent!.status) && isSeller(user, parent!),
        422,
        "Invoice a fulfilled order or an active contract belonging to your organization.",
      );
      assert(
        parent!.amount_minor > 0,
        422,
        "The linked agreement needs an agreed commercial value before invoicing.",
      );
      assert(
        !(await k("records")
          .where({ kind, parent_id: parentId })
          .modify((q) => {
            if (existingId) q.whereNot("id", existingId);
          })
          .first()),
        409,
        "This order or contract already has an invoice. Open the existing invoice.",
      );
      items = await getItems(parentId!, k);
      payload.delivery_charges = parent!.payload.delivery_charges || 0;
      total = parent!.amount_minor;
      assert(
        !(await k("records")
          .where({ kind, partner_org_id: partner })
          .modify((q) => {
            if (existingId) q.whereNot("id", existingId);
          })
          .where(
            "payload",
            "like",
            `%"invoice_number":${JSON.stringify(payload.invoice_number)}%`,
          )
          .first()),
        409,
        "This supplier invoice number is already in use.",
      );
    }
    if (kind === "payments") {
      assert(
        parent!.status === "approved" && isBuyer(user, parent!),
        422,
        "Record payments against approved invoices only.",
      );
      total = amountMinor(payload.amount);
      const reserved = await k("records")
        .where({ kind, parent_id: parentId })
        .whereNot("status", "failed")
        .modify((q) => {
          if (existingId) q.whereNot("id", existingId);
        })
        .sum({ amount: "amount_minor" })
        .first();
      assert(
        total <= parent!.amount_minor - Number(reserved?.amount || 0),
        422,
        "This payment exceeds the unallocated invoice balance. Pending payments also reserve their amount.",
      );
      assert(
        !(await k("records")
          .where({ kind, buyer_org_id: buyer })
          .where(
            "payload",
            "like",
            `%"transaction_id":${JSON.stringify(payload.transaction_id)}%`,
          )
          .modify((q) => {
            if (existingId) q.whereNot("id", existingId);
          })
          .first()),
        409,
        "This transaction ID has already been recorded.",
      );
    }
    if (kind === "interviews")
      assert(
        ["shortlisted", "interview"].includes(parent!.status) &&
          isBuyer(user, parent!),
        422,
        "Schedule an interview for a shortlisted candidate.",
      );
    if (kind === "engagements") {
      assert(
        ["active", "renewed"].includes(parent!.status) &&
          isBuyer(user, parent!),
        422,
        "Engagements require an active staffing contract.",
      );
      await validatePartner(k, partner, ["staffing"]);
    }
    if (kind === "timesheets") {
      assert(
        parent!.status === "active" && isSeller(user, parent!),
        422,
        "Choose an active engagement for your organization.",
      );
      assert(
        payload.period_start >= parent!.payload.start_date &&
          payload.period_end <= parent!.payload.end_date,
        422,
        "The timesheet must fall within the engagement dates.",
      );
      const overlapping = await k("records")
        .where({ kind, parent_id: parentId })
        .whereNot("status", "rejected")
        .modify((q) => {
          if (existingId) q.whereNot("id", existingId);
        });
      assert(
        !overlapping.some((r: any) => {
          const p = parseJson(r.payload);
          return (
            p.period_start <= payload.period_end &&
            p.period_end >= payload.period_start
          );
        }),
        409,
        "A timesheet already covers part of this date range.",
      );
    }
    if (kind === "milestones")
      assert(
        ["approved", "sent", "acknowledged", "active", "renewed"].includes(
          parent!.status,
        ) && isSeller(user, parent!),
        422,
        "Choose an active order or contract for your organization.",
      );
    if (kind === "demos") {
      assert(
        parent!.status === "active" &&
          parent!.payload.item_type === "Technology",
        422,
        "Choose an active technology product.",
      );
      partner = parent!.owner_org_id;
      buyer = self;
    }
    if (kind === "performance")
      assert(
        ["fulfilled", "closed", "active", "renewed"].includes(parent!.status) &&
          isBuyer(user, parent!),
        422,
        "Review a delivered order or active contract belonging to your organization.",
      );
    if (kind === "contracts" && !parent) {
      if (user.internal || user.organization?.type === "client")
        await validatePartner(k, partner);
      else {
        buyer = input.buyer_org_id || null;
        await validatePartner(k, buyer, ["client"]);
      }
      assert(
        buyer !== partner,
        422,
        "A contract must connect two different organizations.",
      );
    }
    if (kind === "catalog") {
      partner = self;
      buyer = null;
      if (!user.internal) {
        if (user.organization?.type === "technology_partner")
          payload.item_type = "Technology";
        if (user.organization?.type === "service_provider")
          payload.item_type = "Service";
      }
    }
    if (["requirements", "rfqs"].includes(kind)) {
      buyer = self;
      partner = null;
    }
    if (kind === "tickets") {
      buyer = null;
      partner = null;
      if (!user.internal) {
        payload.assigned_team = existing?.payload.assigned_team || "Support";
        payload.resolution = existing?.payload.resolution || "";
      }
    }
    if (["rfqs", "quotations"].includes(kind))
      assert(items.length > 0, 422, "Add at least one line item.");
    if (["requirements", "rfqs", "quotations", "contracts"].includes(kind)) {
      const previousItems = existing ? await getItems(existing.id, k) : [];
      const parentItems = parent ? await getItems(parent.id, k) : [];
      for (const item of items) {
        if (
          !item.catalog_item_id ||
          [...previousItems, ...parentItems].some(
            (i) => i.catalog_item_id === item.catalog_item_id,
          )
        )
          continue;
        const catalog = await k("records")
          .join("organizations", "organizations.id", "records.owner_org_id")
          .where({
            "records.id": item.catalog_item_id,
            "records.kind": "catalog",
            "records.status": "active",
            "organizations.status": "active",
          })
          .select("records.*")
          .first();
        assert(
          catalog && (catalog.owner_org_id === self || can(user, "discovery")),
          422,
          "Choose an active catalog item available to your organization.",
        );
        assert(
          catalog.currency === input.currency,
          422,
          "Use catalog items in the transaction currency.",
        );
        const catalogPayload = parseJson(catalog.payload);
        assert(
          item.quantity >= Number(catalogPayload.moq || 1),
          422,
          `The minimum order quantity for ${catalog.title} is ${catalogPayload.moq || 1}.`,
        );
      }
    }
    if (!["orders", "invoices", "payments"].includes(kind)) {
      if (["rfqs", "quotations", "contracts", "requirements"].includes(kind))
        total = calculate(items, payload.delivery_charges || 0).total;
      else if (kind === "catalog") total = Math.round(payload.price * 100);
      else if (kind === "milestones") total = Math.round(payload.amount * 100);
    }
    if (["orders", "invoices", "payments"].includes(kind))
      assert(
        input.currency === parent!.currency,
        422,
        "The currency must match the linked transaction.",
      );
    const invitations = ["rfqs", "requirements"].includes(kind)
      ? input.invitations
      : [];
    for (const invitedId of invitations) {
      assert(
        invitedId !== self,
        422,
        "You cannot invite your own organization.",
      );
      await validatePartner(
        k,
        invitedId,
        kind === "requirements" && payload.requirement_type === "hiring"
          ? ["recruitment", "staffing"]
          : [
              "vendor",
              "supplier",
              "service_provider",
              "technology_partner",
              "business_partner",
              "other",
            ],
      );
    }
    const id = existingId || randomUUID();
    const data = {
      ...commercialKeys(
        kind,
        existing?.owner_org_id || self,
        partner,
        buyer,
        parentId,
        payload,
      ),
      title: input.title,
      payload: JSON.stringify(payload),
      amount_minor: total,
      currency: input.currency,
      updated_at: now(),
    };
    if (existing) {
      await snapshot(k, existing, user, input.note || "Record updated");
      const changed = await k("records")
        .where({ id, version: input.version })
        .update({ ...data, version: existing.version + 1 });
      assert(changed, 409, "This record was updated by another user.");
    } else {
      await k("records").insert({
        ...data,
        id,
        kind,
        number: await nextNumber(k, moduleDefinitions[kind].prefix),
        status: moduleDefinitions[kind].statuses[0],
        owner_org_id: self,
        buyer_org_id: buyer,
        partner_org_id: partner,
        parent_id: parentId,
        created_by: user.id,
        created_at: now(),
        version: 1,
      });
    }
    if (["rfqs", "requirements"].includes(kind)) {
      await k("record_invitations").where({ record_id: id }).delete();
      if (invitations.length)
        await k("record_invitations").insert(
          [...new Set(invitations)].map((organization_id) => ({
            record_id: id,
            organization_id,
          })),
        );
    }
    await saveItems(k, id, items);
    const saved = serializeRecord(await k("records").where({ id }).first());
    await startApproval(k, saved);
    await audit(
      k,
      user,
      existing ? "updated" : "created",
      kind,
      existing || saved,
      saved.status,
      input.note,
    );
    if (!existing && saved.status !== "draft")
      await notifyOrganizations(
        k,
        [buyer, partner],
        `${moduleDefinitions[kind].singular} created`,
        `${saved.number} · ${saved.title}`,
        `/app/${kind}/${id}`,
        kind,
        kind === "tickets"
          ? ["support", "super_admin"]
          : kind === "candidates"
            ? ["hr"]
            : [],
      );
    return recordDetail(id, user, k);
  };
  return transaction ? work(transaction) : db.transaction(work);
}
