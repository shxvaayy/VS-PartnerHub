import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { db, now } from "./db.js";
import { config, INTERNAL_ORG_ID } from "./config.js";
import { authenticated, can, permit } from "./security.js";
import { assert } from "./errors.js";
import { scopeRecords } from "./record-service.js";
import {
  documentPolicyCatalogue,
  resolveDocumentPolicies,
} from "./master-data.js";
import { audit } from "./events.js";
import { csv } from "./records.js";
import { date } from "./validation.js";
import { powerBiArchive } from "./bi-exports.js";
import {
  label,
  modules,
  moduleDefinitions,
  organizationLabels,
  organizationTypes,
  type Module,
  type SessionUser,
} from "../shared/domain.js";
import {
  reportLabels,
  reportViews,
  reportTableIds,
  type AnalyticsReport,
  type ReportColumn,
  type ReportDataset,
  type ReportMetric,
  type ReportTable,
  type ReportView,
  type ReportViewId,
} from "../shared/analytics.js";

const DAY = 86400000;
const commercialKinds: Module[] = [
  "quotations",
  "orders",
  "contracts",
  "invoices",
  "payments",
];
export const analyticsFilters = z
  .object({
    from: date.optional(),
    to: date.optional(),
    currency: z.enum(["INR", "USD", "EUR", "GBP"]).default("INR"),
  })
  .transform((input) => ({
    ...input,
    from:
      input.from || new Date(Date.now() - 179 * DAY).toISOString().slice(0, 10),
    to: input.to || now().slice(0, 10),
  }))
  .refine((input) => input.from <= input.to, {
    message: "The start date must be on or before the end date.",
    path: ["from"],
  })
  .refine(
    (input) => Date.parse(input.to) - Date.parse(input.from) <= 3660 * DAY,
    {
      message: "Choose a reporting period of ten years or fewer.",
      path: ["from"],
    },
  );
type Filters = z.infer<typeof analyticsFilters>;
type Group = {
  kind: Module;
  status: string;
  currency: string;
  subtype: string | null;
  count: number;
  total: number;
  positions: number;
};
const safeInteger = (value: unknown) => {
  const number = Number(value || 0);
  assert(
    Number.isSafeInteger(number),
    422,
    "This reporting total is too large. Narrow the reporting period.",
  );
  return number;
};
const sum = (values: number[]) =>
  safeInteger(values.reduce((total, value) => total + value, 0));
const ratio = (part: number, total: number) =>
  total ? Math.round((part / total) * 1000) / 10 : null;
const field = (alias: string, key: string) =>
  db.client.config.client === "pg"
    ? db.raw("??::jsonb ->> ?", [`${alias}.payload`, key])
    : db.raw("json_extract(??, ?)", [`${alias}.payload`, `$.${key}`]);
const column = (
  key: string,
  title: string,
  format: ReportColumn["format"] = "number",
): ReportColumn => ({ key, label: title, format });
const metric = (
  key: string,
  title: string,
  value: number | null,
  definition: string,
  scope: ReportMetric["scope"] = "period",
  format: ReportMetric["format"] = "number",
  href?: string,
): ReportMetric => ({
  key,
  label: title,
  value,
  definition,
  scope,
  format,
  href,
});
const recordLink = (kind: string, status?: string) =>
  `/app/${kind}${status ? `?status=${status}` : ""}`;
const emptyDataset = (): ReportDataset => ({ columns: [], rows: [] });

