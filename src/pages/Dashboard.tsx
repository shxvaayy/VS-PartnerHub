import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  CircleCheck,
  ClipboardCheck,
  Download,
  FileCheck2,
  FileText,
  Globe2,
  Plus,
  Send,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  UsersRound,
  Wallet,
} from "lucide-react";
import { useApi } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  Avatar,
  Badge,
  Button,
  CardHeader,
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  TextLink,
} from "../components/ui";
import { moduleIcons } from "../components/icons";
import { formatDate, formatTime, money, relativeTime } from "../lib/format";
import {
  label,
  moduleDefinitions,
  organizationLabels,
  type Module,
  type OrganizationType,
  type WorkRecord,
} from "../../shared/domain";

export default function Dashboard({ reports = false }: { reports?: boolean }) {
  const { user } = useAuth(),
    navigate = useNavigate();
  const [days, setDays] = useState("180"),
    [currency, setCurrency] = useState("INR"),
    [chartMode, setChartMode] = useState("partners");
  const result = useApi<any>(`/dashboard?days=${days}&currency=${currency}`),
    hiring =
      ["hr", "org_recruiter"].includes(user!.role) ||
      ["recruitment", "staffing"].includes(user!.organization?.type || "");
  const interviews = useApi<any>(
    "/records/interviews?status=scheduled&limit=4",
    hiring && Boolean(user!.permissions.interviews),
  );
  if (result.isPending) return <Loading />;
  if (result.error)
    return <ErrorState error={result.error} retry={() => result.refetch()} />;
  const d = result.data,
    count = (kind: string, statuses?: string[]) =>
      d.metrics
        .filter(
          (m: any) =>
            m.kind === kind && (!statuses || statuses.includes(m.status)),
        )
        .reduce((n: number, m: any) => n + m.count, 0);
  const amount = (kind: string, statuses?: string[]) =>
    d.commercial
      .filter(
        (m: any) =>
          m.kind === kind && (!statuses || statuses.includes(m.status)),
      )
      .reduce((n: number, m: any) => n + m.total, 0);
  const orgCount = d.organizationStats.reduce(
      (n: number, m: any) => n + m.count,
      0,
    ),
    activeOrgs = d.organizationStats
      .filter((m: any) => m.status === "active")
      .reduce((n: number, m: any) => n + m.count, 0),
    pendingOrgs = d.organizationStats
      .filter((m: any) =>
        ["registered", "under_review", "clarification"].includes(m.status),
      )
      .reduce((n: number, m: any) => n + m.count, 0);
  const has = (key: string) =>
    Boolean(user!.permissions[key]?.includes("view"));
  const attentionCount =
    pendingOrgs +
    count("orders", ["pending_approval"]) +
    count("invoices", ["submitted", "under_review"]);
  const buyer = user!.internal || user!.organization?.type === "client";
  const finance = ["finance", "org_finance"].includes(user!.role);
  const statCards = hiring
    ? [
        {
          title: "Open requirements",
          value: count("requirements", ["open"]),
          foot: "Opportunities to find the right talent",
          Icon: BriefcaseBusiness,
          to: "/app/requirements?status=open",
          tone: "sage",
        },
        {
          title: "Candidates in pipeline",
          value:
            count("candidates") - count("candidates", ["joined", "closed"]),
          foot: `${count("candidates")} candidates submitted overall`,
          Icon: UsersRound,
          to: "/app/candidates",
          tone: "lavender",
        },
        {
          title: "Upcoming interviews",
          value: count("interviews", ["scheduled"]),
          foot: "Conversations that open new doors",
          Icon: CalendarDays,
          to: "/app/interviews?status=scheduled",
          tone: "peach",
        },
        {
          title: "Successful joinings",
          value: count("candidates", ["joined"]),
          foot: "New beginnings, made possible",
          Icon: CircleCheck,
          to: "/app/candidates?status=joined",
          tone: "blue",
        },
      ]
    : finance
      ? [
          {
            title: "Invoices to review",
            value: count("invoices", ["submitted", "under_review"]),
            foot: "Ready for your attention",
            Icon: FileCheck2,
            to: "/app/invoices?status=submitted",
            tone: "peach",
          },
          {
            title: "Approved invoice value",
            value: money(amount("invoices", ["approved"]), currency, true),
            foot: "Includes partially paid invoices",
            Icon: FileText,
            to: "/app/invoices?status=approved",
            tone: "lavender",
          },
          {
            title: "Payments recorded",
            value: money(amount("payments", ["completed"]), currency, true),
            foot: `${count("payments", ["completed"])} completed payment records`,
            Icon: Wallet,
            to: "/app/payments?status=completed",
            tone: "sage",
          },
          {
            title: "Payments in progress",
            value: count("payments", ["pending", "processing"]),
            foot: "Track and reconcile transfers",
            Icon: TrendingUp,
            to: "/app/payments",
            tone: "blue",
          },
        ]
      : [
          {
            title: orgCount ? "Total partners" : "Open opportunities",
            value: orgCount || count("rfqs", ["published", "evaluation"]),
            foot: orgCount
              ? `${activeOrgs} verified, active organizations`
              : "RFQs waiting for your response",
            Icon: orgCount ? Building2 : Send,
            to: orgCount ? "/app/organizations" : "/app/rfqs",
            tone: "sage",
          },
          {
            title: orgCount || buyer ? "Active RFQs" : "Your quotations",
            value:
              orgCount || buyer
                ? count("rfqs", ["published", "evaluation"])
                : count("quotations"),
            foot: `${count("quotations", ["submitted", "under_review"])} quotations awaiting review`,
            Icon: Send,
            to: "/app/rfqs",
            tone: "lavender",
          },
          {
            title: "Purchase orders",
            value: count("orders"),
            foot: `${money(amount("orders"), currency, true)} in total commitments`,
            Icon: ShoppingBag,
            to: "/app/orders",
            tone: "peach",
          },
          {
            title: buyer ? "Needs attention" : "Approved invoices",
            value: buyer ? attentionCount : count("invoices", ["approved"]),
            foot: buyer
              ? `${pendingOrgs} partner applications pending`
              : "View balances and payment history",
            Icon: buyer ? ClipboardCheck : Wallet,
            to:
              buyer && has("verification")
                ? "/app/verification"
                : "/app/invoices",
            tone: "blue",
          },
        ];
  const months = Array.from(
    { length: Math.min(12, Math.ceil(Number(days) / 30)) },
    (_, i) => {
      const dt = new Date();
      dt.setMonth(
        dt.getMonth() - (Math.min(12, Math.ceil(Number(days) / 30)) - 1 - i),
      );
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
      const total = (kind: string) =>
        d.monthly
          .filter((m: any) => m.month === key && m.kind === kind)
          .reduce((n: number, m: any) => n + m.count, 0);
      return {
        key,
        month: dt.toLocaleString("en", { month: "short" }),
        partners: d.registrations.find((r: any) => r.month === key)?.count || 0,
        rfqs: total("rfqs"),
        orders: total("orders"),
        candidates: total("candidates"),
        invoices: total("invoices"),
        payments: total("payments"),
      };
    },
  );
  const colors = [
    "#2f6b50",
    "#86b87a",
    "#b4d49b",
    "#dce9c5",
    "#ddb989",
    "#9dabc7",
    "#b3a4bf",
    "#e5d9c2",
    "#a6cfc4",
  ];
  const distribution = orgCount
    ? Object.entries(organizationLabels)
        .map(([type, name], i) => ({
          key: type,
          name,
          value: d.organizationStats
            .filter((m: any) => m.type === type)
            .reduce((n: number, m: any) => n + m.count, 0),
          color: colors[i],
        }))
        .filter((v) => v.value)
    : ["draft", "submitted", "approved", "rejected"]
        .map((status, i) => ({
          key: status,
          name: label(status),
          value: count("quotations", [status]),
          color: colors[i],
        }))
        .filter((v) => v.value);
  const title = reports
    ? "The bigger picture."
    : hiring
      ? "Great people. New possibilities."
      : finance
        ? "Every number, accounted for."
        : `Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, ${user!.name.split(" ")[0]}.`;
  const primary = hiring
    ? user!.permissions.candidates?.includes("create") && !buyer
      ? "candidates"
      : "requirements"
    : finance
      ? "payments"
      : "rfqs";
  return (
    <div className="dashboard-page">
      <PageHeader
        eyebrow={
          reports
            ? "INSIGHT THAT MOVES YOU FORWARD"
            : new Intl.DateTimeFormat("en-IN", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })
                .format(new Date())
                .toUpperCase()
        }
        title={title}
        description={
          reports
            ? "A clear view of your network, operations and business performance."
            : hiring
              ? "A little clarity for every step of the hiring journey."
              : "Here’s what’s happening across your partner ecosystem today."
        }
      >
        <div className="header-date">
          <CalendarDays size={15} />
          {new Date().toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </div>
        {has("reports") && (
          <a className="button button-secondary" href="/api/reports/export">
            <Download size={16} />
            <span>Export report</span>
          </a>
        )}
        {user!.permissions[primary]?.includes("create") && (
          <Link
            className="button button-primary"
            to={`/app/${primary}?new=true`}
          >
            <Plus size={17} />
            {primary === "rfqs"
              ? "Create RFQ"
              : `New ${moduleDefinitions[primary as Module].singular.toLowerCase()}`}
          </Link>
        )}
      </PageHeader>
      {!user!.email_verified && (
        <div className="notice-banner">
          <MailIcon />
          <div>
            <strong>One step left: verify your email</strong>
            <span>
              Confirm your email to submit your company for verification.
            </span>
          </div>
          <Link to="/verify">
            Verify email
            <ArrowRight size={16} />
          </Link>
        </div>
      )}
      {user!.organization && user!.organization.status !== "active" && (
        <div className="notice-banner">
          <ShieldCheck size={23} />
          <div>
            <strong>
              {user!.organization.status === "suspended"
                ? "Your organization’s access is suspended"
                : "Your company verification is in progress"}
            </strong>
            <span>
              {user!.organization.details.verification_note ||
                "Keep your profile and documents up to date. The VS team will review your application."}
            </span>
          </div>
          <Link to="/app/documents">
            Review documents
            <ArrowRight size={16} />
          </Link>
        </div>
      )}
      {!reports && (
        <section
          className={`dashboard-welcome ${hiring ? "welcome-talent" : ""}`}
        >
          <div>
            <span className="welcome-eyebrow">
              <span />
              {hiring
                ? "YOUR TALENT NETWORK, CONNECTED"
                : "YOUR PARTNER ECOSYSTEM, CONNECTED"}
            </span>
            <h2>
              {hiring ? (
                <>
                  The right people.
                  <br />A world of potential.
                </>
              ) : (
                <>
                  Stronger connections.
                  <br />
                  Smarter business.
                </>
              )}
            </h2>
            <p>
              {hiring
                ? "Turn a promising introduction into a great new beginning."
                : "Everything you need to build partnerships that go further."}
            </p>
            <Link
              to={
                hiring
                  ? "/app/candidates"
                  : has("discovery")
                    ? "/app/discovery"
                    : has("organizations")
                      ? "/app/organizations"
                      : "/app/profile"
              }
            >
              {hiring
                ? "Explore your talent pipeline"
                : has("discovery") || has("organizations")
                  ? "Explore your partner network"
                  : "Make your profile stand out"}
              <ArrowRight size={16} />
            </Link>
          </div>
          <div className="welcome-art" aria-hidden="true">
            <div className="welcome-ring ring-a" />
            <div className="welcome-ring ring-b" />
            <div className="welcome-center">
              <LayersIcon />
            </div>
            <div className="welcome-node welcome-node-a">
              <ShieldCheck size={17} />
              <span>Verified partners</span>
              <i />
            </div>
            <div className="welcome-node welcome-node-b">
              <ShoppingCart size={17} />
              <span>Connected business</span>
            </div>
            <div className="welcome-node welcome-node-c">
              <UsersRound size={17} />
              <span>Shared growth</span>
            </div>
            <span className="welcome-small-dot" />
          </div>
        </section>
      )}
      <div className="stat-grid">
        {statCards.map((card) => (
          <Link
            className={`stat-card ${!has(card.to.split("/")[2]?.split("?")[0] || "") ? "stat-static" : ""}`}
            key={card.title}
            to={
              has(card.to.split("/")[2]?.split("?")[0] || "") ? card.to : "/app"
            }
          >
            <div className="stat-top">
              <span>{card.title}</span>
              <span className={`stat-icon ${card.tone}`}>
                <card.Icon size={19} />
              </span>
            </div>
            <div className="stat-value">
              {card.value}
              <ArrowUpRight size={18} />
            </div>
            <div className="stat-foot">
              <span className="tiny-dot" />
              {card.foot}
            </div>
          </Link>
        ))}
      </div>
      {hiring && !reports ? (
        <>
          <div className="card pipeline-card">
            <CardHeader
              title="Your hiring journey"
              description="Every candidate, moving toward the right opportunity."
            >
              <TextLink to="/app/candidates">View pipeline</TextLink>
            </CardHeader>
            <div className="hiring-pipeline">
              {[
                "submitted",
                "screening",
                "shortlisted",
                "interview",
                "selected",
                "offer",
                "bgv",
                "joined",
              ].map((stage, i) => (
                <Link to={`/app/candidates?status=${stage}`} key={stage}>
                  <span
                    className="pipeline-step"
                    style={{ background: colors[i] }}
                  >
                    {count("candidates", [stage])}
                  </span>
                  <strong>{label(stage)}</strong>
                  <small>
                    {count("candidates", [stage]) === 1
                      ? "candidate"
                      : "candidates"}
                  </small>
                  {i < 7 && <ChevronRight size={16} />}
                </Link>
              ))}
            </div>
          </div>
          <div className="dashboard-lower">
            <RecentRecords
              records={d.recentRecords.filter(
                (r: WorkRecord) =>
                  r.kind === "candidates" || r.kind === "requirements",
              )}
              title="Latest talent activity"
            />
            <div className="card">
              <CardHeader
                title="On the calendar"
                description="Your upcoming conversations."
              />
              <div className="interview-list">
                {interviews.data?.items?.length ? (
                  interviews.data.items.map((r: WorkRecord) => (
                    <Link to={`/app/interviews/${r.id}`} key={r.id}>
                      <span className="date-tile">
                        <b>{new Date(r.payload.scheduled_at).getDate()}</b>
                        <small>
                          {new Date(r.payload.scheduled_at).toLocaleString(
                            "en",
                            { month: "short" },
                          )}
                        </small>
                      </span>
                      <div>
                        <strong>{r.title}</strong>
                        <small>
                          {formatTime(r.payload.scheduled_at)} ·{" "}
                          {r.payload.duration} min
                        </small>
                      </div>
                      <ChevronRight size={16} />
                    </Link>
                  ))
                ) : (
                  <EmptyState
                    title="Room for a new conversation"
                    description="Scheduled interviews will appear here."
                  />
                )}
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="analytics-grid">
          <div className="card growth-card">
            <CardHeader
              title={finance ? "Financial activity" : "A growing network"}
              description={
                finance
                  ? "Invoices and payment records over time."
                  : "Small connections. Lasting momentum."
              }
            >
              <select
                className="compact-select"
                aria-label="Chart period"
                value={days}
                onChange={(e) => setDays(e.target.value)}
              >
                <option value="90">Last 3 months</option>
                <option value="180">Last 6 months</option>
                <option value="365">Last 12 months</option>
              </select>
            </CardHeader>
            <div className="chart-meta">
              <div className="chart-tabs">
                {orgCount > 0 && (
                  <button
                    className={chartMode === "partners" ? "selected" : ""}
                    onClick={() => setChartMode("partners")}
                  >
                    Partner registrations
                  </button>
                )}
                <button
                  className={
                    chartMode === "procurement" || !orgCount ? "selected" : ""
                  }
                  onClick={() => setChartMode("procurement")}
                >
                  {finance ? "Invoices & payments" : "Procurement activity"}
                </button>
              </div>
              <div className="chart-key">
                <i />
                {chartMode === "partners" && orgCount
                  ? "Organizations"
                  : finance
                    ? "Invoices"
                    : "RFQs"}
              </div>
            </div>
            <div className="growth-chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={months}
                  margin={{ top: 15, right: 18, left: -22, bottom: 0 }}
                  onClick={(state: any) => {
                    const m = state?.activePayload?.[0]?.payload;
                    if (m && chartMode !== "partners")
                      navigate(
                        `/app/${finance ? "invoices" : "rfqs"}?from=${m.key}-01`,
                      );
                  }}
                >
                  <defs>
                    <linearGradient id="growthFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#88ba75" stopOpacity={0.3} />
                      <stop
                        offset="100%"
                        stopColor="#88ba75"
                        stopOpacity={0.015}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="4 5"
                    vertical={false}
                    stroke="#e9eee8"
                  />
                  <XAxis
                    dataKey="month"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#8a948b", fontSize: 11 }}
                    dy={9}
                  />
                  <YAxis
                    allowDecimals={false}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#8a948b", fontSize: 11 }}
                  />
                  <Tooltip
                    contentStyle={{
                      border: "1px solid #e3e9e2",
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                  />
                  <Area
                    isAnimationActive={false}
                    type="monotone"
                    dataKey={
                      chartMode === "partners" && orgCount && !finance
                        ? "partners"
                        : finance
                          ? "invoices"
                          : "rfqs"
                    }
                    name={
                      chartMode === "partners" && orgCount && !finance
                        ? "Partners"
                        : finance
                          ? "Invoices"
                          : "RFQs"
                    }
                    stroke="#5f9253"
                    strokeWidth={2.5}
                    fill="url(#growthFill)"
                    activeDot={{
                      r: 5,
                      fill: "#356c43",
                      stroke: "white",
                      strokeWidth: 3,
                    }}
                  />
                  {chartMode === "procurement" && (
                    <Area
                      isAnimationActive={false}
                      type="monotone"
                      dataKey={finance ? "payments" : "orders"}
                      name={finance ? "Payments" : "Orders"}
                      stroke="#adb6c9"
                      fill="transparent"
                      strokeWidth={2}
                      strokeDasharray="5 4"
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="chart-footer">
              <span>
                <span className="tiny-dot" />
                Every connection adds up.
              </span>
              <TextLink
                to={
                  orgCount && has("organizations")
                    ? "/app/organizations"
                    : "/app/rfqs"
                }
              >
                Explore records
              </TextLink>
            </div>
          </div>
          <div className="card mix-card">
            <CardHeader
              title={orgCount ? "Our partner ecosystem" : "Quotation snapshot"}
              description={
                orgCount
                  ? "Different strengths. One network."
                  : "A clear picture of your responses."
              }
            />
            <div className="donut-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    isAnimationActive={false}
                    data={distribution}
                    dataKey="value"
                    innerRadius={60}
                    outerRadius={83}
                    paddingAngle={3}
                    cornerRadius={4}
                    stroke="none"
                    onClick={(data: any) =>
                      navigate(
                        orgCount
                          ? `/app/organizations?type=${data.key}`
                          : `/app/quotations?status=${data.key}`,
                      )
                    }
                  >
                    {distribution.map((d) => (
                      <Cell key={d.key} fill={d.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="donut-center">
                <strong>{orgCount || count("quotations")}</strong>
                <span>{orgCount ? "Total partners" : "Quotations"}</span>
              </div>
            </div>
            <div className="mix-legend">
              {distribution.slice(0, 6).map((item) => (
                <Link
                  key={item.key}
                  to={
                    orgCount
                      ? `/app/organizations?type=${item.key}`
                      : `/app/quotations?status=${item.key}`
                  }
                >
                  <i style={{ background: item.color }} />
                  <span>
                    {item.name
                      .replace(" / Buyer", "")
                      .replace(" Company", "")
                      .replace(" Provider", "s")}
                  </span>
                  <b>{item.value}</b>
                </Link>
              ))}
              {distribution.length > 6 && (
                <span className="mix-other">
                  + {distribution.slice(6).reduce((n, i) => n + i.value, 0)}{" "}
                  across other partner types
                </span>
              )}
            </div>
          </div>
        </div>
      )}
      {!hiring && (
        <div className="dashboard-lower">
          <div className="card">
            <CardHeader
              title={
                d.recentPartners.length
                  ? "New connections"
                  : "Your latest business activity"
              }
              description={
                d.recentPartners.length
                  ? "Welcome the newest members of your network."
                  : "Keep your most recent commitments in view."
              }
            >
              <TextLink
                to={
                  d.recentPartners.length ? "/app/organizations" : "/app/orders"
                }
              >
                View all
              </TextLink>
            </CardHeader>
            {d.recentPartners.length ? (
              <div className="table-scroll">
                <table className="data-table partner-preview-table">
                  <thead>
                    <tr>
                      <th>Organization</th>
                      <th>Partner type</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {d.recentPartners.map((o: any) => (
                      <tr key={o.id}>
                        <td>
                          <Link
                            className="identity-cell"
                            to={`/app/organizations/${o.id}`}
                          >
                            <Avatar name={o.legal_name} />
                            <div>
                              <strong>{o.legal_name}</strong>
                              <small>{o.city}, India</small>
                            </div>
                          </Link>
                        </td>
                        <td className="subtle">
                          {organizationLabels[o.type as OrganizationType]}
                        </td>
                        <td>
                          <Badge status={o.status} />
                        </td>
                        <td>
                          <Link
                            className="icon-button"
                            aria-label={`Open ${o.legal_name}`}
                            to={`/app/organizations/${o.id}`}
                          >
                            <ArrowUpRight size={17} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <RecordRows records={d.recentRecords} />
            )}
          </div>
          <div className="card attention-card">
            <CardHeader
              title="A little attention goes a long way"
              description="Your next steps, all in one place."
            />
            <div className="attention-list">
              {has("verification") && (
                <Link to="/app/verification">
                  <span className="attention-icon peach">
                    <ShieldCheck size={20} />
                  </span>
                  <div>
                    <strong>Partner applications</strong>
                    <small>{pendingOrgs} waiting for your review</small>
                  </div>
                  <ChevronRight size={17} />
                </Link>
              )}
              {has("quotations") && (
                <Link to="/app/quotations?status=submitted">
                  <span className="attention-icon lavender">
                    <FileCheck2 size={20} />
                  </span>
                  <div>
                    <strong>Quotations to review</strong>
                    <small>
                      {count("quotations", ["submitted", "under_review"])}{" "}
                      responses ready to explore
                    </small>
                  </div>
                  <ChevronRight size={17} />
                </Link>
              )}
              {has("documents") && (
                <Link to="/app/documents">
                  <span className="attention-icon sage">
                    <FileText size={20} />
                  </span>
                  <div>
                    <strong>Keep compliance current</strong>
                    <small>
                      {d.expiringDocuments.length} documents nearing expiry
                    </small>
                  </div>
                  <ChevronRight size={17} />
                </Link>
              )}
              {has("invoices") && (
                <Link to="/app/invoices">
                  <span className="attention-icon blue">
                    <Wallet size={20} />
                  </span>
                  <div>
                    <strong>Invoice approvals</strong>
                    <small>
                      {count("invoices", ["submitted", "under_review"])}{" "}
                      invoices need a decision
                    </small>
                  </div>
                  <ChevronRight size={17} />
                </Link>
              )}
            </div>
            <div className="attention-footer">
              <ShieldCheck size={17} />
              <span>Clear actions. Confident decisions.</span>
            </div>
          </div>
        </div>
      )}
      {reports && (
        <div className="card reports-card">
          <CardHeader
            title="Operations at a glance"
            description="All-time totals in the selected currency. Counts include all currencies."
          >
            <select
              className="compact-select"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              aria-label="Report currency"
            >
              {["INR", "USD", "EUR", "GBP"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </CardHeader>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Business module</th>
                  <th>Total records</th>
                  <th>Recorded value ({currency})</th>
                  <th>Explore</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(moduleDefinitions)
                  .filter(([key]) => has(key))
                  .map(([key, def]) => (
                    <tr key={key}>
                      <td>
                        <strong>{def.label}</strong>
                      </td>
                      <td>{count(key)}</td>
                      <td>
                        {[
                          "rfqs",
                          "quotations",
                          "orders",
                          "invoices",
                          "payments",
                          "contracts",
                        ].includes(key)
                          ? money(amount(key), currency)
                          : "—"}
                      </td>
                      <td>
                        <TextLink to={`/app/${key}`}>View records</TextLink>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="card activity-card">
        <CardHeader
          title="The latest around your workspace"
          description="A transparent record of progress."
        />
        {d.activity.length ? (
          <div className="activity-timeline">
            {d.activity.slice(0, 4).map((a: any) => (
              <div key={a.id}>
                <span className="activity-mark">
                  <Check size={13} />
                </span>
                <div>
                  <p>
                    <strong>{a.actor_name}</strong>{" "}
                    {label(a.action).toLowerCase()}
                    {a.record_number ? (
                      <>
                        {" "}
                        <span>{a.record_number}</span>
                      </>
                    ) : (
                      ""
                    )}
                  </p>
                  <small>
                    {label(a.module)} · {relativeTime(a.created_at)}
                  </small>
                </div>
                {a.new_status && <Badge status={a.new_status} />}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Your story starts here"
            description="Your team’s business activity will appear here as you get started."
          />
        )}
      </div>
    </div>
  );
}
function LayersIcon() {
  return (
    <svg width="47" height="47" viewBox="0 0 47 47">
      <path d="m23.5 6 17 10-17 10-17-10 17-10Z" fill="#244d36" />
      <path
        d="m7 25 16.5 9L40 25M7 33l16.5 9L40 33"
        stroke="#244d36"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function MailIcon() {
  return <ShieldCheck size={23} />;
}
function RecordRows({ records }: { records: WorkRecord[] }) {
  return records.length ? (
    <div className="record-preview-list">
      {records.slice(0, 5).map((r) => {
        const Icon = moduleIcons[r.kind];
        return (
          <Link to={`/app/${r.kind}/${r.id}`} key={r.id}>
            <span className="record-type-icon">
              <Icon size={18} />
            </span>
            <div>
              <strong>{r.title}</strong>
              <small>
                {r.number} · {formatDate(r.updated_at)}
              </small>
            </div>
            <Badge status={r.status} />
            <ArrowUpRight size={16} />
          </Link>
        );
      })}
    </div>
  ) : (
    <EmptyState
      title="Ready for what’s next"
      description="New business records will show up here."
    />
  );
}
function RecentRecords({
  records,
  title,
}: {
  records: WorkRecord[];
  title: string;
}) {
  return (
    <div className="card">
      <CardHeader
        title={title}
        description="The introductions and opportunities that matter."
      />
      <RecordRows records={records} />
    </div>
  );
}
