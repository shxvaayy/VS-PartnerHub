import { z } from "zod";
import type { Knex } from "knex";
import { db, now, parseJson } from "./db.js";
import { can, serializeOrg } from "./security.js";
import {
  canCreate,
  scopeRecords,
  serializeRecord,
  recordDetail,
} from "./record-service.js";
import { publicOrganization, searchPublicDetails } from "./organizations.js";
import {
  modules,
  moduleDefinitions,
  transitions,
  organizationTypes,
  type SessionUser,
} from "../shared/domain.js";
import type { InsightSource } from "../shared/ai.js";

const term = z.string().trim().max(160);
const dateOrEmpty = z
  .string()
  .refine(
    (value) =>
      !value ||
      (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
        !Number.isNaN(Date.parse(value)) &&
        new Date(value).toISOString().slice(0, 10) === value),
    "Use an ISO date or an empty string.",
  );
export const partnerCriteriaSchema = z
  .object({
    query: term.default(""),
    industry: term.default(""),
    category: term.default(""),
    location: term.default(""),
    products: term.default(""),
    services: term.default(""),
    technology: term.default(""),
    certifications: term.default(""),
    capabilities: term.default(""),
    verification: z
      .enum(["active", "verified", "active_or_verified"])
      .default("active"),
    type: z.union([z.enum(organizationTypes), z.literal("")]).default(""),
  })
  .strict();
export const retrievalPlanSchema = z.object({
  questionType: z
    .enum(["platform", "workspace", "conversation", "capabilities"])
    .default("workspace"),
  records: z
    .array(
      z.object({
        module: z.enum(modules),
        statuses: z.array(z.string().max(40)).max(12),
        query: term,
        dueBefore: dateOrEmpty,
        createdBefore: dateOrEmpty,
        recordIds: z.array(z.string().uuid()).max(8).optional(),
        includeDetails: z.boolean().optional(),
      }),
    )
    .max(4),
  documents: z
    .object({
      query: term,
      statuses: z.array(z.string().max(40)).max(8),
      expiresBefore: dateOrEmpty,
    })
    .nullable(),
  partners: partnerCriteriaSchema.nullable(),
  includeAlerts: z.boolean(),
});
export type RetrievalPlan = z.infer<typeof retrievalPlanSchema>;