export async function buildAnalytics(
  user: SessionUser,
  filters: Filters,
): Promise<AnalyticsReport> {
  assert(can(user, "reports"), 403, "Your role cannot view analytics.");
  assert(
    modules.some((kind) => can(user, kind)) ||
      can(user, "organizations") ||
      can(user, "documents"),
    403,
    "Reporting requires access to at least one source module. Add source scopes to this integration token or contact your administrator.",
  );
  const generatedAt = now(),
    today = generatedAt.slice(0, 10);
  const dateAfter = (days: number) =>
    new Date(Date.parse(today) + days * DAY).toISOString().slice(0, 10);
  const { from, to, currency } = filters;
  const period = (query: any, alias: string) =>
    query
      .where(`${alias}.created_at`, ">=", `${from}T00:00:00.000Z`)
      .where(`${alias}.created_at`, "<=", `${to}T23:59:59.999Z`);
  const records = (
    kinds: readonly Module[] = modules,
    inPeriod = true,
    alias = "r",
  ) => {
    const query = scopeRecords(
      db({ [alias]: "records" }).whereIn(
        `${alias}.kind`,
        kinds.filter((kind) => can(user, kind)),
      ),
      user,
      alias,
    );
    return inPeriod ? period(query, alias) : query;
  };
  const organizations = () => {
    const query = db("organizations").whereNot(
      "organizations.id",
      INTERNAL_ORG_ID,
    );
    if (!user.internal) query.where("organizations.id", user.organization_id);
    if (!can(user, "organizations")) query.whereRaw("1 = 0");
    return query;
  };
  const documents = () => {
    const query = db("documents")
      .whereNull("documents.record_id")
      .whereNotExists(
        db("documents as newer").whereRaw("newer.previous_id = documents.id"),
      );
    if (!user.internal)
      query.where("documents.organization_id", user.organization_id);
    if (!can(user, "documents")) query.whereRaw("1 = 0");
    return query;
  };
  const summaryQuery = (inPeriod: boolean) =>
    records(modules, inPeriod)
      .select(
        "r.kind",
        "r.status",
        "r.currency",
        db.raw("? as subtype", [field("r", "requirement_type")]),
      )
      .count({ count: "*" })
      .sum({ total: "r.amount_minor" })
      .select(
        db.raw(
          "coalesce(sum(case when r.kind = 'requirements' then cast(coalesce(nullif(?, ''), '1') as numeric) else 0 end), 0) as positions",
          [field("r", "positions")],
        ),
      )
      .groupBy("r.kind", "r.status", "r.currency", "subtype");
  const expiryBucket = db.raw(
    "case when expires_at is null or expires_at = '' then 'No expiry' when expires_at < ? then 'Expired' when expires_at <= ? then '0–30 days' when expires_at <= ? then '31–60 days' when expires_at <= ? then '61–90 days' else 'Beyond 90 days' end",
    [today, dateAfter(30), dateAfter(60), dateAfter(90)],
  );
  const [
    rawGroups,
    rawCurrent,
    monthly,
    organizationGroups,
    registrationMonths,
    documentGroups,
    expiryGroups,
    documentMonths,
  ]: [any[], any[], any[], any[], any[], any[], any[], any[]] =
    await Promise.all([
      summaryQuery(true),
      summaryQuery(false),
      records()
        .select(db.raw("substr(r.created_at, 1, 7) as month"), "r.kind")
        .count({ count: "*" })
        .groupByRaw("substr(r.created_at, 1, 7), r.kind")
        .orderBy("month"),
      organizations()
        .select("type", "status")
        .count({ count: "*" })
        .groupBy("type", "status"),
      period(organizations(), "organizations")
        .select(db.raw("substr(created_at, 1, 7) as month"))
        .count({ count: "*" })
        .groupByRaw("substr(created_at, 1, 7)")
        .orderBy("month"),
      documents()
        .select("category", "status")
        .count({ count: "*" })
        .groupBy("category", "status"),
      documents()
        .select(expiryBucket.wrap("", " as bucket"))
        .count({ count: "*" })
        .groupBy("bucket"),
      period(documents(), "documents")
        .select(db.raw("substr(created_at, 1, 7) as month"))
        .count({ count: "*" })
        .groupByRaw("substr(created_at, 1, 7)")
        .orderBy("month"),
    ]);
  const normalize = (rows: any[]): Group[] =>
    rows.map((row) => ({
      ...row,
      count: safeInteger(row.count),
      total: safeInteger(row.total),
      positions: safeInteger(row.positions),
    }));
  const groups = normalize(rawGroups),
    current = normalize(rawCurrent);
  const matching = (
    source: Group[],
    kind: Module,
    statuses?: string[],
    subtype?: string,
  ) =>
    source.filter(
      (row) =>
        row.kind === kind &&
        (!statuses || statuses.includes(row.status)) &&
        (!subtype || row.subtype === subtype),
    );
  const count = (
    kind: Module,
    statuses?: string[],
    snapshot = false,
    subtype?: string,
  ) =>
    matching(snapshot ? current : groups, kind, statuses, subtype).reduce(
      (sum, row) => sum + row.count,
      0,
    );
  const amount = (kind: Module, statuses?: string[]) =>
    matching(groups, kind, statuses)
      .filter((row) => row.currency === currency)
      .reduce((sum, row) => sum + row.total, 0);
  const orgCount = (type?: string, statuses?: string[]) =>
    organizationGroups
      .filter(
        (row) =>
          (!type || row.type === type) &&
          (!statuses || statuses.includes(row.status)),
      )
      .reduce((sum, row) => sum + safeInteger(row.count), 0);
  const trend = (rows: any[], kind?: Module) => {
    const values = new Map<string, number>();
    for (const row of rows)
      if (!kind || row.kind === kind)
        values.set(
          row.month,
          (values.get(row.month) || 0) + safeInteger(row.count),
        );
    const result = [];
    for (
      let at = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
      at.toISOString().slice(0, 7) <= to.slice(0, 7);
      at.setUTCMonth(at.getUTCMonth() + 1)
    ) {
      const month = at.toISOString().slice(0, 7);
      result.push({ month, value: values.get(month) || 0 });
    }
    return result;
  };
  const distribution = (kind: Module) =>
    moduleDefinitions[kind].statuses.map((status) => ({
      name: label(status),
      value: count(kind, [status]),
      href: recordLink(kind, status),
    }));
  const volumeDataset = (
    kinds: Module[],
    requirementType?: string,
  ): ReportDataset => ({
    columns: [
      column("module", "Module", "text"),
      column("status", "Status", "text"),
      column("requirement_type", "Requirement type", "text"),
      column("currency", "Currency", "text"),
      column("records", "Records"),
      column("amount_minor", "Recorded value", "money"),
    ],
    rows: groups
      .filter(
        (row) =>
          kinds.includes(row.kind) &&
          (!requirementType ||
            row.kind !== "requirements" ||
            row.subtype === requirementType),
      )
      .map((row) => ({
        module: row.kind,
        status: row.status,
        requirement_type: row.kind === "requirements" ? row.subtype : null,
        currency: row.currency,
        records: row.count,
        amount_minor: commercialKinds.includes(row.kind) ? row.total : null,
      })),
  });
  const views = new Map<ReportViewId, ReportView>();
  const add = (id: ReportViewId, view: Partial<ReportView> = {}) => {
    const result: ReportView = {
      id,
      ...reportLabels[id],
      metrics: [],
      distribution: [],
      distributionLabel: "Status distribution",
      trend: [],
      trendLabel: "Created during the reporting period",
      dataset: emptyDataset(),
      tables: [],
      notes: [],
      ...view,
    };
    views.set(id, result);
    return result;
  };
  const baseNotes = [
    "Period metrics use records created between the selected dates, in UTC. Their statuses are current; this is not a reconstruction of a historical snapshot.",
    "Counts include every permitted currency. Monetary KPIs use the selected currency; currencies are never added together.",
  ];
  const executive = add("executive", {
    dataset: volumeDataset([...modules]),
    trend: trend(monthly),
    trendLabel: "Business records created",
    notes: [...baseNotes],
    distribution: modules
      .filter((kind) => can(user, kind))
      .map((kind) => ({
        name: moduleDefinitions[kind].label,
        value: count(kind),
        href: recordLink(kind),
      })),
    distributionLabel: "Activity by module",
  });
  if (modules.some((kind) => can(user, kind)))
    executive.metrics.push(
      metric(
        "records",
        "Business records",
        sum(groups.map((row) => row.count)),
        "All permitted business records created in the selected period.",
        "period",
      ),
    );
  if (can(user, "documents"))
    executive.metrics.push(
      metric(
        "documents",
        "Current documents",
        sum(documentGroups.map((row) => safeInteger(row.count))),
        "Latest organization documents in the authorized scope, excluding transaction attachments and superseded versions.",
        "current",
        "number",
        "/app/documents",
      ),
    );
  if (can(user, "organizations")) {
    executive.metrics.push(
      metric(
        "organizations",
        "Total organizations",
        orgCount(),
        "Current organizations, excluding the internal VS platform organization.",
        "current",
        "number",
        "/app/organizations",
      ),
    );
    executive.metrics.push(
      metric(
        "active_organizations",
        "Active organizations",
        orgCount(undefined, ["active"]),
        "Organizations currently active after verification.",
        "current",
        "number",
        "/app/organizations?status=active",
      ),
    );
    executive.metrics.push(
      metric(
        "pending_verification",
        "Pending verification",
        orgCount(undefined, [
          "registered",
          "under_review",
          "clarification",
          "verified",
        ]),
        "Registered, under-review, clarification and verified organizations awaiting active status.",
        "current",
        "number",
        "/app/verification",
      ),
    );
    const partners = add("partners", {
      metrics: executive.metrics.filter((item) =>
        [
          "organizations",
          "active_organizations",
          "pending_verification",
        ].includes(item.key),
      ),
      trend: trend(registrationMonths),
      trendLabel: "Organizations registered",
      distribution: organizationTypes.map((type) => ({
        name: organizationLabels[type],
        value: orgCount(type),
        href: `/app/organizations?type=${type}`,
      })),
      distributionLabel: "Organizations by type",
      notes: [
        "Organization totals and verification states are current. The trend shows registrations in the selected period.",
        "External users see their own organization only.",
      ],
      dataset: {
        columns: [
          column("organization_type", "Organization type", "text"),
          column("status", "Current status", "text"),
          column("organizations", "Organizations"),
        ],
        rows: organizationGroups.map((row) => ({
          organization_type: row.type,
          status: row.status,
          organizations: safeInteger(row.count),
        })),
      },
    });
    partners.tables.push({
      id: "verification",
      title: "Verification stages",
      description:
        "Current organization states. These counts describe today's queue and active network; they are not historical conversion rates.",
      scope: "current",
      columns: [
        column("status", "Verification status", "text"),
        column("organizations", "Organizations"),
      ],
      rows: [
        "draft",
        "registered",
        "under_review",
        "clarification",
        "verified",
        "active",
        "suspended",
        "rejected",
        "archived",
      ].map((status) => ({
        status,
        organizations: orgCount(undefined, [status]),
      })),
    });
    for (const type of organizationTypes)
      partners.metrics.push(
        metric(
          `organizations_${type}`,
          organizationLabels[type],
          orgCount(type),
          `Current ${organizationLabels[type]} organizations in your permitted scope.`,
          "current",
          "number",
          `/app/organizations?type=${type}`,
        ),
      );
    partners.metrics.push(
      metric(
        "suspended",
        "Suspended organizations",
        orgCount(undefined, ["suspended"]),
        "Organizations currently suspended.",
        "current",
        "number",
        "/app/organizations?status=suspended",
      ),
    );
  }
  if (!modules.some((kind) => can(user, kind))) {
    executive.trend = can(user, "organizations")
      ? trend(registrationMonths)
      : trend(documentMonths);
    executive.trendLabel = can(user, "organizations")
      ? "Organizations registered"
      : "Latest document versions uploaded";
  }
  for (const kind of [
    "rfqs",
    "quotations",
    "orders",
    "contracts",
    "invoices",
    "payments",
  ] as const)
    if (can(user, kind))
      executive.metrics.push(
        metric(
          kind,
          moduleDefinitions[kind].label,
          count(kind),
          `${moduleDefinitions[kind].label} created in the selected period, including all statuses.`,
          "period",
          "number",
          recordLink(kind),
        ),
      );

  const procurementKinds: Module[] = [
    "requirements",
    "rfqs",
    "quotations",
    "orders",
    "deliveries",
    "contracts",
  ];
  let procurement: ReportView | undefined;
  if (procurementKinds.some((kind) => can(user, kind))) {
    procurement = add("procurement", {
      dataset: volumeDataset(procurementKinds, "procurement"),
      trend: trend(monthly, "rfqs"),
      trendLabel: "RFQs created",
      distribution: can(user, "rfqs") ? distribution("rfqs") : [],
      distributionLabel: "RFQ status",
      notes: [...baseNotes],
    });
    for (const kind of [
      "requirements",
      "rfqs",
      "quotations",
      "orders",
    ] as const)
      if (can(user, kind))
        procurement.metrics.push(
          metric(
            kind,
            moduleDefinitions[kind].label,
            kind === "requirements"
              ? count(kind, undefined, false, "procurement")
              : count(kind),
            kind === "requirements"
              ? "Procurement requirements created in the period; hiring requirements are excluded."
              : `${moduleDefinitions[kind].label} created in the period, including drafts.`,
            "period",
            "number",
            kind === "requirements"
              ? "/app/requirements?requirement_type=procurement"
              : recordLink(kind),
          ),
        );
    if (can(user, "quotations")) {
      const quoted = matching(groups, "quotations").filter(
          (row) => row.status !== "draft" && row.currency === currency,
        ),
        quoteCount = quoted.reduce((sum, row) => sum + row.count, 0),
        total = quoted.reduce((sum, row) => sum + row.total, 0);
      procurement.metrics.push(
        metric(
          "average_quotation",
          "Average submitted quotation",
          quoteCount
            ? new Decimal(total).div(quoteCount).toDecimalPlaces(0).toNumber()
            : null,
          "Mean total, including tax, discounts and delivery, across non-draft quotations created in the period and selected currency. Revisions are not counted as extra quotations.",
          "period",
          "money",
          "/app/quotations",
        ),
      );
    }
    if (can(user, "orders"))
      procurement.metrics.push(
        metric(
          "po_value",
          "Purchase order value",
          amount("orders", [
            "approved",
            "sent",
            "acknowledged",
            "fulfilled",
            "closed",
          ]),
          "Approved or later purchase orders created in the period, in the selected currency. Draft and pending-approval values are excluded.",
          "period",
          "money",
          "/app/orders",
        ),
      );
  }

  let responseRows: any[] = [];
  if (can(user, "rfqs") && can(user, "quotations")) {
    const rfqs = records(["rfqs"]).whereNot("r.status", "draft").select("r.id");
    const invitations = db("record_invitations as invite").whereIn(
      "invite.record_id",
      rfqs,
    );
    if (!user.internal)
      invitations.where((query) =>
        query
          .where("invite.organization_id", user.organization_id)
          .orWhereExists(
            db("records as rfq")
              .whereRaw("rfq.id = invite.record_id")
              .where((q) =>
                q
                  .where("rfq.buyer_org_id", user.organization_id)
                  .orWhere("rfq.owner_org_id", user.organization_id),
              ),
          ),
      );
    const quote = records(["quotations"], false, "quote")
      .whereRaw("quote.parent_id = invite.record_id")
      .whereRaw("quote.partner_org_id = invite.organization_id")
      .whereNot("quote.status", "draft")
      .select(db.raw("1"));
    responseRows = await invitations
      .select("invite.organization_id")
      .count({ invitations: "*" })
      .select(
        db.raw("sum(case when exists ? then 1 else 0 end) as responses", [
          quote,
        ]),
      )
      .groupBy("invite.organization_id");
    const total = responseRows.reduce(
        (sum, row) => sum + safeInteger(row.invitations),
        0,
      ),
      responses = responseRows.reduce(
        (sum, row) => sum + safeInteger(row.responses),
        0,
      );
    procurement?.metrics.push(
      metric(
        "rfq_response_rate",
        "RFQ response rate",
        ratio(responses, total),
        "Invitation pairs with at least one non-draft quotation ÷ visible invitations to non-draft RFQs created in the period. Revisions count once; responses are measured as of now. Vendors see their own invitations.",
        "period",
        "percent",
        "/app/rfqs",
      ),
    );
    procurement?.metrics.push(
      metric(
        "rfq_invitations",
        "Partner invitations",
        total,
        "Visible invitations to non-draft RFQs created in the selected period.",
        "period",
        "number",
        "/app/rfqs",
      ),
    );
  }

  const orderAccess = can(user, "orders"),
    deliveryAccess = orderAccess && can(user, "deliveries"),
    reviewAccess = can(user, "performance"),
    responseAccess = can(user, "rfqs") && can(user, "quotations");
  if (orderAccess || deliveryAccess || reviewAccess || responseAccess) {
    const performance = add("performance", {
      trend: trend(
        monthly,
        orderAccess ? "orders" : responseAccess ? "rfqs" : "performance",
      ),
      trendLabel: orderAccess
        ? "Orders created"
        : responseAccess
          ? "RFQs created"
          : "Reviews created",
      notes: [
        "Each measure uses its source records created in the reporting period. Delivery measures require access to both deliveries and orders; response measures require RFQs and quotations.",
        "On-time rates use confirmed deliveries, their first audited delivered date and the order’s promised date. Missing dates are excluded; the evidence sample count remains visible. Ratings use published reviews only.",
      ],
    });
    const orderRows: any[] = orderAccess
      ? await records(["orders"])
          .whereNotIn("r.status", ["draft", "pending_approval"])
          .select("r.partner_org_id")
          .count({ orders: "*" })
          .select(
            db.raw(
              "sum(case when r.status in ('fulfilled','closed') then 1 else 0 end) as completed",
            ),
          )
          .groupBy("r.partner_org_id")
      : [];
    const delivered = db("audit_logs")
      .where({ module: "deliveries", new_status: "delivered" })
      .select("record_id")
      .min({ delivered_at: "created_at" })
      .groupBy("record_id")
      .as("event");
    const deliveryRows: any[] = deliveryAccess
      ? await records(["deliveries"])
          .where("r.status", "confirmed")
          .join("records as po", "po.id", "r.parent_id")
          .whereIn(
            "po.id",
            records(["orders"], false, "allowed_po").select("allowed_po.id"),
          )
          .leftJoin(delivered, "event.record_id", "r.id")
          .select("r.partner_org_id")
          .count({ confirmed: "*" })
          .select(
            db.raw(
              "sum(case when event.delivered_at is not null and coalesce(?, '') <> '' then 1 else 0 end) as samples",
              [field("po", "delivery_date")],
            ),
            db.raw(
              "sum(case when event.delivered_at is not null and coalesce(?, '') <> '' and substr(event.delivered_at, 1, 10) <= ? then 1 else 0 end) as on_time",
              [field("po", "delivery_date"), field("po", "delivery_date")],
            ),
          )
          .groupBy("r.partner_org_id")
      : [];
    const rating = db.raw(
      "(cast(? as numeric) + cast(? as numeric) + cast(? as numeric) + cast(? as numeric)) / 4.0",
      [
        field("r", "quality"),
        field("r", "delivery"),
        field("r", "communication"),
        field("r", "value"),
      ],
    );
    const reviewRows: any[] = reviewAccess
      ? await records(["performance"])
          .where("r.status", "published")
          .select("r.partner_org_id")
          .count({ reviews: "*" })
          .select(db.raw("sum(?) as rating_total", [rating]))
          .groupBy("r.partner_org_id")
      : [];
    const ids = [
      ...new Set(
        [...orderRows, ...deliveryRows, ...reviewRows]
          .map((row) => row.partner_org_id)
          .concat(responseRows.map((row) => row.organization_id))
          .filter(Boolean),
      ),
    ];
    const names = ids.length
      ? await db("organizations").whereIn("id", ids).select("id", "legal_name")
      : [];
    const rows = names
      .map((organization) => {
        const order = orderRows.find(
            (row) => row.partner_org_id === organization.id,
          ),
          delivery = deliveryRows.find(
            (row) => row.partner_org_id === organization.id,
          ),
          review = reviewRows.find(
            (row) => row.partner_org_id === organization.id,
          ),
          response = responseRows.find(
            (row) => row.organization_id === organization.id,
          );
        return {
          partner: String(organization.legal_name),
          orders: safeInteger(order?.orders),
          completed_orders: safeInteger(order?.completed),
          confirmed_deliveries: safeInteger(delivery?.confirmed),
          rated_deliveries: safeInteger(delivery?.samples),
          on_time_deliveries: safeInteger(delivery?.on_time),
          on_time_rate: ratio(
            safeInteger(delivery?.on_time),
            safeInteger(delivery?.samples),
          ),
          published_reviews: safeInteger(review?.reviews),
          average_rating:
            safeInteger(review?.reviews) > 0
              ? Math.round(
                  (Number(review.rating_total) / Number(review.reviews)) * 10,
                ) / 10
              : null,
          invitations: safeInteger(response?.invitations),
          responses: safeInteger(response?.responses),
          response_rate: ratio(
            safeInteger(response?.responses),
            safeInteger(response?.invitations),
          ),
        };
      })
      .sort((a, b) => a.partner.localeCompare(b.partner));
    const samples = sum(rows.map((row) => row.rated_deliveries)),
      onTime = sum(rows.map((row) => row.on_time_deliveries)),
      reviews = sum(reviewRows.map((row) => safeInteger(row.reviews)));
    const columns: ReportColumn[] = [column("partner", "Partner", "text")];
    if (orderAccess) {
      performance.metrics.push(
        metric(
          "qualified_orders",
          "Approved orders",
          sum(rows.map((row) => row.orders)),
          "Orders at approved or later status, created in the period.",
          "period",
          "number",
          "/app/orders",
        ),
        metric(
          "completed_orders",
          "Completed orders",
          sum(rows.map((row) => row.completed_orders)),
          "Orders currently fulfilled or closed, created in the period.",
          "period",
          "number",
          "/app/orders",
        ),
      );
      columns.push(
        column("orders", "Approved orders"),
        column("completed_orders", "Completed orders"),
      );
    }
    if (deliveryAccess) {
      performance.metrics.push(
        metric(
          "on_time_rate",
          "On-time deliveries",
          ratio(onTime, samples),
          "Confirmed deliveries whose first recorded delivered date was on or before the order’s promised date ÷ confirmed deliveries with both dates recorded.",
          "period",
          "percent",
          "/app/deliveries?status=confirmed",
        ),
        metric(
          "rated_deliveries",
          "Delivery evidence samples",
          samples,
          "Confirmed deliveries with a promised date and an audited delivered timestamp.",
          "period",
        ),
      );
      columns.push(
        column("confirmed_deliveries", "Confirmed deliveries"),
        column("rated_deliveries", "Delivery samples"),
        column("on_time_deliveries", "On-time deliveries"),
        column("on_time_rate", "On-time rate", "percent"),
      );
    }
    if (reviewAccess) {
      performance.metrics.push(
        metric(
          "average_rating",
          "Average partner rating",
          reviews
            ? Math.round(
                (reviewRows.reduce(
                  (total, row) => total + Number(row.rating_total),
                  0,
                ) /
                  reviews) *
                  10,
              ) / 10
            : null,
          "Mean of quality, delivery, communication and value ratings across published reviews, out of five.",
          "period",
          "decimal",
          "/app/performance?status=published",
        ),
        metric(
          "published_reviews",
          "Published reviews",
          reviews,
          "Published reviews created in the reporting period.",
          "period",
          "number",
          "/app/performance?status=published",
        ),
      );
      columns.push(
        column("published_reviews", "Published reviews"),
        column("average_rating", "Average rating", "decimal"),
      );
    }
    if (responseAccess) {
      performance.metrics.push(
        metric(
          "response_rate",
          "Partner response rate",
          ratio(
            sum(rows.map((row) => row.responses)),
            sum(rows.map((row) => row.invitations)),
          ),
          "Visible RFQ invitation pairs with a non-draft quotation divided by visible invitations; revisions count once.",
          "period",
          "percent",
          "/app/rfqs",
        ),
      );
      columns.push(
        column("invitations", "RFQ invitations"),
        column("responses", "Responses"),
        column("response_rate", "Response rate", "percent"),
      );
    }
    performance.distribution = rows.map((row) => ({
      name: row.partner,
      value: orderAccess
        ? row.completed_orders
        : responseAccess
          ? row.responses
          : row.published_reviews,
    }));
    performance.distributionLabel = orderAccess
      ? "Completed orders by partner"
      : responseAccess
        ? "Responses by partner"
        : "Published reviews by partner";
    // Omit ungranted sources from both the column definitions and JSON rows.
    performance.dataset = {
      columns,
      rows: rows.map((row) =>
        Object.fromEntries(
          columns.map((c) => [c.key, row[c.key as keyof typeof row]]),
        ),
      ),
    };
  }

  if (
    ["candidates", "interviews", "engagements", "timesheets"].some((kind) =>
      can(user, kind),
    )
  ) {
    const recruitment = add("recruitment", {
      trend: trend(monthly, "candidates"),
      trendLabel: "Candidate submissions",
      distribution: can(user, "candidates") ? distribution("candidates") : [],
      distributionLabel: "Current candidate stage",
      dataset: volumeDataset(
        [
          "requirements",
          "candidates",
          "interviews",
          "engagements",
          "timesheets",
        ],
        "hiring",
      ),
      notes: [
        "Candidate stages show each candidate’s current status, not cumulative conversion through earlier stages. Candidate names, resumes and compensation are excluded from analytics exports.",
        "Closed-position totals are the advertised positions on closed hiring requirements; they do not imply those positions were all filled.",
      ],
    });
    if (can(user, "requirements")) {
      const hiring = matching(groups, "requirements", undefined, "hiring");
      recruitment.metrics.push(
        metric(
          "hiring_requirements",
          "Hiring requirements",
          count("requirements", undefined, false, "hiring"),
          "Hiring requirements created during the period; procurement requirements are excluded.",
          "period",
          "number",
          "/app/requirements?requirement_type=hiring",
        ),
        metric(
          "open_positions",
          "Open positions",
          hiring
            .filter((row) => row.status === "open")
            .reduce((sum, row) => sum + row.positions, 0),
          "Sum of positions on currently open hiring requirements created in the period.",
          "period",
          "number",
          "/app/requirements?status=open&requirement_type=hiring",
        ),
        metric(
          "closed_positions",
          "Closed requirement positions",
          hiring
            .filter((row) => row.status === "closed")
            .reduce((sum, row) => sum + row.positions, 0),
          "Sum of advertised positions on closed hiring requirements created in the period, including any closed without a hire.",
          "period",
          "number",
          "/app/requirements?status=closed&requirement_type=hiring",
        ),
      );
    }
    if (can(user, "candidates")) {
      recruitment.metrics.push(
        metric(
          "candidates",
          "Candidates submitted",
          count("candidates"),
          "Candidate submissions created in the reporting period, across all current stages.",
          "period",
          "number",
          "/app/candidates",
        ),
      );
      for (const [status, title] of [
        ["shortlisted", "Shortlisted"],
        ["selected", "Selected"],
        ["offer", "At offer stage"],
        ["bgv", "In background verification"],
        ["onboarding", "Onboarding"],
        ["joined", "Joined"],
      ])
        recruitment.metrics.push(
          metric(
            `candidates_${status}`,
            title,
            count("candidates", [status]),
            `Candidates created in the period currently at the ${label(status)} stage.`,
            "period",
            "number",
            recordLink("candidates", status),
          ),
        );
    }
    if (can(user, "interviews"))
      recruitment.metrics.push(
        metric(
          "interviews",
          "Interviews scheduled",
          count("interviews", ["scheduled"]),
          "Interviews created in the period whose current status is scheduled.",
          "period",
          "number",
          "/app/interviews?status=scheduled",
        ),
      );
  }

  if (can(user, "invoices") || can(user, "payments")) {
    const finance = add("finance", {
      trend: trend(monthly, can(user, "invoices") ? "invoices" : "payments"),
      trendLabel: can(user, "invoices")
        ? "Invoices created"
        : "Payments created",
      distribution: can(user, "payments")
        ? distribution("payments")
        : distribution("invoices"),
      distributionLabel: can(user, "payments")
        ? "Payment status"
        : "Invoice status",
      dataset: volumeDataset(["invoices", "payments"]),
      notes: [...baseNotes],
    });
    if (can(user, "invoices"))
      finance.metrics.push(
        metric(
          "invoices",
          "Invoices created",
          count("invoices"),
          "Invoices created in the selected period, including drafts and rejected invoices.",
          "period",
          "number",
          "/app/invoices",
        ),
        metric(
          "invoice_value",
          "Approved invoice value",
          amount("invoices", ["approved", "paid"]),
          "Approved or paid invoices created in the selected period and selected currency.",
          "period",
          "money",
          "/app/invoices",
        ),
      );
    if (can(user, "invoices") && can(user, "payments")) {
      finance.notes.push(
        "Outstanding and overdue balances are current across approved/paid invoices in the selected currency, including older invoices. Only completed payment records reduce balances; pending, processing and failed payments do not.",
      );
      const paid = records(["payments"], false, "payment")
        .where({ "payment.status": "completed", "payment.currency": currency })
        .select("payment.parent_id")
        .sum({ paid: "payment.amount_minor" })
        .groupBy("payment.parent_id")
        .as("settlement");
      const balances = records(["invoices"], false, "invoice")
        .whereIn("invoice.status", ["approved", "paid"])
        .where("invoice.currency", currency)
        .leftJoin(paid, "settlement.parent_id", "invoice.id")
        .select(
          "invoice.id",
          db.raw("? as due_date", [field("invoice", "due_date")]),
          db.raw(
            "case when invoice.amount_minor > coalesce(settlement.paid,0) then invoice.amount_minor - coalesce(settlement.paid,0) else 0 end as outstanding_minor",
          ),
        )
        .as("balance");
      const bucket = db.raw(
        "case when due_date is null or due_date = '' then 'No due date' when due_date >= ? then 'Not overdue' when due_date >= ? then '1–30 days' when due_date >= ? then '31–60 days' when due_date >= ? then '61–90 days' else 'Over 90 days' end",
        [today, dateAfter(-30), dateAfter(-60), dateAfter(-90)],
      );
      const aging: any[] = await db
        .from(balances)
        .where("outstanding_minor", ">", 0)
        .select(bucket.wrap("", " as bucket"))
        .count({ invoices: "*" })
        .sum({ outstanding_minor: "outstanding_minor" })
        .groupBy("bucket");
      const outstanding = sum(
          aging.map((row) => safeInteger(row.outstanding_minor)),
        ),
        overdue = sum(
          aging
            .filter(
              (row) =>
                !["Not overdue", "No due date"].includes(String(row.bucket)),
            )
            .map((row) => safeInteger(row.outstanding_minor)),
        );
      finance.metrics.push(
        metric(
          "outstanding",
          "Outstanding balance",
          outstanding,
          "Positive invoice balances in the selected currency after completed payments, across all approved/paid invoices.",
          "current",
          "money",
          "/app/invoices?status=approved",
        ),
        metric(
          "overdue",
          "Overdue balance",
          overdue,
          "Outstanding balance on invoices whose due date is before today, across all approved/paid invoices in the selected currency.",
          "current",
          "money",
          "/app/invoices?status=approved",
        ),
      );
      finance.tables.push({
        id: "aging",
        title: "Invoice aging",
        description:
          "Current balances after completed payments. Aging is measured from the due date; all creation dates are included.",
        scope: "current",
        columns: [
          column("bucket", "Days overdue", "text"),
          column("currency", "Currency", "text"),
          column("invoices", "Invoices"),
          column("outstanding_minor", "Outstanding balance", "money"),
        ],
        rows: [
          "Not overdue",
          "1–30 days",
          "31–60 days",
          "61–90 days",
          "Over 90 days",
          "No due date",
        ].map((bucket) => {
          const row = aging.find((row) => row.bucket === bucket);
          return {
            bucket,
            currency,
            invoices: safeInteger(row?.invoices),
            outstanding_minor: safeInteger(row?.outstanding_minor),
          };
        }),
      });
    }
    if (can(user, "payments"))
      finance.metrics.push(
        metric(
          "payments_completed",
          "Completed payments",
          amount("payments", ["completed"]),
          "Completed payment records created in the selected period and currency. This records settlement evidence; it does not execute bank transfers.",
          "period",
          "money",
          "/app/payments?status=completed",
        ),
        metric(
          "payments_failed",
          "Failed payments",
          count("payments", ["failed"]),
          "Payment records created in the period whose current status is failed.",
          "period",
          "number",
          "/app/payments?status=failed",
        ),
      );
  }

  if (can(user, "documents")) {
    const compliance = add("compliance", {
      trend: trend(documentMonths),
      trendLabel: "Latest document versions uploaded",
      distribution: expiryGroups.map((row) => ({
        name: String(row.bucket),
        value: safeInteger(row.count),
      })),
      distributionLabel: "Document expiry windows",
      dataset: {
        columns: [
          column("category", "Document category", "text"),
          column("status", "Review status", "text"),
          column("documents", "Current documents"),
        ],
        rows: documentGroups.map((row) => ({
          category: row.category,
          status: row.status,
          documents: safeInteger(row.count),
        })),
      },
      notes: [
        "Document snapshots include the latest version of each organization document. Transaction attachments and superseded versions are excluded.",
        "Expiry windows are mutually exclusive: expired, today through 30 days, 31–60 days, and 61–90 days. They are measured from today; the date filter applies to the upload trend.",
      ],
    });
    for (const bucket of ["Expired", "0–30 days", "31–60 days", "61–90 days"])
      compliance.metrics.push(
        metric(
          `expiry_${bucket}`,
          bucket === "Expired" ? "Expired documents" : `Expires in ${bucket}`,
          safeInteger(expiryGroups.find((row) => row.bucket === bucket)?.count),
          `Latest organization documents in the ${bucket} expiry window. Rejected documents retain their actual expiry date and remain visible for correction.`,
          "current",
          "number",
          "/app/documents",
        ),
      );
    for (const [status, title] of [
      ["uploaded", "Awaiting review"],
      ["under_review", "Under review"],
      ["rejected", "Rejected documents"],
    ])
      compliance.metrics.push(
        metric(
          `documents_${status}`,
          title,
          documentGroups
            .filter((row) => row.status === status)
            .reduce((sum, row) => sum + safeInteger(row.count), 0),
          `Latest organization documents currently ${label(status).toLowerCase()}.`,
          "current",
          "number",
          `/app/documents?status=${status}`,
        ),
      );
    const renewals = await documents()
      .whereNotNull("previous_id")
      .whereIn("status", ["uploaded", "under_review"])
      .count({ count: "*" })
      .first();
    compliance.metrics.push(
      metric(
        "renewals_pending",
        "Renewals awaiting review",
        safeInteger(renewals?.count),
        "Latest replacement versions that are uploaded or under review. Previous approvals are not reused for a new file.",
        "current",
        "number",
        "/app/documents",
      ),
    );
    if (can(user, "organizations")) {
      const catalogue = await documentPolicyCatalogue();
      let missing = 0,
        affected = 0;
      for (const type of organizationTypes) {
        const required = resolveDocumentPolicies(type, catalogue).filter(
          (policy) => policy.required,
        );
        if (!required.length) continue;
        const conditions = required.map((policy) =>
          documents()
            .whereRaw("documents.organization_id = organizations.id")
            .where("category", policy.category)
            .whereNot("status", "rejected")
            .select(db.raw("1")),
        );
        const absent = conditions.map((query) =>
          db.raw("case when not exists ? then 1 else 0 end", [query]),
        );
        const expression = db.raw(absent.map(() => "?").join(" + "), absent);
        const row = await organizations()
          .where("type", type)
          .whereNotIn("status", ["draft", "archived"])
          .select(
            db.raw("coalesce(sum(?),0) as missing", [expression]),
            db.raw(
              "coalesce(sum(case when (?) > 0 then 1 else 0 end),0) as affected",
              [expression],
            ),
          )
          .first();
        missing += safeInteger(row?.missing);
        affected += safeInteger(row?.affected);
      }
      compliance.metrics.push(
        metric(
          "missing_required_documents",
          "Missing required documents",
          missing,
          "Required categories without a current, non-rejected upload, using the applicable organization-type policy. Draft/archived organizations are excluded. An uploaded document still needs human approval.",
          "current",
          "number",
          "/app/verification",
        ),
        metric(
          "organizations_missing_documents",
          "Organizations with gaps",
          affected,
          "Organizations missing at least one required document category; each organization is counted once.",
          "current",
          "number",
          "/app/verification",
        ),
      );
    }
  }

  if (can(user, "tickets")) {
    const support = add("support", {
      trend: trend(monthly, "tickets"),
      trendLabel: "Tickets opened",
      distribution: distribution("tickets"),
      distributionLabel: "Current ticket status",
      notes: [
        "Ticket volume uses creation dates in the selected period. Current workload also includes unresolved tickets created before the period.",
        "Resolution time uses the first audited move to Resolved and the ticket creation timestamp. Tickets without that audit evidence are excluded; no resolution time is invented.",
      ],
    });
    support.metrics = [
      metric(
        "tickets",
        "Tickets opened",
        count("tickets"),
        "Support tickets created in the selected period.",
        "period",
        "number",
        "/app/tickets",
      ),
      metric(
        "unresolved",
        "Current open workload",
        count(
          "tickets",
          ["open", "assigned", "in_progress", "waiting_for_user"],
          true,
        ),
        "All currently open, assigned, in-progress or waiting tickets, including those created before the selected period.",
        "current",
        "number",
        "/app/tickets",
      ),
      metric(
        "resolved",
        "Resolved or closed",
        count("tickets", ["resolved", "closed"]),
        "Tickets created in the period that are now resolved or closed.",
        "period",
        "number",
        "/app/tickets?status=resolved",
      ),
    ];
    const resolved = db("audit_logs")
      .where({ module: "tickets", new_status: "resolved" })
      .select("record_id")
      .min({ resolved_at: "created_at" })
      .groupBy("record_id")
      .as("resolution");
    const hours =
      db.client.config.client === "pg"
        ? db.raw(
            "extract(epoch from (resolution.resolved_at::timestamptz - r.created_at::timestamptz)) / 3600.0",
          )
        : db.raw(
            "(julianday(resolution.resolved_at) - julianday(r.created_at)) * 24.0",
          );
    const time = await records(["tickets"])
      .join(resolved, "resolution.record_id", "r.id")
      .whereRaw("resolution.resolved_at >= r.created_at")
      .select(db.raw("avg(?) as hours", [hours]))
      .count({ samples: "*" })
      .first();
    support.metrics.push(
      metric(
        "resolution_hours",
        "Average resolution hours",
        safeInteger(time?.samples) > 0
          ? Math.round(Number(time.hours) * 10) / 10
          : null,
        "Mean hours from creation to the first audited Resolved event for tickets created in the period.",
        "period",
        "decimal",
      ),
      metric(
        "resolution_samples",
        "Resolution samples",
        safeInteger(time?.samples),
        "Tickets with both creation and first-resolution timestamps available.",
        "period",
      ),
    );
    const rows: any[] = await records(["tickets"])
      .select(
        "r.status",
        db.raw("? as category", [field("r", "category")]),
        db.raw("? as priority", [field("r", "priority")]),
        db.raw("? as assigned_team", [field("r", "assigned_team")]),
      )
      .count({ tickets: "*" })
      .groupBy("r.status", "category", "priority", "assigned_team");
    support.dataset = {
      columns: [
        column("status", "Status", "text"),
        column("category", "Category", "text"),
        column("priority", "Priority", "text"),
        column("assigned_team", "Assigned team", "text"),
        column("tickets", "Tickets"),
      ],
      rows: rows.map((row) => ({
        status: row.status,
        category: row.category || "Other",
        priority: row.priority || "normal",
        assigned_team: row.assigned_team || "Support",
        tickets: safeInteger(row.tickets),
      })),
    };
  }

  const metricDataset = (metrics: ReportMetric[]): ReportDataset => ({
    columns: [
      column("metric", "Metric key", "text"),
      column("label", "Metric", "text"),
      column("value", "Value", "decimal"),
      column("format", "Value format", "text"),
      column("currency", "Currency", "text"),
      column("scope", "Measurement scope", "text"),
      column("definition", "Calculation", "text"),
    ],
    rows: metrics.map((item) => ({
      metric: item.key,
      label: item.label,
      value: item.value,
      format: item.format,
      currency: item.format === "money" ? currency : null,
      scope: item.scope,
      definition: item.definition,
    })),
  });
  executive.dataset = metricDataset(executive.metrics);
  const periodLink = (href: string, inPeriod: boolean, inCurrency = false) => {
    const url = new URL(href, "https://partnerhub.invalid");
    const kind = url.pathname.split("/")[2];
    if (modules.includes(kind as Module)) {
      if (inPeriod) {
        url.searchParams.set("from", from);
        url.searchParams.set("to", to);
      }
      if (inCurrency) url.searchParams.set("currency", currency);
    }
    return url.pathname + url.search;
  };
  for (const view of views.values()) {
    for (const item of view.metrics) {
      if (item.value !== null && ["number", "money"].includes(item.format))
        safeInteger(item.value);
      if (item.href)
        item.href = periodLink(
          item.href,
          item.scope === "period",
          item.format === "money",
        );
    }
    for (const item of view.distribution)
      if (item.href)
        item.href = periodLink(
          item.href,
          !["partners", "compliance"].includes(view.id),
        );
    const scope = ["partners", "compliance"].includes(view.id)
      ? "current"
      : view.id === "executive"
        ? "mixed"
        : "period";
    const tables: ReportTable[] = [
      {
        id: "summary",
        title: "Summary dataset",
        description:
          "Exact values behind this report. Monetary fields are stored in minor currency units; divide by 100 for major units.",
        scope,
        ...view.dataset,
      },
      {
        id: "metrics",
        title: "KPI definitions & values",
        description:
          "Calculations, units and measurement scope for every visible metric. A blank value means there is no qualifying evidence.",
        scope: "mixed",
        ...metricDataset(view.metrics),
      },
      {
        id: "trend",
        title: "Monthly trend",
        description:
          view.trendLabel +
          ". Boundary months include only dates inside the selected period.",
        scope: "period",
        columns: [
          column("month", "Month", "text"),
          column("records", "Records"),
        ],
        rows: view.trend.map((row) => ({
          month: row.month,
          records: row.value,
        })),
      },
      {
        id: "distribution",
        title: view.distributionLabel,
        description: "Exact category counts used in the distribution chart.",
        scope:
          view.id === "partners" || view.id === "compliance"
            ? "current"
            : "period",
        columns: [
          column("category", "Category", "text"),
          column("records", "Records"),
        ],
        rows: view.distribution.map((row) => ({
          category: row.name,
          records: row.value,
        })),
      },
    ];
    view.tables = [...tables, ...view.tables];
  }
  return {
    version: 1,
    generatedAt,
    from,
    to,
    currency,
    views: reportViews.flatMap((id) => (views.has(id) ? [views.get(id)!] : [])),
  };
}

