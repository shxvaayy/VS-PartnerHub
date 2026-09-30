import { useEffect, useId, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Database,
  FileSpreadsheet,
  Headphones,
  LayoutDashboard,
  PlugZap,
  Printer,
  RefreshCw,
  ShieldCheck,
  ShoppingCart,
  TrendingUp,
  UsersRound,
  Wallet,
} from "lucide-react";
import { useApi, ApiError, queryString } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  Input,
  Loading,
  Modal,
  PageHeader,
  Pagination,
  SearchInput,
  useToast,
} from "../components/ui";
import { dateInput, formatDate, formatTime, money } from "../lib/format";
import {
  label,
  moduleDefinitions,
  organizationLabels,
  type Module,
  type OrganizationType,
} from "../../shared/domain";
import type {
  AnalyticsReport,
  ReportCell,
  ReportFormat,
  ReportMetric,
  ReportTable,
  ReportView,
  ReportViewId,
} from "../../shared/analytics";
import "../reports.css";

const icons = {
  executive: LayoutDashboard,
  partners: Building2,
  procurement: ShoppingCart,
  performance: TrendingUp,
  recruitment: UsersRound,
  finance: Wallet,
  compliance: ShieldCheck,
  support: Headphones,
};
const captions = {
  executive: "The complete picture",
  partners: "Growth & verification",
  procurement: "Sourcing & commitments",
  performance: "Delivery & response",
  recruitment: "Hiring & joining",
  finance: "Billing & balances",
  compliance: "Documents & renewals",
  support: "Service & resolution",
};
const number = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
function display(
  value: ReportCell | undefined,
  format: ReportFormat,
  currency: string,
) {
  if (value === null || value === undefined || value === "") return "—";
  if (format === "text") return String(value);
  if (format === "money") return money(Number(value), currency);
  if (format === "percent") return `${number.format(Number(value))}%`;
  return number.format(Number(value));
}
const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-IN", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
const scopeLabel = (scope: string) =>
  scope === "current"
    ? "Current snapshot"
    : scope === "period"
      ? "Selected period"
      : "Scope shown per KPI";

