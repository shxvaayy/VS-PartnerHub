import { db, now, parseJson } from "./db.js";
import { can } from "./security.js";
import { scopeRecords, isBuyer, serializeRecord } from "./record-service.js";
import { documentPolicies } from "./master-data.js";
import {
  modules,
  moduleDefinitions,
  type Module,
  type SessionUser,
} from "../shared/domain.js";
import type {
  OperationalAlert,
  InsightSource,
  AlertCategory,
} from "../shared/ai.js";

const DAY = 86400000;
const recordSource = (r: any): InsightSource => ({
  id: r.id,
  type: "record",
  title: `${r.number} · ${r.title}`,
  href: `/app/${r.kind}/${r.id}`,
});
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b),
    half = Math.floor(sorted.length / 2);
  return sorted.length
    ? sorted.length % 2
      ? sorted[half]
      : (sorted[half - 1] + sorted[half]) / 2
    : null;
};
function daysUntil(date: string | undefined, today: string) {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return null;
  const days = Math.ceil(
    (Date.parse(date.slice(0, 10)) - Date.parse(today)) / DAY,
  );
  return Number.isFinite(days) ? days : null;
}
const dueText = (days: number) =>
  days < 0
    ? `${Math.abs(days)} days overdue`
    : days === 0
      ? "due today"
      : `due in ${days} days`;
type TrendPeriod = {
  invitations: number;
  responses: number;
  onTimeResponses: number;
  onTimeRate: number | null;
  medianResponseHours: number | null;
  missingTimestamps: number;
};
export interface ResponseTrend {
  organizationId: string;
  partner: string;
  recent: TrendPeriod;
  previous: TrendPeriod;
  available: boolean;
  reason: string;
  sources: InsightSource[];
}

