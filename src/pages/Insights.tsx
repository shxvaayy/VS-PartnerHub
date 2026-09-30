import { Link } from "react-router-dom";
import { useState } from "react";
import {
  ArrowUpRight,
  CalendarClock,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, Tooltip } from "recharts";
import { useApi } from "../lib/api";
import {
  Badge,
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
} from "../components/ui";
import { formatDate } from "../lib/format";
import { operationalAlertLabels, type OperationalAlert } from "../../shared/ai";
import { useAuth } from "../lib/auth";

export default function Insights() {
  const { user } = useAuth();
  const [category, setCategory] = useState("");
  const insights = useApi<any>("/insights"),
    performance = useApi<any>("/insights/performance");
  if (insights.isPending) return <Loading />;
  if (insights.error)
    return <ErrorState error={insights.error} retry={insights.refetch} />;
  const alerts: OperationalAlert[] = insights.data.alerts.filter(
    (alert: OperationalAlert) => !category || alert.category === category,
  );
  return (
    <>
      <PageHeader
        eyebrow="PLAN THE NEXT STEP"
        title="Operational outlook"
        description="Expiry, aging, delivery and response trends, with evidence for the next decision."
      >
        {user?.permissions.ai?.includes("create") && (
          <Link to="/app/ai?mode=alerts" className="button button-primary">
            <Sparkles size={16} />
            Explain with VS AI
          </Link>
        )}
        <Link to="/app/reports" className="button button-secondary">
          Open reports <ArrowUpRight size={16} />
        </Link>
      </PageHeader>
      <div className="card operations-panel">
        <div className="operations-heading">
          <div>
            <h2>
              <CalendarClock size={19} /> Commitments needing attention
            </h2>
            <p>
              As of {formatDate(insights.data.asOf)}. Inspect the evidence
              before taking action.
            </p>
          </div>
          <select
            className="compact-select"
            aria-label="Operational alert category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">All signals ({insights.data.totalAlerts})</option>
            {Object.entries(operationalAlertLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label} ({insights.data.categoryCounts[key] || 0})
              </option>
            ))}
          </select>
        </div>
        {alerts.length ? (
          <div className="operational-alerts operational-signals">
            {alerts.map((alert) => (
              <article key={alert.id}>
                <Badge
                  status={
                    alert.severity === "attention"
                      ? "under_review"
                      : alert.severity
                  }
                >
                  {alert.severity === "urgent"
                    ? "Action overdue"
                    : alert.severity === "attention"
                      ? "Review signal"
                      : "Due soon"}
                </Badge>
                <div>
                  <span className="signal-category">
                    {operationalAlertLabels[alert.category]}
                  </span>
                  <Link to={alert.href}>
                    <strong>{alert.title}</strong>
                    <ArrowUpRight size={15} />
                  </Link>
                  <p>{alert.description}</p>
                  <details>
                    <summary>Evidence & method</summary>
                    <p>{alert.evidence}</p>
                  </details>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title={
              category
                ? "No signals in this category"
                : "No immediate commitments to show"
            }
            description="Signals appear when recorded dates or activity meet the stated thresholds. A lack of qualifying history is shown without a prediction."
          />
        )}
        <p className="small-note">{insights.data.scope}</p>
        <p className="small-note">{insights.data.method}</p>
        {insights.data.limited && (
          <p className="signal-limit">
            A source limit was reached. Open the underlying reports to review
            the remaining records.
          </p>
        )}
      </div>
      <div className="card space-top">
        <div className="operations-heading operations-panel">
          <div>
            <h2>Partner response trends</h2>
            <p>
              RFQs whose deadlines passed in the last 30 completed days,
              compared with the preceding 30 days.
            </p>
          </div>
        </div>
        {insights.data.responseTrends?.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Partner</th>
                  <th>Previous period</th>
                  <th>Recent period</th>
                  <th>Median response time</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {insights.data.responseTrends.map((trend: any) => (
                  <tr key={trend.organizationId}>
                    <td>
                      <strong>{trend.partner}</strong>
                    </td>
                    <td>
                      {trend.previous.onTimeRate === null
                        ? "—"
                        : `${trend.previous.onTimeRate}% on time`}
                      <small className="table-subtext">
                        {trend.previous.responses} responses /{" "}
                        {trend.previous.invitations} invitations
                      </small>
                    </td>
                    <td>
                      {trend.recent.onTimeRate === null
                        ? "—"
                        : `${trend.recent.onTimeRate}% on time`}
                      <small className="table-subtext">
                        {trend.recent.responses} responses /{" "}
                        {trend.recent.invitations} invitations
                      </small>
                    </td>
                    <td>
                      {trend.recent.medianResponseHours === null
                        ? "—"
                        : `${trend.recent.medianResponseHours} hours`}
                      <small className="table-subtext">
                        Previous:{" "}
                        {trend.previous.medianResponseHours === null
                          ? "—"
                          : `${trend.previous.medianResponseHours} hours`}
                      </small>
                    </td>
                    <td>
                      <details>
                        <summary>
                          {trend.available
                            ? "View method"
                            : "More history needed"}
                        </summary>
                        <p className="trend-method">{trend.reason}</p>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="Response trends need completed RFQ periods"
            description="Invitations, response deadlines and actual submission timestamps provide the evidence for comparison."
          />
        )}
      </div>
      <div className="operations-heading space-top">
        <div>
          <h2>
            <TrendingUp size={20} /> Activity planning for the next 28 days
          </h2>
          <p>
            Forecasts are calculated from your recorded activity and include
            their evidence and method.
          </p>
        </div>
      </div>
      <div className="forecast-grid">
        {insights.data.forecasts.map((f: any) => (
          <article className="card forecast-card" key={f.kind}>
            <h3>{f.label}</h3>
            {f.available ? (
              <>
                <strong>{f.next28Days}</strong>
                <p>
                  Estimated new records · Planning range {f.lower}–{f.upper}
                </p>
              </>
            ) : (
              <>
                <strong>—</strong>
                <p>{f.reason}</p>
              </>
            )}
            <div
              style={{ width: "100%", height: 95 }}
              role="img"
              aria-label={`${f.label} observed weekly activity: ${f.observations.map((o: any) => o.count).join(", ")}`}
            >
              <ResponsiveContainer>
                <BarChart data={f.observations}>
                  <XAxis dataKey="week" hide />
                  <Tooltip labelFormatter={(v) => `Week of ${v}`} />
                  <Bar
                    dataKey="count"
                    name="Records"
                    fill="#7e9e64"
                    radius={[3, 3, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="small-note">
              {f.sampleSize} records in the observation period.
            </p>
            {f.available && (
              <details className="forecast-method">
                <summary>How this is estimated</summary>
                <p>{f.method}</p>
              </details>
            )}
            <Link className="text-link space-top" to={`/app/${f.kind}`}>
              View records <ArrowUpRight size={14} />
            </Link>
          </article>
        ))}
      </div>
      <div className="card space-top">
        <div className="operations-heading operations-panel">
          <div>
            <h2>Partner performance</h2>
            <p>
              Commercial delivery and review evidence, scoped to your workspace.
            </p>
          </div>
        </div>
        {performance.error ? (
          <ErrorState error={performance.error} retry={performance.refetch} />
        ) : performance.isPending ? (
          <Loading />
        ) : performance.data.items.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Partner</th>
                  <th>Orders</th>
                  <th>Completed</th>
                  <th>Open</th>
                  <th>On-time deliveries</th>
                  <th>Published rating</th>
                </tr>
              </thead>
              <tbody>
                {performance.data.items.map((p: any) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.legal_name}</strong>
                    </td>
                    <td>{p.totalOrders}</td>
                    <td>{p.completedOrders}</td>
                    <td>{p.openOrders}</td>
                    <td>
                      {p.onTimeRate === null ? "—" : `${p.onTimeRate}%`}
                      <small className="table-subtext">
                        {p.onTimeDeliveries}/{p.onTimeSamples} eligible
                        deliveries
                      </small>
                    </td>
                    <td>
                      {p.rating === null ? "—" : `${p.rating}/5`}
                      <small className="table-subtext">
                        {p.reviews} reviews
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="Performance follows the work"
            description="Completed orders, confirmed deliveries and published partner reviews provide the evidence for this view."
          />
        )}
        <p className="small-note operations-panel">
          {performance.data?.method}
        </p>
      </div>
    </>
  );
}