export default function Reports() {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("print");
    const change = () => setPrinting(media.matches);
    const prepare = () => flushSync(() => setPrinting(true));
    const finish = () => setPrinting(false);
    media.addEventListener("change", change);
    window.addEventListener("beforeprint", prepare);
    window.addEventListener("afterprint", finish);
    change();
    return () => {
      media.removeEventListener("change", change);
      window.removeEventListener("beforeprint", prepare);
      window.removeEventListener("afterprint", finish);
    };
  }, []);
  const [params, setParams] = useSearchParams();
  const { user } = useAuth(),
    toast = useToast();
  const from = params.get("from") || dateInput(-179),
    to = params.get("to") || dateInput(),
    currency = params.get("currency") || "INR";
  const [draft, setDraft] = useState({ from, to, currency });
  const [filterError, setFilterError] = useState<unknown>(),
    [exportError, setExportError] = useState<unknown>();
  const [definition, setDefinition] = useState<ReportMetric | null>(null),
    [exportOpen, setExportOpen] = useState(false),
    [downloading, setDownloading] = useState("");
  const report = useApi<AnalyticsReport>(
    `/reports/analytics?${queryString({ from, to, currency })}`,
  );
  const selected =
    report.data?.views.find((v) => v.id === params.get("view")) ||
    report.data?.views[0];
  const selectedTable =
    selected?.tables.find((t) => t.id === params.get("table")) ||
    selected?.tables[0];
  useEffect(() => setDraft({ from, to, currency }), [from, to, currency]);
  function apply(e?: FormEvent, values = draft) {
    e?.preventDefault();
    if (!values.from || !values.to || values.from > values.to) {
      setFilterError(
        new Error("Choose a start date on or before the end date."),
      );
      return;
    }
    if (Date.parse(values.to) - Date.parse(values.from) > 3660 * 86400000) {
      setFilterError(
        new Error("Choose a reporting period of ten years or fewer."),
      );
      return;
    }
    setFilterError(undefined);
    const next = new URLSearchParams(params);
    Object.entries(values).forEach(([key, value]) => next.set(key, value));
    setParams(next);
  }
  const select = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    if (key === "view") next.delete("table");
    setParams(next, { replace: true });
  };
  async function download(kind: "csv" | "power-query") {
    if (!selected || !selectedTable) return;
    setDownloading(kind);
    setExportError(undefined);
    try {
      const filters = queryString({
        from,
        to,
        currency,
        view: selected.id,
        table: selectedTable.id,
      });
      const response = await fetch(
        `/api/reports/${kind === "csv" ? `datasets/${selected.id}` : "power-query"}?${filters}`,
        { credentials: "include" },
      );
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        if (response.status === 401)
          window.dispatchEvent(new Event("partnerhub:session-invalid"));
        throw new ApiError(
          error.error || "The export could not finish. Please try again.",
          response.status,
        );
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `VS-PartnerHub-${selected.id}-${selectedTable.id}-${to}.${kind === "csv" ? "csv" : "m"}`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(kind === "csv" ? "Report exported" : "Power Query file downloaded");
    } catch (e) {
      setExportError(e);
    } finally {
      setDownloading("");
    }
  }
  function narrowToMonth(month: string) {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    const first = `${month}-01`,
      next = new Date(`${first}T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const last = new Date(next.getTime() - 86400000).toISOString().slice(0, 10);
    apply(undefined, {
      from: first < from ? from : first,
      to: last > to ? to : last,
      currency,
    });
  }
  return (
    <div className="analytics-page">
      <PageHeader
        eyebrow="BUSINESS INTELLIGENCE"
        title="Reports & analytics"
        description="Understand the numbers. Follow the evidence. Move your business forward."
      >
        <Button
          variant="secondary"
          onClick={() => report.refetch()}
          busy={report.isFetching}
          aria-label="Refresh reports"
        >
          <RefreshCw size={16} />
          Refresh
        </Button>
        <Button
          disabled={!selected}
          onClick={() => {
            setExportError(undefined);
            setExportOpen(true);
          }}
        >
          <ArrowDownToLine size={17} />
          Export & connect
        </Button>
      </PageHeader>
      <form
        className="card analytics-filters"
        onSubmit={apply}
        aria-label="Reporting period"
      >
        <div className="analytics-filter-heading">
          <CalendarDays size={19} />
          <span>
            Reporting period<small>Record creation dates · UTC</small>
          </span>
        </div>
        <Field label="From date">
          <Input
            type="date"
            required
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </Field>
        <Field label="To date">
          <Input
            type="date"
            required
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </Field>
        <Field label="Reporting currency">
          <select
            className="input"
            value={draft.currency}
            onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
          >
            {["INR", "USD", "EUR", "GBP"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Button type="submit" variant="secondary">
          Apply filters
        </Button>
        <button
          className="text-button analytics-reset"
          type="button"
          onClick={() =>
            apply(undefined, {
              from: dateInput(-179),
              to: dateInput(),
              currency: "INR",
            })
          }
        >
          Last 180 days
        </button>
      </form>
      <FormError error={filterError} />
      {report.isPending ? (
        <Loading label="Preparing your reports…" />
      ) : report.error ? (
        <ErrorState error={report.error} retry={() => report.refetch()} />
      ) : (
        report.data &&
        selected && (
          <>
            <nav className="analytics-nav" aria-label="Report categories">
              {report.data.views.map((v) => {
                const Icon = icons[v.id];
                return (
                  <button
                    key={v.id}
                    type="button"
                    aria-current={v.id === selected.id ? "page" : undefined}
                    onClick={() => select("view", v.id)}
                  >
                    <span className="analytics-nav-icon">
                      <Icon size={19} />
                    </span>
                    <span>
                      <strong>{v.title}</strong>
                      <small>{captions[v.id]}</small>
                    </span>
                    {v.id === selected.id && (
                      <Check size={15} className="analytics-nav-check" />
                    )}
                  </button>
                );
              })}
            </nav>
            <section
              className="analytics-report"
              key={selected.id}
              aria-label={selected.title}
            >
              <div className="analytics-intro">
                <div>
                  <div className="analytics-eyebrow">
                    <Activity size={14} />
                    YOUR BUSINESS, IN FOCUS
                  </div>
                  <h2>{selected.title}</h2>
                  <p>{selected.description}</p>
                </div>
                <div className="analytics-snapshot">
                  <span>
                    <Clock3 size={14} />
                    Updated {formatTime(report.data.generatedAt)}
                  </span>
                  <strong>
                    {formatDate(report.data.from)} –{" "}
                    {formatDate(report.data.to)}
                  </strong>
                  <small>
                    {report.data.currency} monetary values · Counts across
                    currencies
                  </small>
                </div>
              </div>
              <div className="analytics-metrics">
                {selected.metrics.map((item) => (
                  <article
                    className="card analytics-metric"
                    key={item.key}
                    data-metric={item.key}
                  >
                    <div className="analytics-metric-heading">
                      <h3>{item.label}</h3>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`How ${item.label.toLowerCase()} is calculated`}
                        onClick={() => setDefinition(item)}
                      >
                        <CircleHelp size={15} />
                      </button>
                    </div>
                    <strong className="analytics-metric-value">
                      {display(item.value, item.format, report.data!.currency)}
                    </strong>
                    <div className="analytics-metric-footer">
                      <span className={`analytics-scope ${item.scope}`}>
                        {scopeLabel(item.scope)}
                      </span>
                      {item.href && (
                        <Link
                          to={item.href}
                          aria-label={`View ${item.label.toLowerCase()} records`}
                          title="View source records"
                        >
                          <ArrowUpRight size={18} />
                        </Link>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              <div className="analytics-charts">
                <TrendChart view={selected} onMonth={narrowToMonth} />
                <Distribution view={selected} />
              </div>
              {selected.id === "partners" && (
                <VerificationStages
                  table={selected.tables.find((t) => t.id === "verification")!}
                />
              )}
              {selected.id === "finance" &&
                selected.tables.find((t) => t.id === "aging") && (
                  <InvoiceAging
                    table={selected.tables.find((t) => t.id === "aging")!}
                    currency={report.data.currency}
                  />
                )}
              {selectedTable && (
                <Dataset
                  key={`${selected.id}:${selectedTable.id}:${from}:${to}:${currency}`}
                  table={selectedTable}
                  tables={selected.tables}
                  currency={report.data.currency}
                  printing={printing}
                  onSelect={(id) => select("table", id)}
                  onExport={() => {
                    setExportError(undefined);
                    setExportOpen(true);
                  }}
                />
              )}
              <details className="analytics-methodology">
                <summary>
                  <BookOpen size={17} />
                  How to read this report
                  <ChevronRight size={17} />
                </summary>
                <div>
                  <ul>
                    {selected.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                  <p>
                    Current snapshots include eligible older records. An em dash
                    means there is no qualifying evidence for a calculation.
                    Open a KPI’s information button for its definition.
                  </p>
                </div>
              </details>
              {printing && (
                <section className="analytics-print-notes">
                  <h3>How to read this report</h3>
                  <ul>
                    {selected.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                  <h3>KPI definitions</h3>
                  <dl>
                    {selected.metrics.map((metric) => (
                      <div key={metric.key}>
                        <dt>
                          {metric.label} · {scopeLabel(metric.scope)}
                        </dt>
                        <dd>{metric.definition}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}
            </section>
          </>
        )
      )}
      {definition && (
        <Modal
          title={definition.label}
          description={scopeLabel(definition.scope)}
          onClose={() => setDefinition(null)}
        >
          <div className="analytics-definition">
            <strong>
              {display(definition.value, definition.format, currency)}
            </strong>
            <p>{definition.definition}</p>
            {definition.href && (
              <Link
                className="button button-secondary"
                to={definition.href}
                onClick={() => setDefinition(null)}
              >
                View source records
                <ArrowUpRight size={16} />
              </Link>
            )}
          </div>
        </Modal>
      )}
      {exportOpen && selected && selectedTable && (
        <Modal
          title="Export & connect"
          description={`${selected.title} · ${formatDate(from)} – ${formatDate(to)}`}
          onClose={() => setExportOpen(false)}
        >
          <div className="analytics-export">
            <Field label="Export dataset">
              <select
                className="input"
                value={selectedTable.id}
                onChange={(e) => select("table", e.target.value)}
              >
                {selected.tables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </Field>
            <p className="muted">
              {selectedTable.rows.length} rows ·{" "}
              {scopeLabel(selectedTable.scope)}. Exports include every row in
              this dataset.
            </p>
            <FormError error={exportError} />
            <button
              className="analytics-export-option"
              disabled={!!downloading}
              onClick={() => download("csv")}
            >
              <FileSpreadsheet size={24} />
              <span>
                <strong>
                  {downloading === "csv" ? "Preparing CSV…" : "Download CSV"}
                </strong>
                <small>
                  Open in Excel or import as a text source in Tableau.
                </small>
              </span>
              <ArrowDownToLine size={18} />
            </button>
            <button
              className="analytics-export-option"
              disabled={!!downloading}
              onClick={() => download("power-query")}
            >
              <PlugZap size={24} />
              <span>
                <strong>
                  {downloading === "power-query"
                    ? "Preparing connection…"
                    : "Connect Power BI / Power Query"}
                </strong>
                <small>
                  Download a query for authenticated, refreshable reporting.
                </small>
              </span>
              <ArrowDownToLine size={18} />
            </button>
            <button
              className="analytics-export-option"
              onClick={() => {
                setExportOpen(false);
                requestAnimationFrame(() => window.print());
              }}
            >
              <Printer size={24} />
              <span>
                <strong>Print / save PDF</strong>
                <small>
                  Save the current report with its figures and definitions.
                </small>
              </span>
              <ArrowUpRight size={18} />
            </button>
            <div className="analytics-export-note">
              <ShieldCheck size={18} />
              <p>
                Power Query uses a revocable API token with Reports and the
                source modules you choose. Money is exported in minor currency
                units; divide by 100 for rupees, dollars, euros or pounds.
                {user?.permissions.integrations?.includes("manage") && (
                  <>
                    {" "}
                    <Link
                      to="/app/integrations"
                      onClick={() => setExportOpen(false)}
                    >
                      Manage connections <ArrowUpRight size={13} />
                    </Link>
                  </>
                )}
              </p>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function TrendChart({
  view,
  onMonth,
}: {
  view: ReportView;
  onMonth: (month: string) => void;
}) {
  const gradient = useId().replaceAll(":", ""),
    total = view.trend.reduce((sum, row) => sum + row.value, 0);
  return (
    <section className="card analytics-chart-card">
      <div className="analytics-card-heading">
        <div>
          <span className="analytics-kicker">ACTIVITY OVER TIME</span>
          <h3>{view.trendLabel}</h3>
        </div>
        <TrendingUp size={21} />
      </div>
      {total ? (
        <>
          <table className="analytics-print-trend">
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Activity</th>
                <th scope="col">Records</th>
              </tr>
            </thead>
            <tbody>
              {view.trend.map((row) => (
                <tr key={row.month}>
                  <th scope="row">{monthLabel(row.month)}</th>
                  <td>
                    <span
                      style={{
                        width: `${(row.value / Math.max(1, ...view.trend.map((point) => point.value))) * 100}%`,
                      }}
                    />
                  </td>
                  <td>{number.format(row.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div
            className="analytics-trend"
            role="img"
            aria-label={`${view.trendLabel}: ${number.format(total)} records across ${view.trend.length} months`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={view.trend}
                margin={{ top: 12, left: 0, right: 12, bottom: 0 }}
                onClick={(state: any) =>
                  state?.activeLabel && onMonth(String(state.activeLabel))
                }
              >
                <defs>
                  <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#719765" stopOpacity={0.3} />
                    <stop
                      offset="100%"
                      stopColor="#719765"
                      stopOpacity={0.015}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 6"
                  vertical={false}
                  stroke="#e5ebe2"
                />
                <XAxis
                  dataKey="month"
                  tickFormatter={monthLabel}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: "#58685e" }}
                  minTickGap={22}
                />
                <YAxis
                  width={42}
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: "#58685e" }}
                />
                <Tooltip
                  labelFormatter={(value) => monthLabel(String(value))}
                  formatter={(value: any) => [
                    number.format(Number(value)),
                    "Records",
                  ]}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid #e6ebe4",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#426842"
                  strokeWidth={2.5}
                  fill={`url(#${gradient})`}
                  isAnimationActive={false}
                  dot={
                    view.trend.length === 1 ? { r: 5, fill: "#426842" } : false
                  }
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="analytics-chart-footer">
            <span>{number.format(total)} records in this period</span>
            <select
              className="input"
              aria-label="Drill into reporting month"
              value=""
              onChange={(e) => e.target.value && onMonth(e.target.value)}
            >
              <option value="">Explore a month</option>
              {view.trend.map((row) => (
                <option key={row.month} value={row.month}>
                  {monthLabel(row.month)} · {row.value}
                </option>
              ))}
            </select>
          </div>
        </>
      ) : (
        <EmptyState
          icon={<BarChart3 size={26} />}
          title="No activity in this period"
          description="Choose another reporting period or return as your workspace grows."
        />
      )}
    </section>
  );
}
function Distribution({ view }: { view: ReportView }) {
  const max = Math.max(1, ...view.distribution.map((row) => row.value));
  const content = (row: ReportView["distribution"][number]) => (
    <>
      <span className="analytics-bar-label">{row.name}</span>
      <span className="analytics-bar-track">
        <span style={{ width: `${(row.value / max) * 100}%` }} />
      </span>
      <strong>{number.format(row.value)}</strong>
      {row.href && <ChevronRight size={13} />}
    </>
  );
  return (
    <section className="card analytics-chart-card">
      <div className="analytics-card-heading">
        <div>
          <span className="analytics-kicker">STATUS & DISTRIBUTION</span>
          <h3>{view.distributionLabel}</h3>
        </div>
        <BarChart3 size={21} />
      </div>
      {view.distribution.some((row) => row.value > 0) ? (
        <div className="analytics-bars">
          {view.distribution.map((row, i) =>
            row.href ? (
              <Link
                key={i}
                className="analytics-bar"
                to={row.href}
                aria-label={`${row.name}: ${row.value}. View records`}
              >
                {content(row)}
              </Link>
            ) : (
              <div key={i} className="analytics-bar">
                {content(row)}
              </div>
            ),
          )}
        </div>
      ) : (
        <EmptyState
          title="No records to group"
          description="Recorded activity will appear here with its actual status."
        />
      )}
    </section>
  );
}
function VerificationStages({ table }: { table: ReportTable }) {
  return (
    <section className="card analytics-verification">
      <div className="analytics-card-heading">
        <div>
          <span className="analytics-kicker">
            FROM REGISTRATION TO PARTNERSHIP
          </span>
          <h3>Verification journey</h3>
          <p>Current organization counts at each stage.</p>
        </div>
        <ShieldCheck size={22} />
      </div>
      <div className="analytics-stage-track">
        {[
          "registered",
          "under_review",
          "clarification",
          "verified",
          "active",
        ].map((status, index) => (
          <Link
            key={status}
            to={`/app/organizations?status=${status}`}
            className={status === "active" ? "complete" : ""}
          >
            <span className="analytics-stage-number">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span>
              <small>{label(status)}</small>
              <strong>
                {table.rows.find((row) => row.status === status)
                  ?.organizations || 0}
              </strong>
            </span>
            <ChevronRight size={16} />
          </Link>
        ))}
      </div>
    </section>
  );
}
function InvoiceAging({
  table,
  currency,
}: {
  table: ReportTable;
  currency: string;
}) {
  const total = table.rows.reduce(
    (sum, row) => sum + Number(row.outstanding_minor),
    0,
  );
  return (
    <section className="card analytics-aging">
      <div className="analytics-card-heading">
        <div>
          <span className="analytics-kicker">
            CURRENT RECEIVABLES & PAYABLES
          </span>
          <h3>Where balances are aging</h3>
          <p>
            Approved invoices after completed payments, across all creation
            dates.
          </p>
        </div>
        <span className="analytics-scope current">Current snapshot</span>
      </div>
      <div className="analytics-aging-grid">
        {table.rows.map((row) => (
          <div key={String(row.bucket)}>
            <span>{row.bucket}</span>
            <strong>{money(Number(row.outstanding_minor), currency)}</strong>
            <div className="analytics-aging-track">
              <i
                style={{
                  width: `${total ? (Number(row.outstanding_minor) / total) * 100 : 0}%`,
                }}
              />
            </div>
            <small>
              {row.invoices} invoice{row.invoices === 1 ? "" : "s"}
            </small>
          </div>
        ))}
      </div>
    </section>
  );
}
function Dataset({
  table,
  tables,
  currency,
  printing,
  onSelect,
  onExport,
}: {
  table: ReportTable;
  tables: ReportTable[];
  currency: string;
  printing: boolean;
  onSelect: (id: string) => void;
  onExport: () => void;
}) {
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [sort, setSort] = useState<{ key: string; ascending: boolean } | null>(
      null,
    );
  const rows = table.rows.filter(
    (row) =>
      printing ||
      Object.values(row).some((value) =>
        String(value ?? "")
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
  );
  if (sort)
    rows.sort((a, b) => {
      const x = a[sort.key],
        y = b[sort.key];
      return (
        (typeof x === "number" && typeof y === "number"
          ? x - y
          : String(x ?? "").localeCompare(String(y ?? ""))) *
        (sort.ascending ? 1 : -1)
      );
    });
  function cell(
    value: ReportCell,
    key: string,
    format: ReportFormat,
    row: Record<string, ReportCell>,
  ) {
    if (key === "module")
      return moduleDefinitions[value as Module]?.label || String(value);
    if (key === "organization_type")
      return organizationLabels[value as OrganizationType] || String(value);
    if (["status", "requirement_type", "scope"].includes(key))
      return value ? label(String(value)) : "—";
    if (key === "value" && row.format) format = row.format as ReportFormat;
    return display(
      value,
      format,
      typeof row.currency === "string" ? row.currency : currency,
    );
  }
  return (
    <section className="card analytics-dataset">
      <div className="analytics-card-heading">
        <div>
          <span className="analytics-kicker">THE NUMBERS BEHIND THE VIEW</span>
          <h3>Report data</h3>
        </div>
        <Button variant="secondary" onClick={onExport}>
          <ArrowDownToLine size={15} />
          Export dataset
        </Button>
      </div>
      <div className="analytics-dataset-tools">
        <Field label="Report dataset">
          <select
            className="input"
            value={table.id}
            onChange={(e) => onSelect(e.target.value)}
          >
            {tables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </Field>
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Search dataset…"
        />
        <span className="analytics-scope">{scopeLabel(table.scope)}</span>
      </div>
      <p className="analytics-table-description">{table.description}</p>
      {rows.length ? (
        <>
          <div
            className="table-scroll analytics-data-scroll"
            tabIndex={0}
            role="region"
            aria-label={table.title}
          >
            <table className="data-table">
              <thead>
                <tr>
                  {table.columns.map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      aria-sort={
                        sort?.key === column.key
                          ? sort.ascending
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <button
                        onClick={() => {
                          setSort({
                            key: column.key,
                            ascending:
                              sort?.key === column.key ? !sort.ascending : true,
                          });
                          setPage(1);
                        }}
                        aria-label={`Sort by ${column.label.toLowerCase()}`}
                      >
                        {column.label}
                        <span aria-hidden="true">
                          {sort?.key === column.key
                            ? sort.ascending
                              ? "↑"
                              : "↓"
                            : "↕"}
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(printing ? rows : rows.slice((page - 1) * 20, page * 20)).map(
                  (row, i) => (
                    <tr key={i}>
                      {table.columns.map((column) => (
                        <td
                          key={column.key}
                          className={
                            column.format === "text"
                              ? "analytics-text-cell"
                              : "analytics-number-cell"
                          }
                        >
                          {cell(
                            row[column.key],
                            column.key,
                            column.format,
                            row,
                          )}
                        </td>
                      ))}
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
          <Pagination total={rows.length} page={page} onChange={setPage} />
        </>
      ) : (
        <EmptyState
          icon={<Database size={24} />}
          title={search ? "No matching rows" : "No records in this dataset"}
          description={
            search
              ? "Try a different search."
              : "Adjust the reporting dates or return after records have been added."
          }
        />
      )}
    </section>
  );
}
