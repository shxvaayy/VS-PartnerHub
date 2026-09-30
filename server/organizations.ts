import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, now, parseJson } from "./db.js";
import { INTERNAL_ORG_ID } from "./config.js";
import { assert } from "./errors.js";
import {
  authenticated,
  assertActive,
  can,
  permit,
  serializeOrg,
} from "./security.js";
import { audit, notifyOrganizations } from "./events.js";
import { organizationSchema, pagination, uuid } from "./validation.js";
import type { Organization, SessionUser } from "../shared/domain.js";
import { documentPolicies } from "./master-data.js";
export const organizationsRouter = Router();
organizationsRouter.use(authenticated);
const publicDetailKeys = [
  "description",
  "capabilities",
  "products",
  "services",
  "locations",
  "certifications",
  "naics",
  "sic",
  "domains",
  "hiring_types",
  "experience",
  "technologies",
  "integrations",
  "delivery_locations",
  "lead_time",
  "moq",
  "company_type",
  "logo_color",
  "documentation_url",
];
// Search only disclosed business fields. Searching the full JSON would let
// discovery queries infer private KYC values even when responses redact them.
export function searchPublicDetails(
  builder: ReturnType<typeof db>,
  term: string,
  keys = publicDetailKeys,
) {
  for (const key of keys) {
    if (db.client.config.client === "pg") {
      builder.orWhereRaw("lower(coalesce(??::jsonb ->> ?, '')) like ?", [
        "details",
        key,
        `%${term.toLowerCase()}%`,
      ]);
    } else {
      builder.orWhereRaw("lower(coalesce(json_extract(??, ?), '')) like ?", [
        "details",
        `$.${key}`,
        `%${term.toLowerCase()}%`,
      ]);
    }
  }
}
export const publicOrganization = (org: Organization) => ({
  id: org.id,
  number: org.number,
  type: org.type,
  legal_name: org.legal_name,
  trade_name: org.trade_name,
  industry: org.industry,
  city: org.city,
  country: org.country,
  website: org.website,
  logo_url: org.logo_url,
  status: org.status,
  created_at: org.created_at,
  updated_at: org.updated_at,
  details: Object.fromEntries(
    Object.entries(org.details).filter(([key]) =>
      publicDetailKeys.includes(key),
    ),
  ),
});
const fullProfileAccess = (user: SessionUser, org: Organization) =>
  user.organization_id === org.id ||
  (user.internal &&
    (can(user, "verification") ||
      can(user, "documents") ||
      user.role === "super_admin"));