async function responseTrends(
  user: SessionUser,
  today: string,
): Promise<{ items: ResponseTrend[]; limited: boolean }> {
  if (!can(user, "rfqs") || !can(user, "quotations"))
    return { items: [], limited: false };
  const end = Date.parse(today),
    start = end - 60 * DAY,
    midpoint = end - 30 * DAY;
  const rows: any[] = await scopeRecords(
    db("records").where({ kind: "rfqs" }).whereNot("status", "draft"),
    user,
  )
    .orderBy("updated_at", "desc")
    .limit(10001);
  const limited = rows.length > 10000;
  const rfqs = rows.slice(0, 10000).filter((row) => {
    const deadline = Date.parse(parseJson(row.payload).deadline);
    return deadline >= start && deadline < end;
  });
  if (!rfqs.length) return { items: [], limited };
  const ids = rfqs.map((r) => r.id),
    allowed = new Map(rfqs.map((r) => [r.id, r]));
  const invitations = await db("record_invitations").whereIn("record_id", ids);
  const visible = invitations.filter((invite) => {
    const rfq = allowed.get(invite.record_id)!;
    return (
      isBuyer(user, serializeRecord(rfq)) ||
      invite.organization_id === user.organization_id
    );
  });
  const quotes: any[] = await scopeRecords(
    db("records")
      .where({ kind: "quotations" })
      .whereIn("parent_id", ids)
      .whereNot("status", "draft"),
    user,
  );
  const events = quotes.length
    ? await db("audit_logs")
        .whereIn(
          "record_id",
          quotes.map((q) => q.id),
        )
        .where({ module: "quotations", new_status: "submitted" })
        .select("record_id", "created_at")
        .orderBy("created_at")
    : [];
  const firstSubmitted = new Map<string, string>();
  for (const event of events)
    if (!firstSubmitted.has(event.record_id))
      firstSubmitted.set(event.record_id, event.created_at);
  const published = await db("audit_logs")
    .whereIn("record_id", ids)
    .where({ module: "rfqs", new_status: "published" })
    .select("record_id", "created_at")
    .orderBy("created_at");
  const firstPublished = new Map<string, string>();
  for (const event of published)
    if (!firstPublished.has(event.record_id))
      firstPublished.set(event.record_id, event.created_at);
  const quoteMap = new Map(
    quotes.map((q) => [`${q.parent_id}:${q.partner_org_id}`, q]),
  );
  const partners = [...new Set(visible.map((i) => i.organization_id))];
  const organizations = partners.length
    ? await db("organizations")
        .whereIn("id", partners)
        .select("id", "legal_name")
    : [];
  const items: ResponseTrend[] = [];
  for (const organization of organizations) {
    const related = visible.filter(
      (i) => i.organization_id === organization.id,
    );
    const period = (recent: boolean): TrendPeriod => {
      const cohort = related.filter(
        (i) =>
          Date.parse(parseJson(allowed.get(i.record_id)!.payload).deadline) >=
            midpoint ===
          recent,
      );
      let responses = 0,
        onTimeResponses = 0,
        missingTimestamps = 0;
      const hours: number[] = [];
      for (const invitation of cohort) {
        const rfq = allowed.get(invitation.record_id)!,
          quote = quoteMap.get(`${rfq.id}:${organization.id}`);
        if (!quote) continue;
        responses++;
        const submitted = firstSubmitted.get(quote.id),
          issued = firstPublished.get(rfq.id);
        if (!submitted) {
          missingTimestamps++;
          continue;
        }
        if (submitted.slice(0, 10) <= parseJson(rfq.payload).deadline)
          onTimeResponses++;
        if (issued && Date.parse(submitted) >= Date.parse(issued))
          hours.push((Date.parse(submitted) - Date.parse(issued)) / 3600000);
      }
      return {
        invitations: cohort.length,
        responses,
        onTimeResponses,
        onTimeRate:
          cohort.length && !missingTimestamps
            ? Math.round((onTimeResponses / cohort.length) * 100)
            : null,
        medianResponseHours: hours.length
          ? Math.round(median(hours)! * 10) / 10
          : null,
        missingTimestamps,
      };
    };
    const recent = period(true),
      previous = period(false);
    const available =
      !limited &&
      recent.invitations >= 5 &&
      previous.invitations >= 5 &&
      recent.onTimeRate !== null &&
      previous.onTimeRate !== null;
    items.push({
      organizationId: organization.id,
      partner: organization.legal_name,
      recent,
      previous,
      available,
      reason: limited
        ? "The source limit was reached; narrow the source period before drawing a trend conclusion."
        : available
          ? "Compares RFQs whose deadlines passed in the last 30 completed days with the preceding 30 days. On-time means the first recorded submission was no later than the deadline."
          : "A trend needs five invitations in each 30-day period and complete submission timestamps for received responses.",
      sources: [
        ...new Map(
          related.map((i) => {
            const source = recordSource(allowed.get(i.record_id));
            return [source.id, source];
          }),
        ).values(),
      ],
    });
  }
  return { items, limited };
}

