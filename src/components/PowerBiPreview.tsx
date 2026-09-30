import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Link } from "react-router-dom";
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
  ArrowUpRight,
  BarChart3,
  Building2,
  CalendarDays,
  Check,
  CircleHelp,
  Clock3,
  Database,
  FileSpreadsheet,
  Headphones,
  LayoutDashboard,
  ShieldCheck,
  ShoppingCart,
  TrendingUp,
  UsersRound,
  Wallet,
} from "lucide-react";
import type {
  AnalyticsReport,
  ReportMetric,
  ReportTable,
  ReportView,
  ReportViewId,
} from "../../shared/analytics";
import { biAccent, biColors, biHighlights, biValue } from "../../shared/bi";
import { formatDate, formatTime } from "../lib/format";
import { EmptyState, Field, Modal, Pagination, SearchInput } from "./ui";
import ScrollRegion from "./ScrollRegion";
import "../bi-preview.css";

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
const month = (value: string) =>
  new Date(`${value}-01T00:00:00Z`).toLocaleDateString("en-IN", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
const scope = (value: string) =>
  value === "current"
    ? "Current snapshot"
    : value === "period"
      ? "Selected period"
      : "Scope shown per KPI";

export default function PowerBiPreview({
  report,
  view,
  table,
  onView,
  onTable,
}: {
  report: AnalyticsReport;
  view: ReportView;
  table: ReportTable;
  onView: (id: ReportViewId) => void;
  onTable: (id: string) => void;
}) {
  const [metric, setMetric] = useState<ReportMetric | null>(null);
  const navigation = useRef<HTMLElement>(null);
  useEffect(() => {
    const region = navigation.current;
    if (!region) return;
    const revealActivePage = () => {
      const active = region.querySelector<HTMLElement>("[aria-current=page]");
      if (!active || region.scrollWidth <= region.clientWidth) return;
      const bounds = region.getBoundingClientRect();
      const selected = active.getBoundingClientRect();
      if (selected.left < bounds.left + 12)
        region.scrollLeft += selected.left - bounds.left - 12;
      else if (selected.right > bounds.right - 12)
        region.scrollLeft += selected.right - bounds.right + 12;
    };
    revealActivePage();
    const observer = new ResizeObserver(revealActivePage);
    observer.observe(region);
    return () => observer.disconnect();
  }, [view.id]);
  const Icon = icons[view.id];
  const index = report.views.findIndex((item) => item.id === view.id);
  const total = view.distribution.reduce((sum, row) => sum + row.value, 0);
  const maximum = Math.max(1, ...view.distribution.map((row) => row.value));
  const highlights = view.metrics.slice(0, biHighlights);
  return (
    <div
      className="bi-preview"
      style={{ "--bi-accent": biAccent[view.id] } as CSSProperties}
    >
      <div className="bi-workbook-bar">
        <span className="bi-file-icon">
          <BarChart3 size={20} />
        </span>
        <div>
          <strong>VS PartnerHub</strong>
          <span>Power BI export preview</span>
        </div>
        <span className="bi-workbook-state">
          <span /> Authorized workspace data
        </span>
        <span className="bi-page-count">
          {String(index + 1).padStart(2, "0")}{" "}
          <span>/ {String(report.views.length).padStart(2, "0")}</span>
        </span>
      </div>
      <div className="bi-workbook">
        <nav
          className="bi-page-nav"
          aria-label="Power BI dashboard pages"
          ref={navigation}
        >
          {report.views.map((item) => {
            const PageIcon = icons[item.id];
            return (
              <button
                type="button"
                key={item.id}
                aria-current={item.id === view.id ? "page" : undefined}
                onClick={() => onView(item.id)}
              >
                <PageIcon size={17} />
                <span>{item.title}</span>
              </button>
            );
          })}
        </nav>
        <section
          className="bi-canvas"
          aria-label={`${view.title} Power BI preview`}
        >
          <header className="bi-canvas-heading">
            <div>
              <div className="bi-kicker">
                <Icon size={14} /> BUSINESS INTELLIGENCE
              </div>
              <h2>{view.title}</h2>
              <p>{view.description}</p>
            </div>
            <div className="bi-period">
              <CalendarDays size={15} />
              <span>
                {formatDate(report.from)} – {formatDate(report.to)}
                <small>{report.currency} · Creation dates in UTC</small>
              </span>
            </div>
          </header>
          <div className="bi-kpi-grid">
            {highlights.map((item) => (
              <button
                type="button"
                className="bi-kpi"
                key={item.key}
                onClick={() => setMetric(item)}
                aria-label={`${item.label}: ${biValue(item.value, item.format, report.currency)}. View calculation`}
              >
                <span className="bi-kpi-label">
                  {item.label}
                  <CircleHelp size={14} />
                </span>
                <strong
                  title={biValue(item.value, item.format, report.currency)}
                >
                  <span className="bi-kpi-value-full">
                    {biValue(item.value, item.format, report.currency)}
                  </span>
                  <span className="bi-kpi-value-compact" aria-hidden="true">
                    {biValue(item.value, item.format, report.currency, true)}
                  </span>
                </strong>
                <span className="bi-kpi-scope">
                  <span />
                  {scope(item.scope)}
                </span>
              </button>
            ))}
          </div>
          <div className="bi-chart-grid">
            <section className="bi-panel bi-trend">
              <div className="bi-panel-heading">
                <div>
                  <span className="bi-panel-eyebrow">ACTIVITY OVER TIME</span>
                  <h3>{view.trendLabel}</h3>
                </div>
                <span className="bi-chart-key">
                  <span />
                  Records
                </span>
              </div>
              <div
                className="bi-trend-chart"
                role="img"
                aria-label={`${view.trendLabel}. ${view.trend.map((row) => `${month(row.month)}: ${row.value}`).join(". ")}`}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={view.trend}
                    margin={{ top: 18, right: 14, left: -25, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient
                        id={`bi-fill-${view.id}`}
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor={biAccent[view.id]}
                          stopOpacity={0.22}
                        />
                        <stop
                          offset="100%"
                          stopColor={biAccent[view.id]}
                          stopOpacity={0.01}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      vertical={false}
                      stroke="#e8ece8"
                      strokeDasharray="3 5"
                    />
                    <XAxis
                      dataKey="month"
                      tickFormatter={month}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "#647169", fontSize: 10 }}
                      minTickGap={28}
                    />
                    <YAxis
                      allowDecimals={false}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "#647169", fontSize: 10 }}
                    />
                    <Tooltip
                      labelFormatter={(value) => month(String(value))}
                      contentStyle={{
                        borderRadius: 10,
                        border: "1px solid #dde5dd",
                        fontSize: 12,
                      }}
                      formatter={(value) => [
                        Number(value).toLocaleString("en-IN"),
                        "Records",
                      ]}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke={biAccent[view.id]}
                      strokeWidth={2.5}
                      fill={`url(#bi-fill-${view.id})`}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="bi-chart-foot">
                <Clock3 size={13} />
                {view.trend.some((row) => row.value)
                  ? "Monthly activity within your selected reporting period"
                  : "No recorded activity in this reporting period"}
              </div>
            </section>
            <section className="bi-panel bi-distribution">
              <div className="bi-panel-heading">
                <div>
                  <span className="bi-panel-eyebrow">COMPOSITION</span>
                  <h3>{view.distributionLabel}</h3>
                </div>
                <strong className="bi-distribution-total">
                  {total.toLocaleString("en-IN")}
                </strong>
              </div>
              <ScrollRegion
                className="bi-distribution-list"
                label={`${view.distributionLabel} values`}
              >
                {view.distribution.map((row, at) => (
                  <div className="bi-distribution-row" key={row.name}>
                    <div>
                      {row.href ? (
                        <Link to={row.href}>
                          {row.name}
                          <ArrowUpRight size={12} />
                        </Link>
                      ) : (
                        <span>{row.name}</span>
                      )}
                      <strong>{row.value.toLocaleString("en-IN")}</strong>
                    </div>
                    <div className="bi-bar-track">
                      <span
                        style={{
                          width: `${(row.value / maximum) * 100}%`,
                          background: biColors[at % biColors.length],
                        }}
                      />
                    </div>
                  </div>
                ))}
                {!view.distribution.length && (
                  <p className="muted">
                    No categories are available for this report.
                  </p>
                )}
              </ScrollRegion>
            </section>
          </div>
          <section className="bi-panel bi-all-kpis">
            <div className="bi-panel-heading">
              <div>
                <span className="bi-panel-eyebrow">
                  THE COMPLETE MEASURE SET
                </span>
                <h3>All KPIs</h3>
              </div>
              <span className="bi-count-badge">
                {view.metrics.length} measures
              </span>
            </div>
            <div className="bi-measure-list">
              {view.metrics.map((item) => (
                <button
                  type="button"
                  key={item.key}
                  onClick={() => setMetric(item)}
                >
                  <span>
                    {item.label}
                    <small>{scope(item.scope)}</small>
                  </span>
                  <strong>
                    {biValue(item.value, item.format, report.currency)}
                  </strong>
                  <CircleHelp size={14} />
                </button>
              ))}
            </div>
          </section>
          <BiData report={report} view={view} table={table} onTable={onTable} />
          <footer className="bi-canvas-footer">
            <span>
              <Check size={14} /> Snapshot {formatDate(report.generatedAt)} at{" "}
              {formatTime(report.generatedAt)}
            </span>
            <span>Missing evidence stays blank · No currency conversion</span>
          </footer>
        </section>
      </div>
      {metric && (
        <Modal
          title={metric.label}
          description="KPI calculation & source"
          onClose={() => setMetric(null)}
        >
          <div className="modal-body bi-metric-detail">
            <strong>
              {biValue(metric.value, metric.format, report.currency)}
            </strong>
            <span>{scope(metric.scope)}</span>
            <p>{metric.definition}</p>
            {metric.href && (
              <Link className="button button-secondary" to={metric.href}>
                View source records
                <ArrowUpRight size={15} />
              </Link>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

function BiData({
  report,
  view,
  table,
  onTable,
}: {
  report: AnalyticsReport;
  view: ReportView;
  table: ReportTable;
  onTable: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    setSearch("");
    setPage(1);
  }, [view.id, table.id, report.generatedAt]);
  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return needle
      ? table.rows.filter((row) =>
          Object.values(row).some((value) =>
            String(value ?? "")
              .toLocaleLowerCase()
              .includes(needle),
          ),
        )
      : table.rows;
  }, [search, table.rows]);
  const current = Math.min(page, Math.max(1, Math.ceil(rows.length / 10)));
  return (
    <section className="bi-panel bi-data">
      <div className="bi-panel-heading">
        <div>
          <span className="bi-panel-eyebrow">BEHIND THE NUMBERS</span>
          <h3>
            <Database size={16} />
            Data explorer
          </h3>
        </div>
        <span className="bi-count-badge">{rows.length} rows</span>
      </div>
      <div className="bi-data-controls">
        <Field label="Dataset">
          <select
            className="input"
            value={table.id}
            onChange={(event) => onTable(event.target.value)}
          >
            {view.tables.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
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
          placeholder="Find in this dataset…"
        />
      </div>
      <p className="bi-data-description">{table.description}</p>
      {rows.length ? (
        <>
          <ScrollRegion
            className="bi-data-table"
            label={`${table.title} table`}
          >
            <table>
              <thead>
                <tr>
                  {table.columns.map((column) => (
                    <th key={column.key} scope="col">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice((current - 1) * 10, current * 10).map((row, at) => (
                  <tr key={at}>
                    {table.columns.map((column) => (
                      <td key={column.key}>
                        {biValue(
                          row[column.key],
                          column.format,
                          typeof row.currency === "string"
                            ? row.currency
                            : report.currency,
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
          <Pagination
            page={current}
            total={rows.length}
            limit={10}
            onChange={setPage}
          />
        </>
      ) : (
        <EmptyState
          icon={<FileSpreadsheet size={27} />}
          title={search ? "No matching rows" : "No records in this dataset"}
          description={
            search
              ? "Try another search term."
              : "Your authorized records will appear here as your business activity grows."
          }
        />
      )}
      <div className="bi-data-scope">
        <Activity size={13} />
        {scope(table.scope)} · Snapshot {formatDate(report.generatedAt)}
      </div>
    </section>
  );
}