export const emptyRetrievalPlan = (): RetrievalPlan => ({
  questionType: "workspace",
  records: [],
  documents: null,
  partners: null,
  includeAlerts: false,
});
// These rules select real database queries, never canned answers. Complex or
// qualified questions still use the constrained language-model planner.
export function commonQuestion(message: string):
  | {
      plan: RetrievalPlan;
      context: "greeting" | "guide" | "workspace" | "lookup";
      action?: "records" | "documents" | "summary";
    }
  | undefined {
  const text = message
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .trim();
  const conversational = text
    .normalize("NFKC")
    .replace(/([a-z])\1{2,}/g, "$1")
    .replace(/\bu\b/g, "you")
    .replace(/\bur\b/g, "your")
    .replace(/\bcanu\b/g, "can you")
    .replace(/^(?:hi|hello|hey)(?:\s+(?:bro|bhai|there))?[\s,.!]*/, "")
    .replace(/^(?:(?:i (?:said|asked)|please|pls|bro|bhai)[\s,.!]+)+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (
    /^(what(?: all)? can (?:you|vs ai) do(?: for me)?|how can (?:you|vs ai) help(?: me)?|(?:tell me )?(?:about )?your (?:capabilities|features)|what (?:are|r) your (?:capabilities|features)|what do you do)$/.test(
      conversational,
    )
  )
    return {
      plan: { ...emptyRetrievalPlan(), questionType: "capabilities" },
      context: "guide",
    };
  if (
    /^(hi|hello|hey|namaste|namaskar|salaam|salam|good morning|good afternoon|good evening|thanks|thank you)( there| bhai)?$/.test(
      text,
    )
  )
    return { plan: emptyRetrievalPlan(), context: "greeting" };
  if (
    /^(how do i secure my sign[- ]in|how (do i|to) (change|reset) my password|what (is|can) vs (ai|partnerhub)( do)?)$/.test(
      text,
    )
  )
    return {
      plan: { ...emptyRetrievalPlan(), questionType: "platform" },
      context: "guide",
    };
  if (
    /^(summarize|show|give me)( my| the)? (workspace|dashboard)( summary)?$/.test(
      text,
    )
  )
    return {
      plan: emptyRetrievalPlan(),
      context: "workspace",
      action: "summary",
    };
  if (/^(show|list)( me)?( my| the)?( open| pending) rfqs$/.test(text))
    return {
      plan: {
        ...emptyRetrievalPlan(),
        records: [
          {
            module: "rfqs",
            statuses: ["published", "evaluation"],
            query: "",
            dueBefore: "",
            createdBefore: "",
          },
        ],
      },
      context: "lookup",
      action: "records",
    };
  if (/^(explain|show|list)( me)?( my| the)? overdue invoices$/.test(text))
    return {
      plan: {
        ...emptyRetrievalPlan(),
        records: [
          {
            module: "invoices",
            statuses: ["submitted", "under_review", "approved"],
            query: "",
            dueBefore: new Date(Date.now() - 86400000)
              .toISOString()
              .slice(0, 10),
            createdBefore: "",
          },
        ],
      },
      context: "lookup",
      action: "records",
    };
  if (/^which( company)? documents need review$/.test(text))
    return {
      plan: {
        ...emptyRetrievalPlan(),
        documents: {
          query: "",
          statuses: ["uploaded", "under_review"],
          expiresBefore: "",
        },
      },
      context: "lookup",
      action: "documents",
    };
}

export const moduleSource = (kind: string): InsightSource => ({
  id: `module:${kind}`,
  type: "module",
  title:
    kind in moduleDefinitions
      ? moduleDefinitions[kind as keyof typeof moduleDefinitions].label
      : {
          documents: "Company documents",
          discovery: "Partner discovery",
          reports: "Reports & operational outlook",
          settings: "Account & security",
          verification: "VS verification",
          dashboard: "Workspace overview",
          ai: "VS PartnerHub AI Assistant",
        }[kind] || kind,
  href:
    kind === "dashboard"
      ? "/app"
      : kind === "settings"
        ? "/app/settings"
        : kind === "reports"
          ? "/app/insights"
          : `/app/${kind}`,
});
export function platformGuide(
  user: SessionUser,
  workflowModules: readonly string[] = [],
) {
  const workspaceModules = [
    ...modules,
    "documents",
    "discovery",
    "reports",
    "settings",
    "verification",
    "dashboard",
    "ai",
  ].filter((kind) => can(user, kind));
  return {
    name: "VS PartnerHub AI Assistant",
    asOf: now(),
    role: user.role,
    capabilities: [
      {
        name: "Workspace assistant",
        description:
          "Answer platform questions, summarize authorized records and explain RFQ, quotation, document or invoice status.",
        href: "/app/ai",
      },
      ...(can(user, "documents")
        ? [
            {
              name: "Document extraction",
              description:
                "Read a PDF or image, extract company and certificate fields, flag format issues and send the result for human review. AI cannot approve documents.",
              href: "/app/ai?mode=document",
            },
          ]
        : []),
      ...(canCreate(user, "requirements")
        ? [
            {
              name: "Requirement drafting",
              description:
                "Turn a business or hiring brief into an editable draft with skills, quantity, experience, location, technology, delivery needs and missing information.",
              href: "/app/ai?mode=draft",
            },
          ]
        : []),
      ...(canCreate(user, "orders") &&
      can(user, "quotations") &&
      can(user, "rfqs")
        ? [
            {
              name: "Quotation analysis",
              description:
                "Compare submitted prices, tax, discounts, delivery, warranty and payment terms. The authorized buyer decides the award.",
              href: "/app/ai?mode=comparison",
            },
          ]
        : []),
      ...(can(user, "discovery")
        ? [
            {
              name: "Partner discovery",
              description:
                "Find authorized partner profiles by industry, category, location, products, services, technology, certifications, capabilities and verification status.",
              href: "/app/ai?mode=discovery",
            },
          ]
        : []),
      ...(can(user, "reports")
        ? [
            {
              name: "Operational alerts",
              description:
                "Explain expiry, late delivery, unpaid invoice aging, recruitment aging, unusual procurement activity and vendor-response trends using recorded evidence.",
              href: "/app/ai?mode=alerts",
            },
          ]
        : []),
    ],
    navigation: workspaceModules.map((kind) => ({
      ...moduleSource(kind),
      ...(kind in moduleDefinitions
        ? {
            purpose:
              moduleDefinitions[kind as keyof typeof moduleDefinitions]
                .description,
            ...(workflowModules.includes(kind)
              ? { workflow: transitions[kind as keyof typeof transitions] }
              : {}),
          }
        : {}),
    })),
    facts: [
      "Onboarding: choose an organization type and authorized contact role, enter company/business details, upload required documents, verify email by OTP, then wait for VS verification. Company email is recommended; Gmail is not banned by the product policy.",
      "Only active organizations and verified users can transact. An email code proves email ownership; the VS verification team separately reviews company documents and organization approval.",
      "RFQs contain a response deadline, line items, specifications, delivery terms and invited partners. Eligible partners submit quotations; buyers review and compare before an award.",
      "Approving a quotation permits a purchase order. Suppliers acknowledge and deliver; the buyer confirms delivery. Invoices move from draft to submitted, under review, approved and paid. Payments record settlement evidence; the application does not execute bank transfers.",
      "Document uploads and renewals create versions. OCR and format checks are aids. A VS verifier makes the approval or rejection decision and records notes.",
      "Settings includes notification preferences, sign-in OTP, password change and active sessions. Forgot password on the sign-in screen sends a single-use recovery link through the configured email provider.",
      "Recruitment follows submission, screening, shortlist, interview, selection, offer, BGV, onboarding and joining. Only authorized hiring parties can view candidate records.",
      "AI may explain evidence and prepare drafts. It cannot publish, approve, reject, invite, verify, pay or change a business record. Follow a permitted module link for those actions.",
    ],
  };
}
function jsonText(
  q: Knex.QueryBuilder,
  column: string,
  keys: string[],
  value: string,
) {
  for (const key of keys) {
    if (db.client.config.client === "pg")
      q.orWhereRaw("lower(coalesce(??::jsonb ->> ?, '')) like ?", [
        column,
        key,
        `%${value.toLowerCase()}%`,
      ]);
    else
      q.orWhereRaw("lower(coalesce(json_extract(??, ?), '')) like ?", [
        column,
        `$.${key}`,
        `%${value.toLowerCase()}%`,
      ]);
  }
}
export async function findPartners(
  user: SessionUser,
  criteria: z.infer<typeof partnerCriteriaSchema>,
  limit = 60,
) {
  if (!can(user, "discovery"))
    return { items: [], total: 0, denied: true, criteria };
  const q = db("organizations").whereNot("id", user.organization_id || "");
  // External discovery includes active organizations only, matching the regular directory.
  const states = user.internal
    ? criteria.verification === "active_or_verified"
      ? ["active", "verified"]
      : [criteria.verification]
    : ["active"];
  if (!user.internal && criteria.verification === "verified")
    return {
      items: [],
      total: 0,
      criteria,
      note: "Partner discovery for external accounts contains approved active organizations.",
    };
  q.whereIn("status", states);
  if (criteria.type) q.where("type", criteria.type);
  if (criteria.industry) q.whereILike("industry", `%${criteria.industry}%`);
  if (criteria.query)
    q.where((b) => {
      b.whereILike("legal_name", `%${criteria.query}%`).orWhereILike(
        "trade_name",
        `%${criteria.query}%`,
      );
      searchPublicDetails(b, criteria.query);
    });
  if (criteria.location)
    q.where((b) => {
      b.whereILike("city", `%${criteria.location}%`).orWhereILike(
        "country",
        `%${criteria.location}%`,
      );
      searchPublicDetails(b, criteria.location, [
        "locations",
        "delivery_locations",
      ]);
    });
  for (const [field, keys] of Object.entries({
    category: [
      "products",
      "services",
      "technologies",
      "domains",
      "capabilities",
    ],
    products: ["products"],
    services: ["services"],
    technology: ["technologies"],
    certifications: ["certifications"],
    capabilities: ["capabilities"],
  })) {
    const value = criteria[field as keyof typeof criteria];
    if (value) q.where((b) => searchPublicDetails(b, value, keys));
  }
  const count = await q.clone().count({ count: "*" }).first();
  const items = (await q.orderBy("legal_name").limit(limit)).map((row) =>
    publicOrganization(serializeOrg(row)),
  );
  return {
    items,
    total: Number(count?.count || 0),
    criteria,
    limit,
    truncated: Number(count?.count || 0) > items.length,
  };
}
const recordKeys = [
  "category",
  "description",
  "location",
  "required_date",
  "deadline",
  "due_date",
  "end_date",
  "delivery_date",
  "expected_date",
  "payment_terms",
  "warranty",
  "delivery_charges",
  "lead_time",
  "skills",
  "experience",
  "notice_period",
  "technology",
  "delivery_requirements",
  "requirement_type",
  "positions",
  "quantity",
  "rating",
  "resolution",
];
export function safeRecordSummary(row: any) {
  const r = serializeRecord(row);
  return {
    id: r.id,
    type: "record" as const,
    href: `/app/${r.kind}/${r.id}`,
    title: `${r.number} · ${r.title}`,
    kind: r.kind,
    status: r.status,
    currency: r.currency,
    amount_minor: r.amount_minor,
    updated_at: r.updated_at,
    details: Object.fromEntries(
      recordKeys
        .filter((key) => r.payload[key] !== undefined)
        .map((key) => [key, r.payload[key]]),
    ),
  };
}
export async function retrieveEvidence(user: SessionUser, plan: RetrievalPlan) {
  const sources: InsightSource[] = [],
    records = [];
  for (const query of plan.records) {
    if (!can(user, query.module)) {
      records.push({ query, denied: true, items: [], total: 0 });
      continue;
    }
    const q = scopeRecords(db("records").where("kind", query.module), user);
    if (query.recordIds?.length) q.whereIn("records.id", query.recordIds);
    if (query.statuses.length) q.whereIn("status", query.statuses);
    if (query.query)
      q.where((b) => {
        b.whereILike("title", `%${query.query}%`).orWhereILike(
          "number",
          `%${query.query}%`,
        );
        jsonText(
          b,
          "payload",
          ["category", "description", "location", "skills", "technology"],
          query.query,
        );
      });
    if (query.createdBefore)
      q.where("created_at", "<", `${query.createdBefore}T23:59:59.999Z`);
    if (query.dueBefore) {
      const dueKeys: Record<string, string | undefined> = {
        invoices: "due_date",
        rfqs: "deadline",
        requirements: "required_date",
        orders: "delivery_date",
        deliveries: "expected_date",
        contracts: "end_date",
        milestones: "due_date",
        candidates: "joining_date",
      };
      const key = dueKeys[query.module];
      if (key) {
        const expression =
          db.client.config.client === "pg"
            ? "??::jsonb ->> ?"
            : "json_extract(??, ?)";
        const bindings = [
          "payload",
          db.client.config.client === "pg" ? key : `$.${key}`,
        ];
        q.whereRaw(`(${expression}) <> '' AND (${expression}) <= ?`, [
          ...bindings,
          ...bindings,
          query.dueBefore,
        ]);
      }
    }
    const count = await q.clone().count({ count: "*" }).first();
    const rows: any[] = await q.orderBy("updated_at", "desc").limit(12);
    // Search may name a candidate, but personal payloads still require explicit selection.
    const items = rows.map((row) =>
      ["candidates", "interviews", "engagements"].includes(row.kind)
        ? {
            id: row.id,
            type: "record" as const,
            title: `${row.number} · ${row.title}`,
            href: `/app/${row.kind}/${row.id}`,
            kind: row.kind,
            status: row.status,
            updated_at: row.updated_at,
          }
        : safeRecordSummary(row),
    );
    if (
      query.includeDetails &&
      !["candidates", "interviews", "engagements"].includes(query.module)
    ) {
      for (const item of items.slice(0, 3))
        Object.assign(item, {
          recordDetails: await recordDetail(item.id, user),
        });
    }
    if (query.module === "invoices")
      for (const item of items) {
        const paid = await db("records")
          .where({ parent_id: item.id, kind: "payments", status: "completed" })
          .sum({ paid: "amount_minor" })
          .first();
        Object.assign(item, {
          paid_minor: Number(paid?.paid || 0),
          outstanding_minor: Math.max(
            0,
            Number(rows.find((r) => r.id === item.id)?.amount_minor || 0) -
              Number(paid?.paid || 0),
          ),
        });
      }
    sources.push(
      moduleSource(query.module),
      ...items.map(({ id, type, title, href }) => ({ id, type, title, href })),
    );
    records.push({
      query,
      items,
      total: Number(count?.count || 0),
      limit: 12,
      detailLimit: query.includeDetails ? 3 : 0,
      truncated: Number(count?.count || 0) > items.length,
    });
  }
  let documents: any = null;
  if (plan.documents) {
    if (!can(user, "documents")) documents = { denied: true, items: [] };
    else {
      const q = db("documents")
        .whereNull("record_id")
        .whereNotExists(
          db("documents as next").whereRaw("next.previous_id = documents.id"),
        );
      if (!user.internal) q.where("organization_id", user.organization_id);
      if (plan.documents.query)
        q.where((b) =>
          b
            .whereILike("name", `%${plan.documents!.query}%`)
            .orWhereILike("category", `%${plan.documents!.query}%`),
        );
      if (plan.documents.statuses.length)
        q.whereIn("status", plan.documents.statuses);
      if (plan.documents.expiresBefore)
        q.where("expires_at", "<=", plan.documents.expiresBefore);
      const count = await q.clone().count({ count: "*" }).first();
      const items = await q
        .select(
          "id",
          "name",
          "category",
          "status",
          "expires_at",
          "review_note",
          "version",
          "updated_at",
        )
        .orderBy("updated_at", "desc")
        .limit(12);
      sources.push(
        moduleSource("documents"),
        ...items.map((d) => ({
          id: d.id,
          type: "document" as const,
          title: `${d.category} · ${d.name}`,
          href: `/app/documents?document=${d.id}`,
        })),
      );
      documents = {
        query: plan.documents,
        items,
        total: Number(count?.count || 0),
        limit: 12,
        truncated: Number(count?.count || 0) > items.length,
      };
    }
  }
  const partners = plan.partners
    ? await findPartners(user, plan.partners, 12)
    : null;
  if (partners && !partners.denied)
    sources.push(
      moduleSource("discovery"),
      ...partners.items.map((p) => ({
        id: p.id,
        type: "organization" as const,
        title: p.legal_name,
        href: `/app/organizations/${p.id}`,
      })),
    );
  return { records, documents, partners, sources };
}