export async function operationalOutlook(user: SessionUser) {
  const permitted = modules.filter((kind) => can(user, kind)),
    today = now().slice(0, 10),
    todayAt = Date.parse(today);
  const historyStart = todayAt - 63 * DAY,
    forecastStart = todayAt - 56 * DAY;
  const historyRows: any[] = await scopeRecords(
    db("records")
      .whereIn("kind", permitted)
      .where("created_at", ">=", new Date(historyStart).toISOString())
      .where("created_at", "<", today),
    user,
  )
    .select(
      "id",
      "kind",
      "number",
      "title",
      "status",
      "currency",
      "amount_minor",
      "created_at",
      "partner_org_id",
    )
    .orderBy("created_at")
    .limit(50001);
  const historyLimited = historyRows.length > 50000,
    history = historyRows.slice(0, 50000);
  const forecastKinds: Module[] = [
    "requirements",
    "rfqs",
    "quotations",
    "orders",
    "invoices",
    "candidates",
  ];
  const forecasts = forecastKinds
    .filter((k) => permitted.includes(k))
    .map((kind) => {
      const events = history.filter(
        (row) =>
          row.kind === kind && Date.parse(row.created_at) >= forecastStart,
      );
      const observations = Array.from({ length: 8 }, (_, index) => ({
        week: new Date(forecastStart + index * 7 * DAY)
          .toISOString()
          .slice(0, 10),
        count: events.filter(
          (row) =>
            Date.parse(row.created_at) >= forecastStart + index * 7 * DAY &&
            Date.parse(row.created_at) < forecastStart + (index + 1) * 7 * DAY,
        ).length,
      }));
      const counts = observations.map((o) => o.count),
        total = counts.reduce((a, b) => a + b, 0),
        activeWeeks = counts.filter((n) => n > 0).length;
      if (total < 12 || activeWeeks < 4 || historyLimited)
        return {
          kind,
          label: moduleDefinitions[kind].label,
          available: false,
          observations,
          sampleSize: total,
          reason: historyLimited
            ? "Source history exceeds the calculation limit; no forecast is produced from an incomplete sample."
            : "A forecast needs at least 12 records across four active weeks in the last eight completed weeks.",
        };
      const weights = [1, 1, 1, 1, 2, 2, 3, 3],
        weight = weights.reduce((a, b) => a + b, 0),
        weekly =
          counts.reduce((sum, count, i) => sum + count * weights[i], 0) /
          weight;
      const deviation = Math.sqrt(
          counts.reduce((sum, count) => sum + (count - weekly) ** 2, 0) /
            counts.length,
        ),
        estimate = Math.round(weekly * 4),
        margin = Math.ceil(deviation * 4);
      return {
        kind,
        label: moduleDefinitions[kind].label,
        available: true,
        observations,
        sampleSize: total,
        next28Days: estimate,
        lower: Math.max(0, estimate - margin),
        upper: estimate + margin,
        method:
          "Eight completed seven-day periods; a weighted weekly average gives more weight to recent activity. The planning range uses observed variation. It is not a guarantee or a statistical confidence interval.",
      };
    });
  const rows: any[] = await scopeRecords(
    db("records")
      .whereIn("kind", permitted)
      .whereNotIn("status", [
        "draft",
        "closed",
        "paid",
        "completed",
        "failed",
        "rejected",
        "terminated",
        "archived",
        "joined",
        "fulfilled",
        "confirmed",
      ]),
    user,
  )
    .orderBy("updated_at", "desc")
    .limit(20001);
  const active = rows.slice(0, 20000),
    alerts: OperationalAlert[] = [];
  const add = (
    r: any,
    category: AlertCategory,
    due: string,
    description: string,
    evidence: string,
    severity: OperationalAlert["severity"],
    key: string,
  ) =>
    alerts.push({
      id: `${category}:${r.id}`,
      category,
      title: `${r.number} · ${r.title}`,
      description,
      evidence,
      href: `/app/${r.kind}/${r.id}`,
      due,
      severity,
      sources: [recordSource(r)],
      notificationKey: `${category}:${r.id}:${key}`,
    });
  const invoiceIds = active
    .filter((r) => r.kind === "invoices")
    .map((r) => r.id);
  const paidRows: any[] = invoiceIds.length
    ? await db("records")
        .where({ kind: "payments", status: "completed" })
        .whereIn("parent_id", invoiceIds)
        .select("parent_id")
        .sum({ paid: "amount_minor" })
        .groupBy("parent_id")
    : [];
  const paid = new Map(paidRows.map((r) => [r.parent_id, Number(r.paid)]));
  const hiring = active.filter(
    (r) =>
      r.kind === "requirements" &&
      r.status === "open" &&
      parseJson(r.payload).requirement_type === "hiring",
  );
  const opened = hiring.length
    ? await db("audit_logs")
        .whereIn(
          "record_id",
          hiring.map((r) => r.id),
        )
        .where({ module: "requirements", new_status: "open" })
        .select("record_id", "created_at")
        .orderBy("created_at", "desc")
    : [];
  const openedAt = new Map<string, string>();
  for (const event of opened)
    if (!openedAt.has(event.record_id))
      openedAt.set(event.record_id, event.created_at);
  for (const r of active) {
    const p = parseJson(r.payload);
    if (
      r.kind === "contracts" &&
      ["active", "renewed", "expired"].includes(r.status)
    ) {
      const days = daysUntil(p.end_date, today);
      if (days !== null && days <= (p.renewal_notice_days || 30))
        add(
          r,
          "contract_expiry",
          p.end_date,
          `Contract renewal ${dueText(days)}. Review notice periods and any amendment before extending the agreement.`,
          `Contract end date ${p.end_date}; renewal notice ${p.renewal_notice_days || 30} days; current status ${r.status}.`,
          days < 0 ? "urgent" : "pending",
          `${p.end_date}:${days < 0 ? "expired" : "notice"}`,
        );
    } else if (r.kind === "invoices") {
      const days = daysUntil(p.due_date, today),
        outstanding = Math.max(
          0,
          Number(r.amount_minor) - (paid.get(r.id) || 0),
        );
      if (days !== null && days <= 7 && outstanding > 0) {
        const aging =
          days < -90
            ? "90+ days"
            : days < -60
              ? "61–90 days"
              : days < -30
                ? "31–60 days"
                : days < 0
                  ? "1–30 days"
                  : "due soon";
        add(
          r,
          "invoice_aging",
          p.due_date,
          `Invoice ${dueText(days)}. Outstanding ${r.currency} ${(outstanding / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}; aging: ${aging}.`,
          `Only completed payments reduce the recorded outstanding amount. Invoice status: ${r.status.replaceAll("_", " ")}.`,
          days < 0 ? "urgent" : "pending",
          `${p.due_date}:${aging}`,
        );
      }
    } else if (
      (r.kind === "orders" &&
        ["sent", "acknowledged", "approved"].includes(r.status)) ||
      (r.kind === "deliveries" &&
        ["pending", "dispatched", "in_transit", "delivered"].includes(r.status))
    ) {
      const due = r.kind === "orders" ? p.delivery_date : p.expected_date,
        days = daysUntil(due, today);
      if (days !== null && days <= 7)
        add(
          r,
          "delayed_delivery",
          due,
          `${r.kind === "deliveries" && r.status === "delivered" ? "Buyer confirmation pending for delivery" : "Delivery commitment"} ${dueText(days)}. Check the shipment and acknowledgement before following up.`,
          `Recorded delivery date ${due}; current status ${r.status.replaceAll("_", " ")}.`,
          days < 0 ? "urgent" : "pending",
          `${due}:${days < 0 ? "overdue" : "soon"}`,
        );
    } else if (
      r.kind === "requirements" &&
      r.status === "open" &&
      p.requirement_type === "hiring"
    ) {
      const since = (openedAt.get(r.id) || r.created_at).slice(0, 10),
        days = daysUntil(since, today);
      if (days !== null && days <= -30)
        add(
          r,
          "recruitment_aging",
          since,
          `Hiring requirement has remained open for ${-days} days. Review assigned partners, candidate progress and the target joining date.`,
          `${openedAt.has(r.id) ? "Latest opening" : "Creation"} date ${since}; ${p.positions || "unspecified"} requested positions. No candidate suitability or hiring decision is inferred.`,
          days <= -60 ? "urgent" : "attention",
          `${since}:${Math.floor(-days / 30)}`,
        );
    } else if (
      r.kind === "rfqs" &&
      ["published", "evaluation"].includes(r.status)
    ) {
      const days = daysUntil(p.deadline, today);
      if (days !== null && days <= 7)
        add(
          r,
          "rfq_deadline",
          p.deadline,
          `RFQ response deadline ${dueText(days)}. Review responses and any clarification requests.`,
          `Response deadline ${p.deadline}; current status ${r.status}.`,
          days < 0 ? "urgent" : "pending",
          `${p.deadline}:${days < 0 ? "overdue" : "soon"}`,
        );
    } else if (
      r.kind === "milestones" ||
      (r.kind === "candidates" && r.status === "onboarding")
    ) {
      const due = r.kind === "candidates" ? p.joining_date : p.due_date,
        days = daysUntil(due, today);
      if (days !== null && days <= 7)
        add(
          r,
          "milestone",
          due,
          `${r.kind === "candidates" ? "Expected joining" : "Service milestone"} ${dueText(days)}. Confirm the next step with the responsible team.`,
          `Scheduled date ${due}; current status ${r.status.replaceAll("_", " ")}.`,
          days < 0 ? "urgent" : "pending",
          `${due}:${days < 0 ? "overdue" : "soon"}`,
        );
    }
  }
  let documentsLimited = false;
  if (can(user, "documents")) {
    const query = db("documents as d")
      .join("organizations as o", "o.id", "d.organization_id")
      .whereNull("d.record_id")
      .whereNotNull("d.expires_at")
      .whereNot("d.status", "rejected")
      .whereNotExists(
        db("documents as next").whereRaw("next.previous_id = d.id"),
      );
    if (!user.internal) query.where("d.organization_id", user.organization_id);
    const documents = await query
      .select(
        "d.id",
        "d.name",
        "d.category",
        "d.status",
        "d.expires_at",
        "o.type as organization_type",
      )
      .orderBy("d.expires_at")
      .limit(20001);
    documentsLimited = documents.length > 20000;
    const policies = new Map<
      string,
      Awaited<ReturnType<typeof documentPolicies>>
    >();
    for (const doc of documents.slice(0, 20000)) {
      if (!policies.has(doc.organization_type))
        policies.set(
          doc.organization_type,
          await documentPolicies(doc.organization_type),
        );
      const windows = policies
        .get(doc.organization_type)!
        .find((p) => p.category === doc.category)?.reminder_days || [
        90, 60, 30,
      ];
      const days = daysUntil(doc.expires_at, today),
        window =
          days === null
            ? undefined
            : [...windows, 0].sort((a, b) => a - b).find((w) => days <= w);
      if (days === null || window === undefined) continue;
      const source: InsightSource = {
        id: doc.id,
        type: "document",
        title: `${doc.category} · ${doc.name}`,
        href: `/app/documents?document=${doc.id}`,
      };
      alerts.push({
        id: `document_expiry:${doc.id}`,
        category: "document_expiry",
        title: source.title,
        description: `Document renewal ${dueText(days)}. Upload a new version and send it through VS verification.`,
        evidence: `Registered expiry ${doc.expires_at}; reminder window ${window} days; current status ${doc.status}.`,
        href: source.href,
        due: doc.expires_at,
        severity: days < 0 ? "urgent" : "pending",
        sources: [source],
        notificationKey: `document_expiry:${doc.id}:${window}`,
      });
    }
  }
  if (!historyLimited && can(user, "orders")) {
    const orders = history.filter(
        (r) =>
          r.kind === "orders" &&
          !["draft", "pending_approval", "rejected"].includes(r.status),
      ),
      split = todayAt - 7 * DAY;
    for (const currency of [...new Set(orders.map((r) => r.currency))]) {
      const baseline = orders.filter(
          (r) => r.currency === currency && Date.parse(r.created_at) < split,
        ),
        recent = orders.filter(
          (r) => r.currency === currency && Date.parse(r.created_at) >= split,
        );
      const weekly = Array.from(
        { length: 8 },
        (_, i) =>
          baseline.filter(
            (r) =>
              Date.parse(r.created_at) >= historyStart + i * 7 * DAY &&
              Date.parse(r.created_at) < historyStart + (i + 1) * 7 * DAY,
          ).length,
      );
      if (
        baseline.length < 12 ||
        weekly.filter((n) => n > 0).length < 4 ||
        !recent.length
      )
        continue;
      const average = baseline.length / 8,
        deviation = Math.sqrt(
          weekly.reduce((sum, n) => sum + (n - average) ** 2, 0) / 8,
        );
      if (
        recent.length >= 5 &&
        recent.length > average + Math.max(3, 2 * deviation)
      ) {
        const r = recent.at(-1)!;
        add(
          r,
          "unusual_procurement",
          today,
          `${currency} purchase-order volume is above its recent range: ${recent.length} orders in the last seven completed days versus ${average.toFixed(1)} per week in the prior eight weeks.`,
          `Baseline: ${baseline.length} approved/sent or later orders across ${weekly.filter((n) => n > 0).length} active weeks. Trigger: at least five recent orders and more than baseline mean + max(3, twice observed weekly variation). This is an operational review signal, not a fraud finding.`,
          "attention",
          `${currency}:${today}`,
        );
        alerts.at(-1)!.id = `unusual_procurement:volume:${currency}`;
        alerts.at(-1)!.sources = [...baseline, ...recent].map(recordSource);
      }
      const typical = median(baseline.map((r) => Number(r.amount_minor))) || 0;
      const high = recent
        .filter((r) => typical > 0 && Number(r.amount_minor) >= typical * 3)
        .sort((a, b) => Number(b.amount_minor) - Number(a.amount_minor))[0];
      if (high) {
        add(
          high,
          "unusual_procurement",
          high.created_at.slice(0, 10),
          `Order value is ${(Number(high.amount_minor) / typical).toFixed(1)} times the recent ${currency} median. Review quantities, scope and the approval trail.`,
          `Order ${currency} ${(Number(high.amount_minor) / 100).toFixed(2)}; median ${currency} ${(typical / 100).toFixed(2)} from ${baseline.length} earlier orders. Currencies are evaluated separately. No misconduct or pricing error is inferred.`,
          "attention",
          `${high.id}:${high.amount_minor}`,
        );
        alerts.at(-1)!.id = `unusual_procurement:value:${high.id}`;
        alerts.at(-1)!.sources = [...baseline, high].map(recordSource);
      }
    }
  }
  const trends = await responseTrends(user, today);
  for (const trend of trends.items) {
    if (
      !trend.available ||
      trend.previous.onTimeRate! - trend.recent.onTimeRate! < 20
    )
      continue;
    alerts.push({
      id: `vendor_response:${trend.organizationId}`,
      category: "vendor_response",
      title: `${trend.partner} · RFQ response trend`,
      description: `On-time response rate fell from ${trend.previous.onTimeRate}% to ${trend.recent.onTimeRate}% across the two completed 30-day periods. Check partner capacity and invitation fit.`,
      evidence: `${trend.previous.onTimeResponses}/${trend.previous.invitations} on-time responses previously; ${trend.recent.onTimeResponses}/${trend.recent.invitations} recently. Both periods contain at least five invitations.`,
      href: "/app/rfqs",
      due: today,
      severity: "attention",
      sources: trend.sources,
      notificationKey: `vendor_response:${trend.organizationId}:${today.slice(0, 7)}`,
    });
  }
  const severityOrder = { urgent: 0, attention: 1, pending: 2 };
  alerts.sort(
    (a, b) =>
      severityOrder[a.severity] - severityOrder[b.severity] ||
      a.due.localeCompare(b.due),
  );
  const categoryCounts = Object.fromEntries(
    [...new Set(alerts.map((a) => a.category))].map((category) => [
      category,
      alerts.filter((a) => a.category === category).length,
    ]),
  );
  return {
    asOf: now(),
    forecasts,
    alerts: alerts.slice(0, 100),
    totalAlerts: alerts.length,
    categoryCounts,
    responseTrends: trends.items.map(({ sources, ...trend }) => trend),
    scope: `Your role and organization permissions apply. Displays ${Math.min(100, alerts.length)} of ${alerts.length} calculated alerts. Scans at most 20,000 open records, 20,000 current company documents, 50,000 historical records and 10,000 RFQs.`,
    limited:
      rows.length > 20000 ||
      documentsLimited ||
      historyLimited ||
      trends.limited,
    method:
      "Date alerts use recorded commitments and configured expiry windows. Aging thresholds, statistical activity signals and response-rate changes are calculated from actual records. VS AI can explain these signals on request; it does not invent scores or take decisions.",
  };
}
