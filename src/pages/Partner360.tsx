import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  CalendarClock,
  CircleDollarSign,
  FileCheck2,
  Fingerprint,
  GitCompareArrows,
  MapPin,
  ShieldCheck,
  Star,
  Truck,
} from "lucide-react";
import { useApi, queryString } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatDate, formatTime, money } from "../lib/format";
import {
  label,
  moduleDefinitions,
  organizationLabels,
  type Module,
  type WorkRecord,
} from "../../shared/domain";
import {
  Avatar,
  BackLink,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Loading,
  PageHeader,
} from "../components/ui";
import ScrollRegion from "../components/ScrollRegion";

export default function Partner360() {
  const { id } = useParams(),
    [params, setParams] = useSearchParams(),
    { user } = useAuth();
  const [selectedCurrency, setCurrency] = useState("");
  const query = useApi<any>(
    `/organizations/${id}/360?${queryString({ from: params.get("from"), to: params.get("to") })}`,
  );
  if (query.isPending) return <Loading />;
  if (query.error)
    return <ErrorState error={query.error} retry={() => query.refetch()} />;
  const data = query.data,
    org = data.organization,
    financial =
      data.finances.find((f: any) => f.currency === selectedCurrency) ||
      data.finances[0];
  const currency = financial?.currency || "INR",
    compliance = data.compliance;
  const has = (module: string) => user!.permissions[module]?.includes("view");
  const setDate = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    setParams(next);
  };
  const drill = (module: string, extra: Record<string, string> = {}) =>
    `/app/${module}?${queryString({ organization_id: id, from: params.get("from"), to: params.get("to"), ...extra })}`;
  const moduleEntries = (
    Object.entries(data.module_counts) as [Module, number][]
  ).filter(([module]) => module !== "catalog");
  const largest = Math.max(1, ...moduleEntries.map(([, count]) => count));
  return (
    <div className="proc-workspace">
      <BackLink to={`/app/organizations/${id}`}>Company profile</BackLink>
      <PageHeader
        eyebrow="RELATIONSHIP INTELLIGENCE"
        title="Partner 360°"
        description="One connected view of the relationship, its commitments and the next actions."
      >
        <Link
          className="button button-secondary"
          to={`/app/organizations/${id}`}
        >
          Full profile <ArrowUpRight size={16} />
        </Link>
        {user!.permissions.rfqs?.includes("create") &&
          (user!.internal || user!.organization?.type === "client") &&
          org.type !== "client" &&
          !data.own &&
          org.status === "active" && (
            <Link
              className="button button-primary"
              to={`/app/rfqs?new=true&invite=${id}`}
            >
              Create RFQ / RFP <ArrowRight size={16} />
            </Link>
          )}
      </PageHeader>
      <section className="proc-partner-hero">
        <div className="proc-partner-identity">
          {org.logo_url ? (
            <img
              className="proc-org-logo"
              src={org.logo_url}
              alt={`${org.legal_name} logo`}
            />
          ) : (
            <Avatar name={org.legal_name} size="lg" />
          )}
          <div>
            <span className="proc-hero-kicker">
              <Fingerprint size={14} /> {org.number} ·{" "}
              {organizationLabels[org.type as keyof typeof organizationLabels]}
            </span>
            <h2>{org.trade_name || org.legal_name}</h2>
            <p>{org.legal_name}</p>
            <div className="proc-partner-meta">
              <span>
                <Building2 size={14} />
                {org.industry}
              </span>
              <span>
                <MapPin size={14} />
                {org.city}, {org.country}
              </span>
            </div>
          </div>
        </div>
        <div className="proc-partner-status">
          <Badge status={org.status} />
          <span>Partner since {formatDate(org.created_at)}</span>
          <small>{data.scope}</small>
        </div>
      </section>
      <div className="proc-filterbar">
        <div>
          <strong>Relationship overview</strong>
          <p>
            Activity by creation date. Invoice balances include subsequent
            payments.
          </p>
        </div>
        <div className="proc-filter-inputs">
          <Field label="From">
            <Input
              type="date"
              value={params.get("from") || ""}
              onChange={(e) => setDate("from", e.target.value)}
            />
          </Field>
          <Field label="To">
            <Input
              type="date"
              value={params.get("to") || ""}
              onChange={(e) => setDate("to", e.target.value)}
            />
          </Field>
          {data.finances.length > 0 && (
            <Field label="Currency">
              <select
                className="input"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {data.finances.map((f: any) => (
                  <option key={f.currency}>{f.currency}</option>
                ))}
              </select>
            </Field>
          )}
          {(params.get("from") || params.get("to")) && (
            <Button variant="ghost" onClick={() => setParams({})}>
              All time
            </Button>
          )}
        </div>
      </div>
      {financial ? (
        <div className="proc-kpi-grid">
          {[
            {
              title: "Agreed PO value",
              value: financial.order_minor,
              sub: `${data.module_counts.orders || 0} purchase orders`,
              Icon: FileCheck2,
              module: "orders",
            },
            {
              title: "Invoiced value",
              value: financial.invoice_minor,
              sub: "Submitted invoices, excluding rejections",
              Icon: CircleDollarSign,
              module: "invoices",
            },
            {
              title: "Outstanding",
              value: financial.outstanding_minor,
              sub:
                financial.paid_minor === null
                  ? "Payment access required"
                  : `${money(financial.paid_minor, currency)} paid`,
              Icon: GitCompareArrows,
              module: "invoices",
            },
            {
              title: "Overdue balance",
              value: financial.overdue_minor,
              sub: `${financial.overdue_count ?? "—"} overdue invoices`,
              Icon: CalendarClock,
              module: "invoices",
              danger: financial.overdue_minor > 0,
            },
          ].map((metric) => (
            <div
              className={`proc-kpi ${metric.danger ? "is-attention" : ""}`}
              key={metric.title}
            >
              <div>
                <span>{metric.title}</span>
                <metric.Icon size={19} />
              </div>
              <strong>
                {metric.value === null
                  ? "Restricted"
                  : money(metric.value, currency)}
              </strong>
              <span>{metric.sub}</span>
              {has(metric.module) && (
                <Link
                  to={drill(metric.module, { currency })}
                  aria-label={`View ${metric.title.toLowerCase()}`}
                >
                  <ArrowUpRight size={16} />
                </Link>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="card proc-empty-finance">
          <CircleDollarSign size={22} />
          <div>
            <strong>No commercial activity in this view</strong>
            <p>
              Authorized orders, invoices and payment balances will appear as
              the relationship progresses.
            </p>
          </div>
        </div>
      )}
      <div className="proc-360-grid">
        <section className="card proc-card">
          <div className="proc-panel-heading">
            <span className="proc-icon">
              <ShieldCheck size={21} />
            </span>
            <div>
              <h3>Verification & compliance</h3>
              <p>Current organization and document status</p>
            </div>
          </div>
          {compliance.private ? (
            <div className="proc-private-compliance">
              <Badge status={org.status} />
              <h4>
                {org.status === "active"
                  ? "Active partner account"
                  : label(org.status)}
              </h4>
              <p>
                Document details are available to the organization and its
                authorized verification team.
              </p>
            </div>
          ) : (
            <>
              <div className="proc-compliance-summary">
                <div className="proc-compliance-count">
                  <strong>
                    {compliance.approved}
                    <small> / {compliance.total}</small>
                  </strong>
                  <span>valid, approved documents</span>
                </div>
                <div>
                  <Badge
                    status={compliance.missing.length ? "pending" : "approved"}
                  >
                    {compliance.missing.length
                      ? `${compliance.missing.length} required categories need attention`
                      : "Required documents in place"}
                  </Badge>
                </div>
              </div>
              <div className="proc-expiry-buckets">
                {[
                  ["Expired", compliance.expired],
                  ["Within 30d", compliance.due30],
                  ["Within 60d", compliance.due60],
                  ["Within 90d", compliance.due90],
                ].map(([title, count]) => (
                  <div key={title}>
                    <strong>{count}</strong>
                    <span>{title}</span>
                  </div>
                ))}
              </div>
              {compliance.missing.length > 0 && (
                <p className="proc-alert-note">
                  Needs a valid approval: {compliance.missing.join(", ")}
                </p>
              )}
              <div className="proc-compact-list">
                {compliance.documents.map((doc: any) => (
                  <div key={doc.id}>
                    <FileCheck2 size={16} />
                    <div>
                      <strong>{doc.category}</strong>
                      <span>
                        {doc.expires_at
                          ? `Expires ${formatDate(doc.expires_at)}`
                          : "No expiry recorded"}
                      </span>
                    </div>
                    <Badge status={doc.status} />
                  </div>
                ))}
              </div>
              <Link
                className="text-link"
                to={`/app/documents?organization_id=${id}`}
              >
                Review document workspace <ArrowRight size={15} />
              </Link>
            </>
          )}
        </section>
        <section className="card proc-card">
          <div className="proc-panel-heading">
            <span className="proc-icon">
              <Star size={21} />
            </span>
            <div>
              <h3>Partner performance</h3>
              <p>
                {data.performance?.count || 0} published relationship reviews
              </p>
            </div>
          </div>
          {data.performance?.count ? (
            <>
              <div className="proc-performance-bars">
                {Object.entries(data.performance.scores).map(([key, value]) => (
                  <div key={key}>
                    <div>
                      <span>{label(key)}</span>
                      <strong>
                        {String(value)}
                        <small> / 5</small>
                      </strong>
                    </div>
                    <div className="proc-meter">
                      <span
                        style={{ width: `${(Number(value) / 5) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="proc-review-note">
                <p>“{data.performance.recent[0].feedback}”</p>
                <span>
                  {data.performance.recent[0].number} ·{" "}
                  {formatDate(data.performance.recent[0].date)}
                </span>
              </div>
              <Link className="text-link" to={drill("performance")}>
                View performance reviews <ArrowRight size={15} />
              </Link>
            </>
          ) : (
            <EmptyState
              title="Performance builds with experience"
              description={
                data.performance
                  ? "Publish a review against a delivered order or active contract to start the scorecard."
                  : "Performance reviews are outside your current role's access."
              }
            />
          )}
          <div className="proc-operational-signals">
            {has("orders") && (
              <Link to={drill("orders")}>
                <FileCheck2 size={17} />
                <span>Open orders</span>
                <strong>{data.alerts.open_orders}</strong>
                <ArrowUpRight size={14} />
              </Link>
            )}
            {has("deliveries") && (
              <Link to={drill("deliveries")}>
                <Truck size={17} />
                <span>Delayed deliveries</span>
                <strong>{data.alerts.late_deliveries}</strong>
                <ArrowUpRight size={14} />
              </Link>
            )}
            {has("contracts") && (
              <Link to={drill("contracts")}>
                <CalendarClock size={17} />
                <span>Contracts expiring within 30 days</span>
                <strong>{data.alerts.contracts_expiring}</strong>
                <ArrowUpRight size={14} />
              </Link>
            )}
          </div>
        </section>
        <section className="card proc-card proc-full-width">
          <div className="proc-panel-heading">
            <span className="proc-icon">
              <GitCompareArrows size={21} />
            </span>
            <div>
              <h3>Connected business activity</h3>
              <p>Open a module to inspect the records behind these counts.</p>
            </div>
          </div>
          <div className="proc-module-grid">
            {moduleEntries.map(([module, count]) => (
              <Link to={drill(module)} key={module}>
                <div>
                  <span>{moduleDefinitions[module].label}</span>
                  <strong>{count}</strong>
                </div>
                <div className="proc-meter">
                  <span style={{ width: `${(count / largest) * 100}%` }} />
                </div>
              </Link>
            ))}
          </div>
        </section>
        <section className="card proc-full-width">
          <div className="proc-card-heading">
            <div>
              <h3>Recent relationship activity</h3>
              <p>
                Latest {data.activity.length} records, ordered by their last
                update
              </p>
            </div>
            <span className="proc-live-mark">
              <span /> From authorized platform records
            </span>
          </div>
          {data.activity.length ? (
            <ScrollRegion
              className="table-scroll"
              label="Recent partner activity"
            >
              <table className="data-table proc-activity-table">
                <thead>
                  <tr>
                    <th>Record</th>
                    <th>Module</th>
                    <th>Status</th>
                    <th>Value</th>
                    <th>Last updated</th>
                    <th>
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.activity.map((record: WorkRecord) => (
                    <tr key={record.id}>
                      <td>
                        <Link
                          className="record-title"
                          to={`/app/${record.kind}/${record.id}`}
                        >
                          {record.title}
                        </Link>
                        <small className="proc-subtext">{record.number}</small>
                      </td>
                      <td>{moduleDefinitions[record.kind].singular}</td>
                      <td>
                        <Badge status={record.status} />
                      </td>
                      <td className="amount-cell">
                        {record.amount_minor > 0
                          ? money(record.amount_minor, record.currency)
                          : "—"}
                      </td>
                      <td className="nowrap subtle">
                        {formatDate(record.updated_at)}
                      </td>
                      <td>
                        <Link
                          className="icon-button"
                          to={`/app/${record.kind}/${record.id}`}
                          aria-label={`Open ${record.number}`}
                        >
                          <ArrowUpRight size={16} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          ) : (
            <EmptyState
              title="Your relationship starts here"
              description="Shared RFQs, transactions and operational records will appear as you collaborate."
            />
          )}
        </section>
      </div>
      <p className="proc-footnote">
        Updated {formatTime(data.generated_at)} · {data.scope}. Currency totals
        are shown separately.
      </p>
    </div>
  );
}