export const analyticsHandler: RequestHandler = async (req, res) =>
  res.json(await buildAnalytics(req.user, analyticsFilters.parse(req.query)));
export const datasetHandler: RequestHandler = async (req, res) => {
  const id = z.enum(reportViews).parse(req.params.view);
  const tableId = z
    .enum(reportTableIds)
    .default("summary")
    .parse(req.query.table);
  const report = await buildAnalytics(
    req.user,
    analyticsFilters.parse(req.query),
  );
  const table = report.views
    .find((view) => view.id === id)
    ?.tables.find((table) => table.id === tableId);
  assert(
    table,
    403,
    "This dataset is not available with your current permissions.",
  );
  await audit(
    db,
    req.user,
    "analytics_exported",
    "reports",
    undefined,
    undefined,
    `${id}/${tableId}; ${report.from} through ${report.to}; ${report.currency}`,
  );
  res
    .type("text/csv")
    .attachment(`VS-PartnerHub-${id}-${tableId}-${report.to}.csv`)
    .send(
      csv([
        [
          "period_start",
          "period_end",
          "snapshot_at",
          "measurement_scope",
          ...table.columns.map((column) => column.key),
        ],
        ...table.rows.map((row) => [
          report.from,
          report.to,
          report.generatedAt,
          table.scope,
          ...table.columns.map((column) => row[column.key] ?? ""),
        ]),
      ]),
    );
};
export const reportsRouter = Router();
reportsRouter.use(authenticated, permit("reports"));
reportsRouter.get("/analytics", analyticsHandler);
reportsRouter.get("/datasets/:view", datasetHandler);
reportsRouter.get("/power-bi", async (req, res) => {
  const report = await buildAnalytics(
    req.user,
    analyticsFilters.parse(req.query),
  );
  const archive = powerBiArchive(report, config.appUrl);
  await audit(
    db,
    req.user,
    "power_bi_workspace_exported",
    "reports",
    undefined,
    undefined,
    `${report.views.length} permitted dashboards; ${report.from} through ${report.to}; ${report.currency}`,
  );
  res
    .type("application/zip")
    .attachment(`VS-PartnerHub-Power-BI-${report.to}.zip`)
    .send(archive);
});
reportsRouter.get("/power-query", async (req, res) => {
  const view = z.enum(reportViews).default("executive").parse(req.query.view);
  const table = z
    .enum(reportTableIds)
    .default("summary")
    .parse(req.query.table);
  const filters = analyticsFilters.parse(req.query);
  const root = config.appUrl.replace(/\/$/, "").replaceAll('"', '""');
  const source = `// VS PartnerHub — authenticated, organization-scoped analytics.
// In Power BI / Excel Power Query, create a blank query and paste this function.
// Invoke with a revocable integration token that includes reports and its source scopes.
// No token or password is embedded. Monetary values remain in minor currency units.
// Configure the HTTPS source as Anonymous; the Authorization header carries the token.
// Optional date arguments support scheduled refresh with your chosen reporting window.
(AccessToken as text, optional PeriodStart as nullable date, optional PeriodEnd as nullable date) as table =>
let
    FromDate = if PeriodStart = null then "${filters.from}" else Date.ToText(PeriodStart, "yyyy-MM-dd"),
    ToDate = if PeriodEnd = null then "${filters.to}" else Date.ToText(PeriodEnd, "yyyy-MM-dd"),
    Source = Json.Document(Web.Contents("${root}", [RelativePath = "api/integration/reports/analytics", Query = [from = FromDate, to = ToDate, currency = "${filters.currency}"], Headers = [Authorization = "Bearer " & AccessToken], Timeout = #duration(0,0,2,0)])),
    Views = List.Select(Source[views], each [id] = "${view}"),
    Tables = if List.IsEmpty(Views) then error "This token cannot access the selected report. Review its scopes." else List.Select(Views{0}[tables], each [id] = "${table}"),
    Dataset = if List.IsEmpty(Tables) then error "The selected dataset requires additional source permissions." else Tables{0},
    Columns = List.Transform(Dataset[columns], each [key]),
    Rows = Table.FromRecords(Dataset[rows], Columns, MissingField.UseNull),
    Types = List.Transform(Dataset[columns], each {[key], if [format] = "text" then type text else type number}),
    Typed = Table.TransformColumnTypes(Rows, Types),
    WithPeriodStart = Table.AddColumn(Typed, "period_start", each Date.FromText(Source[from]), type date),
    WithPeriodEnd = Table.AddColumn(WithPeriodStart, "period_end", each Date.FromText(Source[to]), type date),
    WithSnapshot = Table.AddColumn(WithPeriodEnd, "snapshot_at", each DateTimeZone.FromText(Source[generatedAt]), type datetimezone),
    WithScope = Table.AddColumn(WithSnapshot, "measurement_scope", each Dataset[scope], type text)
in
    WithScope
`;
  await audit(
    db,
    req.user,
    "bi_query_downloaded",
    "reports",
    undefined,
    undefined,
    `${view}/${table}`,
  );
  res
    .attachment(`VS-PartnerHub-${view}-${table}-PowerQuery.m`)
    .type("text/plain")
    .send(source);
});