// Lists and exports must select the same partners for the same filters. This
// deliberately searches only public business fields, never KYC JSON values.
export function organizationSearch(
  user: SessionUser,
  input: Record<string, unknown>,
) {
  const p = pagination.parse(input);
  const type = z.string().max(50).optional().parse(input.type);
  const location = z.string().trim().max(150).optional().parse(input.location);
  const certification = z
    .string()
    .trim()
    .max(150)
    .optional()
    .parse(input.certification);
  const q = db("organizations").whereNot("id", INTERNAL_ORG_ID);
  if (!user.internal || input.discovery === "true") q.where("status", "active");
  if (p.q)
    q.where((b) => {
      b.whereILike("legal_name", `%${p.q}%`)
        .orWhereILike("trade_name", `%${p.q}%`)
        .orWhereILike("industry", `%${p.q}%`);
      searchPublicDetails(b, p.q);
    });
  if (p.status) q.where("status", p.status);
  if (type) q.where("type", type);
  if (p.category) q.where("industry", p.category);
  if (location)
    q.where((b) => {
      b.whereILike("city", `%${location}%`).orWhereILike(
        "country",
        `%${location}%`,
      );
      searchPublicDetails(b, location, ["locations", "delivery_locations"]);
    });
  if (certification)
    q.where((b) => searchPublicDetails(b, certification, ["certifications"]));
  for (const [parameter, key] of Object.entries({
    technology: "technologies",
    product: "products",
    service: "services",
    capability: "capabilities",
    naics: "naics",
    sic: "sic",
    business_type: "company_type",
  })) {
    if (input[parameter]) {
      const value = z.string().trim().max(150).parse(input[parameter]);
      q.where((b) => searchPublicDetails(b, value, [key]));
    }
  }
  return { q, p };
}
organizationsRouter.get("/", async (req, res) => {
  assert(
    can(req.user, "organizations") || can(req.user, "discovery"),
    403,
    "Your role cannot browse the organization directory.",
  );
  if (!req.user.internal) assertActive(req.user);
  const { q, p } = organizationSearch(req.user, req.query);
  const count = await q.clone().count({ count: "*" }).first();
  const rows = await q
    .orderBy("created_at", "desc")
    .limit(p.limit)
    .offset((p.page - 1) * p.limit);
  res.json({
    items: rows.map((row) => {
      const org = serializeOrg(row);
      return fullProfileAccess(req.user, org) ? org : publicOrganization(org);
    }),
    total: Number(count?.count),
    page: p.page,
    limit: p.limit,
  });
});
organizationsRouter.get("/:id", async (req, res) => {
  const id = uuid.parse(req.params.id),
    row = await db("organizations").where({ id }).first();
  assert(row, 404, "Organization not found.");
  const org = serializeOrg(row);
  assert(
    req.user.organization_id === id ||
      (req.user.internal && can(req.user, "organizations")) ||
      (can(req.user, "discovery") && org.status === "active"),
    404,
    "Organization not found.",
  );
  if (!req.user.internal && req.user.organization_id !== id)
    assertActive(req.user);
  const catalog =
    org.status === "active"
      ? await db("records")
          .where({ owner_org_id: id, kind: "catalog", status: "active" })
          .select(
            "id",
            "title",
            "payload",
            "amount_minor",
            "currency",
            "status",
          )
      : [];
  res.json({
    ...(fullProfileAccess(req.user, org) ? org : publicOrganization(org)),
    catalog: catalog.map((i) => ({
      ...i,
      payload: parseJson(i.payload),
      amount_minor: Number(i.amount_minor),
    })),
  });
});
organizationsRouter.patch("/:id", async (req, res) => {
  const id = uuid.parse(req.params.id),
    input = organizationSchema.parse(req.body);
  assert(
    (req.user.organization_id === id && can(req.user, "profile", "edit")) ||
      (req.user.internal && can(req.user, "verification", "edit")),
    403,
    "Your role cannot edit this company profile.",
  );
  await db.transaction(async (k) => {
    const row = await k("organizations").where({ id }).first();
    assert(row, 404, "Organization not found.");
    assert(
      input.type === row.type,
      422,
      "Organization type cannot be changed after registration. Contact support if it is incorrect.",
    );
    const previous = parseJson(row.details);
    delete input.details.verification_note;
    const legalChanged =
      row.legal_name !== input.legal_name ||
      previous.pan !== input.details.pan ||
      previous.gst !== input.details.gst ||
      previous.cin !== input.details.cin;
    const status =
      legalChanged && row.status === "active" ? "under_review" : row.status;
    await k("organizations")
      .where({ id })
      .update({
        ...input,
        details: JSON.stringify({
          ...input.details,
          verification_note: previous.verification_note || "",
        }),
        status,
        updated_at: now(),
      });
    const matchingContact = await k("organization_contacts")
      .where({ organization_id: id, email: input.contact_email })
      .first();
    await k("organization_contacts")
      .where({ organization_id: id })
      .update({ is_primary: false });
    const contact = {
      organization_id: id,
      name: input.contact_name,
      email: input.contact_email,
      phone: input.contact_phone,
      role: input.details.contact_role || "Authorized Representative",
      active: true,
      is_primary: true,
      updated_at: now(),
    };
    if (matchingContact)
      await k("organization_contacts")
        .where({ id: matchingContact.id })
        .update(contact);
    else
      await k("organization_contacts").insert({
        ...contact,
        id: randomUUID(),
        created_at: now(),
      });
    await audit(
      k,
      req.user,
      legalChanged ? "legal_identity_updated" : "profile_updated",
      "organizations",
      row,
      status,
      legalChanged ? "Legal identity changes require verification again." : "",
    );
    if (status !== row.status)
      await notifyOrganizations(
        k,
        [id],
        "Company re-verification required",
        "Your legal identity changed. The VS team will review your company again.",
        "/app/profile",
        "verification",
        ["verification", "super_admin"],
      );
  });
  res.json(serializeOrg(await db("organizations").where({ id }).first()));
});
organizationsRouter.post(
  "/:id/status",
  permit("verification", "review"),
  async (req, res) => {
    assert(
      req.user.internal,
      403,
      "Only the VS verification team can review organizations.",
    );
    const id = uuid.parse(req.params.id);
    const { status, note } = z
      .object({
        status: z.enum([
          "under_review",
          "clarification",
          "verified",
          "active",
          "rejected",
          "suspended",
          "archived",
        ]),
        note: z.string().trim().max(2000).default(""),
      })
      .parse(req.body);
    assert(
      id !== INTERNAL_ORG_ID,
      403,
      "The platform organization cannot be modified here.",
    );
    await db.transaction(async (k) => {
      let q = k("organizations").where({ id });
      if (db.client.config.client === "pg") q = q.forUpdate();
      const org = await q.first();
      assert(org, 404, "Organization not found.");
      const allowed: Record<string, string[]> = {
        registered: ["under_review", "clarification", "rejected"],
        under_review: ["clarification", "verified", "active", "rejected"],
        clarification: ["under_review", "verified", "active", "rejected"],
        verified: ["active", "clarification", "rejected"],
        active: ["suspended", "under_review"],
        suspended: ["active", "archived"],
        rejected: ["under_review", "archived"],
        archived: ["under_review"],
      };
      assert(
        allowed[org.status]?.includes(status),
        422,
        "This organization cannot move to that status.",
      );
      if (
        ["clarification", "rejected", "suspended", "archived"].includes(status)
      )
        assert(note.length >= 5, 422, "Add a reason for this decision.");
      if (
        ["suspended", "archived"].includes(status) ||
        org.status === "suspended"
      )
        assert(
          req.user.role === "super_admin",
          403,
          "Only a Super Admin can suspend, archive or reactivate organizations.",
        );
      if (["verified", "active"].includes(status)) {
        assert(
          await k("users")
            .where({
              organization_id: id,
              role: "org_admin",
              email_verified: true,
              active: true,
            })
            .first(),
          422,
          "An organization administrator must verify their email first.",
        );
        const policies = await documentPolicies(org.type, k);
        const documents = await k("documents").where({
          organization_id: id,
          record_id: null,
        });
        const latest = documents.filter(
          (d) => !documents.some((next) => next.previous_id === d.id),
        );
        const missing = policies
          .filter((p) => p.required)
          .map((p) => p.category)
          .filter(
            (category: string) =>
              !latest.some(
                (d) =>
                  d.category === category &&
                  d.status === "approved" &&
                  (!d.expires_at || d.expires_at >= now().slice(0, 10)),
              ),
          );
        assert(
          !missing.length,
          422,
          `Approve the required, valid documents first: ${missing.join(", ")}.`,
        );
      }
      await k("organizations")
        .where({ id })
        .update({
          status,
          details: JSON.stringify({
            ...parseJson(org.details),
            verification_note: note,
          }),
          updated_at: now(),
        });
      if (status === "suspended")
        await k("sessions")
          .whereIn(
            "user_id",
            k("users").where({ organization_id: id }).select("id"),
          )
          .delete();
      await audit(
        k,
        req.user,
        "verification_decision",
        "organizations",
        org,
        status,
        note,
      );
      await notifyOrganizations(
        k,
        [id],
        status === "active"
          ? "Your organization is approved"
          : `Organization ${status.replaceAll("_", " ")}`,
        `${org.legal_name}${note ? `: ${note}` : " has a new verification status."}`,
        "/app/profile",
        "verification",
      );
    });
    res.json(serializeOrg(await db("organizations").where({ id }).first()));
  },
);
organizationsRouter.post("/:id/resubmit", async (req, res) => {
  const id = uuid.parse(req.params.id);
  assert(
    req.user.organization_id === id &&
      can(req.user, "profile", "edit") &&
      req.user.email_verified,
    403,
    "Only a verified company administrator can resubmit.",
  );
  await db.transaction(async (k) => {
    const org = await k("organizations").where({ id }).first();
    assert(
      org && ["clarification", "rejected"].includes(org.status),
      422,
      "This application does not need resubmission.",
    );
    await k("organizations")
      .where({ id })
      .update({ status: "under_review", updated_at: now() });
    await audit(
      k,
      req.user,
      "application_resubmitted",
      "organizations",
      org,
      "under_review",
    );
    await notifyOrganizations(
      k,
      [id],
      "Application resubmitted",
      `${org.legal_name} is ready for another review.`,
      "/app/verification",
      "verification",
      ["verification", "super_admin"],
    );
  });
  res.json({ ok: true });
});
