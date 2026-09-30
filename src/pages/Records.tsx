import { useEffect, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock3,
  CalendarDays,
  Columns3,
  Download,
  FileText,
  GitCompareArrows,
  History,
  LayoutList,
  MapPin,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Star,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { api, queryString, useAction, useApi } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { listReturnPath } from "../lib/navigation";
import { formFields } from "../lib/form-definitions";
import {
  dateInput,
  formatDate,
  formatTime,
  money,
  relativeTime,
} from "../lib/format";
import {
  Avatar,
  BackLink,
  Badge,
  Button,
  CardHeader,
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
  TextLink,
  useToast,
} from "../components/ui";
import { moduleIcons } from "../components/icons";
import RecordForm from "../components/RecordForm";
import ActionMenu from "../components/ActionMenu";
import ScrollRegion from "../components/ScrollRegion";
import { DocumentUpload } from "./Documents";
import { ImportModal } from "../components/PartnerOperations";
import SigningPanel from "../components/SigningPanel";
import { ApprovalTrail } from "./Approvals";
import {
  label,
  moduleDefinitions,
  modules,
  type Module,
  type WorkRecord,
} from "../../shared/domain";
const prominentStatuses: Partial<Record<Module, string[]>> = {
  rfqs: ["published", "evaluation", "awarded", "closed"],
  quotations: ["submitted", "clarification", "approved", "rejected"],
  orders: ["pending_approval", "sent", "acknowledged", "fulfilled"],
  invoices: ["submitted", "approved", "paid", "rejected"],
  payments: ["pending", "processing", "completed"],
  candidates: ["submitted", "shortlisted", "interview", "joined"],
  contracts: ["review", "active", "expired"],
  tickets: ["open", "in_progress", "resolved"],
};
export default function Records() {
  const { kind: rawKind } = useParams(),
    kind = rawKind as Module,
    route = useLocation(),
    [params, setParams] = useSearchParams();
  const { user } = useAuth(),
    [importing, setImporting] = useState(false);
  const view =
    kind === "candidates" && params.get("view") === "board" ? "board" : "list";
  const returnState = { returnTo: `${route.pathname}${route.search}` };
  const definition = moduleDefinitions[kind],
    page = Number(params.get("page") || 1),
    query = params.get("q") || "",
    status = params.get("status") || "",
    creating = params.get("new") === "true",
    filtered = Boolean(
      query ||
      status ||
      params.get("from") ||
      params.get("to") ||
      params.get("currency") ||
      params.get("requirement_type"),
    );
  const debouncedQuery = useDebouncedValue(query, kind);
  const result = useApi<any>(
    `/records/${kind}?${queryString({ page, status, q: debouncedQuery, from: params.get("from"), to: params.get("to"), currency: params.get("currency"), requirement_type: params.get("requirement_type"), limit: view === "board" ? 100 : 20 })}`,
    Boolean(definition),
  );
  if (!definition)
    return (
      <EmptyState
        title="Workspace not found"
        description="Choose a workspace from the navigation."
      />
    );
  const setParam = (key: string, value: string, replace = false) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next, { replace });
  };
  const Icon = moduleIcons[kind],
    records: WorkRecord[] = result.data?.items || [];
  const financial = [
    "quotations",
    "orders",
    "contracts",
    "invoices",
    "payments",
    "catalog",
  ].includes(kind);
  return (
    <div>
      <PageHeader
        eyebrow={
          kind === "candidates" || kind === "interviews"
            ? "PEOPLE & POSSIBILITIES"
            : kind === "catalog"
              ? "YOUR EXPERTISE, ON DISPLAY"
              : kind === "tickets"
                ? "WE’RE HERE TO HELP"
                : "BUSINESS, MOVING FORWARD"
        }
        title={definition.label}
        description={definition.description}
      >
        <a
          className="button button-secondary"
          href={`/api/records/${kind}/export?${queryString({ status, q: params.get("q"), from: params.get("from"), to: params.get("to"), currency: params.get("currency"), requirement_type: params.get("requirement_type") })}`}
        >
          <Download size={16} />
          Export
        </a>
        {result.data?.can_create &&
          ["catalog", "requirements", "candidates"].includes(kind) && (
            <Button variant="secondary" onClick={() => setImporting(true)}>
              Import CSV
            </Button>
          )}
        {result.data?.can_create && (
          <Button onClick={() => setParam("new", "true")}>
            <Plus size={17} />
            {kind === "tickets"
              ? "Get support"
              : `New ${definition.singular.toLowerCase()}`}
          </Button>
        )}
      </PageHeader>
      {importing && (
        <ImportModal
          kind={kind as "catalog" | "requirements" | "candidates"}
          onClose={() => setImporting(false)}
        />
      )}
      {kind === "payments" && (
        <div className="info-banner payment-info">
          <ShieldCheck size={20} />
          <div>
            <strong>A clear view of your payments</strong>
            <p>
              Payment records track transfers made outside PartnerHub. Open an
              invoice to see the outstanding balance.
            </p>
          </div>
        </div>
      )}
      <div className="card records-card">
        <div className="records-toolbar">
          <div className="status-tabs">
            <button
              className={!status ? "active" : ""}
              onClick={() => setParam("status", "")}
            >
              All {definition.label.toLowerCase()}
              {!status && result.data && <span>{result.data.total}</span>}
            </button>
            {(prominentStatuses[kind] || definition.statuses.slice(0, 4)).map(
              (s) => (
                <button
                  key={s}
                  className={status === s ? "active" : ""}
                  onClick={() => setParam("status", s)}
                >
                  {label(s)}
                </button>
              ),
            )}
          </div>
        </div>
        <div className="table-filters">
          <SearchInput
            value={query}
            onChange={(value) => setParam("q", value, true)}
            placeholder={`Search ${definition.label.toLowerCase()}…`}
          />
          <div className="filter-right">
            <select
              className="compact-select"
              aria-label="Filter by status"
              value={status}
              onChange={(e) => setParam("status", e.target.value)}
            >
              <option value="">All statuses</option>
              {definition.statuses.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
            {financial && (
              <select
                className="compact-select"
                aria-label="Filter by currency"
                value={params.get("currency") || ""}
                onChange={(e) => setParam("currency", e.target.value)}
              >
                <option value="">All currencies</option>
                {["INR", "USD", "EUR", "GBP"].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            )}
            {kind === "requirements" && (
              <select
                className="compact-select"
                aria-label="Requirement type"
                value={params.get("requirement_type") || ""}
                onChange={(e) => setParam("requirement_type", e.target.value)}
              >
                <option value="">All requirements</option>
                <option value="procurement">Procurement</option>
                <option value="hiring">Hiring</option>
              </select>
            )}
            {kind === "candidates" && (
              <div className="view-toggle">
                <button
                  className={view === "list" ? "selected" : ""}
                  aria-label="List view"
                  aria-pressed={view === "list"}
                  onClick={() => setParam("view", "")}
                >
                  <LayoutList size={17} />
                </button>
                <button
                  className={view === "board" ? "selected" : ""}
                  aria-label="Pipeline board view"
                  aria-pressed={view === "board"}
                  onClick={() => setParam("view", "board")}
                >
                  <Columns3 size={17} />
                </button>
              </div>
            )}
          </div>
        </div>
        {(params.get("from") || params.get("to")) && (
          <div className="record-date-filter" role="status">
            <CalendarDays size={16} />
            <span>
              Created{" "}
              {params.get("from")
                ? `from ${formatDate(params.get("from"))}`
                : ""}{" "}
              {params.get("to")
                ? `through ${formatDate(params.get("to"))}`
                : ""}
            </span>
            <button
              className="text-button"
              onClick={() => {
                const next = new URLSearchParams(params);
                next.delete("from");
                next.delete("to");
                next.delete("page");
                setParams(next);
              }}
            >
              Clear date filter
            </button>
          </div>
        )}
        {result.isPending || query !== debouncedQuery ? (
          <Loading />
        ) : result.error ? (
          <ErrorState error={result.error} retry={() => result.refetch()} />
        ) : !records.length ? (
          <EmptyState
            icon={<Icon size={27} />}
            title={
              filtered
                ? "No matching records"
                : `Your ${definition.label.toLowerCase()} start here`
            }
            description={
              filtered
                ? "Try another search or clear your filters."
                : `Create your first ${definition.singular.toLowerCase()} to get things moving.`
            }
          >
            {filtered ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setParams(view === "board" ? { view: "board" } : {});
                }}
              >
                Clear filters
              </Button>
            ) : (
              result.data.can_create && (
                <Button onClick={() => setParam("new", "true")}>
                  <Plus size={16} />
                  Create {definition.singular.toLowerCase()}
                </Button>
              )
            )}
          </EmptyState>
        ) : view === "board" ? (
          <div className="kanban-board">
            {definition.statuses.map((stage) => (
              <div className="kanban-column" key={stage}>
                <div className="kanban-heading">
                  <Badge status={stage} />
                  <span>
                    {records.filter((r) => r.status === stage).length}
                  </span>
                </div>
                {records
                  .filter((r) => r.status === stage)
                  .map((r) => (
                    <Link
                      to={`/app/${kind}/${r.id}`}
                      state={returnState}
                      className="kanban-card"
                      key={r.id}
                    >
                      <Avatar name={r.title} />
                      <strong>{r.title}</strong>
                      <span>{r.payload.skills}</span>
                      <small>
                        <MapPin size={12} />
                        {r.payload.location}
                      </small>
                      <div>
                        <span>{r.payload.experience} years</span>
                        <ArrowUpRight size={15} />
                      </div>
                    </Link>
                  ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table main-record-table">
              <thead>
                <tr>
                  <th>
                    {kind === "candidates"
                      ? "Candidate"
                      : kind === "catalog"
                        ? "Product / service"
                        : `${definition.singular} details`}
                  </th>
                  <th>
                    {kind === "catalog"
                      ? "SKU / category"
                      : kind === "candidates"
                        ? "Skills & experience"
                        : "Organization"}
                  </th>
                  <th>Status</th>
                  <th>
                    {financial
                      ? "Amount"
                      : kind === "candidates"
                        ? "Location"
                        : kind === "interviews"
                          ? "Scheduled for"
                          : "Category"}
                  </th>
                  <th>
                    {kind === "contracts"
                      ? "Ends on"
                      : kind === "invoices"
                        ? "Due date"
                        : kind === "rfqs"
                          ? "Response deadline"
                          : "Updated"}
                  </th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link
                        className="identity-cell"
                        to={`/app/${kind}/${r.id}`}
                        state={returnState}
                      >
                        {kind === "candidates" ? (
                          <Avatar name={r.title} />
                        ) : (
                          <span className="record-type-icon">
                            <Icon size={19} />
                          </span>
                        )}
                        <div>
                          <strong>{r.title}</strong>
                          <small>
                            {r.number}
                            {kind === "requirements" &&
                            r.payload.requirement_type
                              ? ` · ${label(r.payload.requirement_type)}`
                              : ""}
                          </small>
                        </div>
                      </Link>
                    </td>
                    <td>
                      <div className="two-line-cell">
                        <span>
                          {kind === "catalog"
                            ? r.payload.sku
                            : kind === "candidates"
                              ? r.payload.skills
                              : (user!.organization?.type === "client" ||
                                user!.internal
                                  ? r.partner_name || r.buyer_name
                                  : r.buyer_name || r.partner_name) ||
                                "Your organization"}
                        </span>
                        <small>
                          {kind === "catalog"
                            ? r.payload.category
                            : kind === "candidates"
                              ? `${r.payload.experience} years experience`
                              : r.payload.location || "India"}
                        </small>
                      </div>
                    </td>
                    <td>
                      <Badge status={r.status} />
                    </td>
                    <td className={financial ? "amount-cell" : "subtle"}>
                      {financial
                        ? money(r.amount_minor, r.currency)
                        : kind === "candidates"
                          ? r.payload.location
                          : kind === "interviews"
                            ? formatTime(r.payload.scheduled_at)
                            : r.payload.category || "—"}
                    </td>
                    <td className="subtle nowrap">
                      {formatDate(
                        kind === "contracts"
                          ? r.payload.end_date
                          : kind === "invoices"
                            ? r.payload.due_date
                            : kind === "rfqs"
                              ? r.payload.deadline
                              : r.updated_at,
                      )}
                    </td>
                    <td>
                      <Link
                        to={`/app/${kind}/${r.id}`}
                        state={returnState}
                        className="icon-button"
                        aria-label={`Open ${r.number}`}
                      >
                        <ArrowUpRight size={17} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {result.data && (
          <Pagination
            page={page}
            total={result.data.total}
            limit={view === "board" ? 100 : 20}
            onChange={(p) => setParam("page", String(p))}
          />
        )}
      </div>
      {creating && result.data?.can_create && (
        <RecordForm
          kind={kind}
          parentId={params.get("parent") || undefined}
          onClose={() => {
            const next = new URLSearchParams(params);
            next.delete("new");
            next.delete("parent");
            setParams(next, { replace: true });
          }}
        />
      )}
    </div>
  );
}
export function RecordDetail() {
  const { kind: rawKind, id } = useParams(),
    kind = rawKind as Module,
    route = useLocation(),
    { user } = useAuth(),
    toast = useToast(),
    client = useQueryClient();
  const result = useApi<WorkRecord>(`/records/${kind}/${id}`),
    [tab, setTab] = useState("overview"),
    [editing, setEditing] = useState(false),
    [transition, setTransition] = useState(""),
    [note, setNote] = useState(""),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [upload, setUpload] = useState(false),
    [renew, setRenew] = useState(false);
  const comments = useApi<any[]>(
      `/records/${kind}/${id}/comments`,
      tab === "conversation",
    ),
    history = useApi<any>(`/records/${kind}/${id}/history`, tab === "history"),
    documents = useApi<any>(`/documents?record_id=${id}`, tab === "documents");
  const [message, setMessage] = useState(""),
    [renewDate, setRenewDate] = useState("");
  if (result.isPending) return <Loading />;
  if (result.error)
    return <ErrorState error={result.error} retry={() => result.refetch()} />;
  const r = result.data,
    definition = moduleDefinitions[kind],
    buyer = user!.internal || user!.organization?.type === "client",
    canWrite =
      user!.permissions[kind]?.includes("edit") ||
      user!.permissions[kind]?.includes("review");
  const action = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await api(
        `/records/${kind}/${id}/${renew ? "renew" : "transition"}`,
        {
          method: "POST",
          body: JSON.stringify(
            renew
              ? { end_date: renewDate, note, version: r.version }
              : { status: transition, note, version: r.version },
          ),
        },
      );
      await client.invalidateQueries();
      toast(
        renew
          ? "Renewal submitted for review."
          : updated.status !== transition
            ? "Approval recorded. The next reviewer must complete their step."
            : `${definition.singular} updated to ${label(updated.status).toLowerCase()}.`,
      );
      setTransition("");
      setRenew(false);
      setNote("");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const nextLinks: { kind: Module; title: string }[] = [];
  if (
    kind === "rfqs" &&
    !buyer &&
    ["published", "evaluation"].includes(r.status)
  )
    nextLinks.push({ kind: "quotations", title: "Submit a quotation" });
  if (kind === "quotations" && buyer && r.status === "approved")
    nextLinks.push({ kind: "orders", title: "Create purchase order" });
  if (
    kind === "orders" &&
    !buyer &&
    ["sent", "acknowledged"].includes(r.status)
  )
    nextLinks.push({ kind: "deliveries", title: "Add delivery" });
  if (
    ((kind === "orders" && ["fulfilled", "closed"].includes(r.status)) ||
      (kind === "contracts" && ["active", "renewed"].includes(r.status))) &&
    !buyer
  )
    nextLinks.push({ kind: "invoices", title: "Create invoice" });
  if (kind === "invoices" && buyer && r.status === "approved")
    nextLinks.push({ kind: "payments", title: "Record payment" });
  if (
    kind === "requirements" &&
    r.payload.requirement_type === "hiring" &&
    !buyer &&
    r.status === "open"
  )
    nextLinks.push({ kind: "candidates", title: "Submit candidate" });
  if (
    kind === "requirements" &&
    r.payload.requirement_type === "procurement" &&
    buyer &&
    r.status === "open"
  )
    nextLinks.push({ kind: "rfqs", title: "Create RFQ" });
  if (
    kind === "candidates" &&
    buyer &&
    ["shortlisted", "interview"].includes(r.status)
  )
    nextLinks.push({ kind: "interviews", title: "Schedule interview" });
  if (kind === "engagements" && !buyer && r.status === "active")
    nextLinks.push({ kind: "timesheets", title: "Submit timesheet" });
  if (kind === "contracts" && r.status === "active" && buyer)
    nextLinks.push({ kind: "engagements", title: "Create engagement" });
  if (
    ["orders", "contracts"].includes(kind) &&
    ["approved", "sent", "acknowledged", "active", "renewed"].includes(
      r.status,
    ) &&
    !buyer
  )
    nextLinks.push({ kind: "milestones", title: "Add milestone" });
  if (
    ["orders", "contracts"].includes(kind) &&
    ["fulfilled", "closed", "active", "renewed"].includes(r.status) &&
    buyer
  )
    nextLinks.push({ kind: "performance", title: "Review performance" });
  const currentIndex = definition.statuses.indexOf(r.status),
    workflow = definition.statuses.filter(
      (s) =>
        ![
          "rejected",
          "failed",
          "cancelled",
          "terminated",
          "unavailable",
          "clarification",
        ].includes(s),
    );
  const formatted = (key: string, value: any) => {
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (!value && value !== 0) return "—";
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return formatDate(value);
    if (key === "scheduled_at") return formatTime(value);
    if (
      [
        "price",
        "rate",
        "budget",
        "amount",
        "current_compensation",
        "expected_compensation",
        "offer_compensation",
        "delivery_charges",
      ].includes(key)
    )
      return money(Number(value) * 100, r.currency);
    if (
      ["documentation_url", "demo_url", "meeting_link"].includes(key) &&
      /^https?:\/\//.test(value)
    )
      return (
        <a href={value} target="_blank" rel="noreferrer" className="text-link">
          Open link
          <ArrowUpRight size={13} />
        </a>
      );
    return Array.isArray(value) ? value.join(", ") : String(value);
  };
  return (
    <div>
      <BackLink to={listReturnPath(route.state, `/app/${kind}`)}>
        {definition.label}
      </BackLink>
      <PageHeader
        eyebrow={r.number}
        title={r.title}
        description={`Created ${formatDate(r.created_at)} · Version ${r.version}`}
      >
        <Badge status={r.status} />
        {user!.permissions.ai?.includes("view") && (
          <Link className="button button-secondary" to={`/app/ai?record=${id}`}>
            Ask VS AI <ArrowUpRight size={15} />
          </Link>
        )}
        {r.can_edit && (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Edit details
          </Button>
        )}
        {kind === "rfqs" &&
          buyer &&
          user!.permissions.quotations?.includes("view") && (
            <Link
              to={`/app/rfqs/${id}/compare`}
              className="button button-secondary"
            >
              <GitCompareArrows size={17} />
              Compare quotations
            </Link>
          )}
        {nextLinks
          .filter((n) => user!.permissions[n.kind]?.includes("create"))
          .map((n) => (
            <Link
              key={n.kind}
              className="button button-primary"
              to={`/app/${n.kind}?new=true&parent=${id}`}
            >
              <Plus size={16} />
              {n.title}
            </Link>
          ))}
        {r.allowed_transitions?.length ? (
          <ActionMenu
            label="Update status"
            items={r.allowed_transitions.map((s) => ({
              value: s,
              label: label(s),
            }))}
            onSelect={(status) => {
              setTransition(status);
              setError(null);
              setNote("");
            }}
          />
        ) : null}
      </PageHeader>
      <ScrollRegion
        className="workflow-strip"
        label={`${definition.singular} workflow stages`}
      >
        {workflow.map((stage, i) => (
          <div
            key={stage}
            className={`${stage === r.status ? "current" : ""} ${definition.statuses.indexOf(stage) < currentIndex ? "done" : ""}`}
          >
            <span>
              {definition.statuses.indexOf(stage) < currentIndex ? (
                <Check size={12} />
              ) : (
                i + 1
              )}
            </span>
            <strong>{label(stage)}</strong>
            {i < workflow.length - 1 && <ChevronRight size={14} />}
          </div>
        ))}
      </ScrollRegion>
      <div className="detail-summary-grid">
        <div className="detail-summary">
          <span>Buyer / client</span>
          <strong>{r.buyer_name || "—"}</strong>
        </div>
        <div className="detail-summary">
          <span>Partner organization</span>
          <strong>{r.partner_name || r.owner_name || "—"}</strong>
        </div>
        <div className="detail-summary">
          <span>
            {kind === "invoices" ? "Outstanding balance" : "Total value"}
          </span>
          <strong>
            {money(
              kind === "invoices" ? r.outstanding_minor || 0 : r.amount_minor,
              r.currency,
            )}
          </strong>
          {kind === "invoices" && (
            <small>Invoice total {money(r.amount_minor, r.currency)}</small>
          )}
        </div>
        <div className="detail-summary">
          <span>Linked record</span>
          {r.parent_number ? (
            <strong>{r.parent_number}</strong>
          ) : (
            <strong>Independent record</strong>
          )}
        </div>
      </div>
      <div className="detail-layout">
        <div className="card detail-main">
          <div className="detail-tabs">
            {[
              { key: "overview", Icon: FileText, title: "Overview" },
              { key: "documents", Icon: Paperclip, title: "Documents" },
              {
                key: "conversation",
                Icon: MessageSquare,
                title: kind === "tickets" ? "Conversation" : "Clarifications",
              },
              { key: "history", Icon: History, title: "History & versions" },
              ...(kind === "contracts"
                ? [
                    {
                      key: "signatures",
                      Icon: ShieldCheck,
                      title: "Signatures",
                    },
                  ]
                : []),
            ].map((t) => (
              <button
                key={t.key}
                className={tab === t.key ? "active" : ""}
                onClick={() => setTab(t.key)}
              >
                <t.Icon size={16} />
                {t.title}
              </button>
            ))}
          </div>
          {tab === "signatures" && kind === "contracts" && (
            <SigningPanel record={r} />
          )}
          {tab === "overview" && (
            <div className="detail-content">
              {r.payload.description && (
                <div className="detail-description">
                  <h3>
                    {kind === "tickets"
                      ? "How we can help"
                      : "About this record"}
                  </h3>
                  <p>{r.payload.description}</p>
                </div>
              )}
              <div className="detail-fields">
                {formFields[kind]
                  .filter(
                    (f) =>
                      f.key !== "description" &&
                      r.payload[f.key] !== undefined &&
                      r.payload[f.key] !== "" &&
                      !(f.hiring && r.payload.requirement_type !== "hiring"),
                  )
                  .map((f) => (
                    <div key={f.key} className={f.full ? "span-2" : ""}>
                      <span>{f.label}</span>
                      <p>{formatted(f.key, r.payload[f.key])}</p>
                    </div>
                  ))}
              </div>
              {r.items && r.items.length > 0 && (
                <div className="detail-line-items">
                  <h3>Line items</h3>
                  <ScrollRegion className="table-scroll" label="Line items">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Item & specification</th>
                          <th>Qty</th>
                          <th>Unit price</th>
                          <th>Discount</th>
                          <th>Tax</th>
                          <th>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.items.map((i, n) => (
                          <tr key={n}>
                            <td>
                              <div className="two-line-cell">
                                <strong>{i.name}</strong>
                                <small>{i.specification}</small>
                              </div>
                            </td>
                            <td>
                              {i.quantity} {i.unit}
                            </td>
                            <td>{money(i.unit_price * 100, r.currency)}</td>
                            <td>{i.discount}%</td>
                            <td>{i.tax}%</td>
                            <td className="amount-cell">
                              {money(
                                Math.round(
                                  i.unit_price *
                                    i.quantity *
                                    (1 - i.discount / 100) *
                                    (1 + i.tax / 100) *
                                    100,
                                ),
                                r.currency,
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ScrollRegion>
                  <div className="line-total">
                    <span>Delivery charges</span>
                    <b>
                      {money(
                        Number(r.payload.delivery_charges || 0) * 100,
                        r.currency,
                      )}
                    </b>
                  </div>
                  <div className="line-total total">
                    <span>Total, including tax</span>
                    <b>{money(r.amount_minor, r.currency)}</b>
                  </div>
                </div>
              )}
              {r.payload.anonymized && (
                <div className="info-banner">
                  This candidate’s personal data has been anonymized according
                  to the configured retention policy.
                </div>
              )}
              {kind === "contracts" &&
                buyer &&
                user!.permissions.contracts?.includes("edit") &&
                ["active", "renewed", "expired"].includes(r.status) && (
                  <div className="renewal-card">
                    <RefreshCw size={25} />
                    <div>
                      <h3>Keep a good partnership going.</h3>
                      <p>
                        Create a contract renewal with an updated end date and
                        amendment notes. The new version goes through approval.
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setRenew(true);
                        setRenewDate("");
                        setNote("");
                        setError(null);
                      }}
                    >
                      Renew contract
                    </Button>
                  </div>
                )}
            </div>
          )}
          {tab === "documents" && (
            <div className="detail-content">
              <div className="inline-heading">
                <div>
                  <h3>Supporting documents</h3>
                  <p>
                    Securely shared with authorized transaction participants.
                  </p>
                </div>
                {canWrite && (
                  <Button variant="secondary" onClick={() => setUpload(true)}>
                    <Plus size={15} />
                    Add document
                  </Button>
                )}
              </div>
              {documents.isPending ? (
                <Loading />
              ) : documents.error ? (
                <FormError error={documents.error} />
              ) : documents.data?.items.length ? (
                <div className="attachment-list">
                  {documents.data.items.map((d: any) => (
                    <a href={`/api/documents/${d.id}/download`} key={d.id}>
                      <span className="file-icon">
                        <FileText size={22} />
                      </span>
                      <div>
                        <strong>{d.name}</strong>
                        <small>
                          {d.category} · Version {d.version} ·{" "}
                          {(d.size / 1024).toFixed(0)} KB
                        </small>
                      </div>
                      <Download size={17} />
                    </a>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="Everything in its place"
                  description="Add specifications, agreements, resumes or other supporting documents."
                />
              )}
            </div>
          )}
          {tab === "conversation" && (
            <div className="detail-content">
              {comments.isPending ? (
                <Loading />
              ) : comments.error ? (
                <FormError error={comments.error} />
              ) : comments.data?.length ? (
                <div className="conversation-list">
                  {comments.data.map((c) => (
                    <div key={c.id}>
                      <Avatar name={c.author} size="sm" />
                      <div>
                        <div className="message-meta">
                          <strong>{c.author}</strong>
                          <small>{relativeTime(c.created_at)}</small>
                        </div>
                        <p>{c.body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="Start a conversation"
                  description="Keep questions, clarifications and decisions together with this record."
                />
              )}
              {canWrite && (
                <form
                  className="comment-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setBusy(true);
                    setError(null);
                    try {
                      await api(`/records/${kind}/${id}/comments`, {
                        method: "POST",
                        body: JSON.stringify({ body: message }),
                      });
                      setMessage("");
                      await client.invalidateQueries();
                      toast("Message added.");
                    } catch (e) {
                      setError(e);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <FormError error={error} />
                  <textarea
                    className="input"
                    aria-label="Your message"
                    rows={3}
                    required
                    maxLength={5000}
                    placeholder="Add a question, update or clarification…"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                  <Button busy={busy}>
                    <Send size={16} />
                    Send message
                  </Button>
                </form>
              )}
            </div>
          )}
          {tab === "history" && (
            <div className="detail-content">
              {history.isPending ? (
                <Loading />
              ) : history.error ? (
                <FormError error={history.error} />
              ) : (
                <>
                  <h3>Activity & approval trail</h3>
                  <div className="record-history">
                    {history.data?.events.map((e: any) => (
                      <div key={e.id}>
                        <span className="history-dot" />
                        <div>
                          <strong>{label(e.action)}</strong>
                          <p>
                            {e.actor_name} · {formatTime(e.created_at)}
                          </p>
                          {e.previous_status &&
                            e.new_status &&
                            e.previous_status !== e.new_status && (
                              <span className="status-change">
                                <Badge status={e.previous_status} />
                                <ArrowRight size={13} />
                                <Badge status={e.new_status} />
                              </span>
                            )}
                          {e.remarks && <small>{e.remarks}</small>}
                        </div>
                      </div>
                    ))}
                  </div>
                  {history.data?.versions.length > 0 && (
                    <div className="version-list">
                      <h3>Previous versions</h3>
                      {history.data.versions.map((v: any) => (
                        <details key={v.id}>
                          <summary>
                            Version {v.version}
                            <span>
                              {v.note} · {v.author}
                            </span>
                            <ChevronRight size={16} />
                          </summary>
                          <div>
                            <p>Recorded {formatTime(v.created_at)}</p>
                            <p>
                              <strong>{v.snapshot.title}</strong>
                            </p>
                            <p>
                              {label(v.snapshot.status)} ·{" "}
                              {money(
                                v.snapshot.amount_minor,
                                v.snapshot.currency,
                              )}
                            </p>
                            {Object.entries(v.snapshot.payload || {})
                              .filter(
                                ([key, val]) =>
                                  val !== "" &&
                                  ![
                                    "consent_recorded_at",
                                    "retention_until",
                                  ].includes(key),
                              )
                              .map(([key, value]) => (
                                <p key={key}>
                                  <strong>{label(key)}:</strong>{" "}
                                  {formatted(key, value)}
                                </p>
                              ))}
                          </div>
                        </details>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        <aside className="detail-side">
          {[
            "quotations",
            "orders",
            "contracts",
            "invoices",
            "payments",
          ].includes(kind) && <ApprovalTrail record={r} />}
          <div className="card detail-help">
            <span className="help-illustration">
              <ShieldCheck size={31} />
            </span>
            <h3>Clarity at every step.</h3>
            <p>
              Updates, supporting documents and decisions stay connected to this
              record.
            </p>
            <div>
              <Check size={15} />
              Role-based approvals
            </div>
            <div>
              <Check size={15} />
              Complete activity history
            </div>
            <div>
              <Check size={15} />
              Secure document sharing
            </div>
            <Link to="/app/tickets?new=true">
              Need a hand?
              <ArrowRight size={15} />
            </Link>
          </div>
          <div className="card record-info">
            <h3>Record information</h3>
            <dl>
              <dt>Reference</dt>
              <dd>{r.number}</dd>
              <dt>Created</dt>
              <dd>{formatDate(r.created_at)}</dd>
              <dt>Last updated</dt>
              <dd>{formatDate(r.updated_at)}</dd>
              <dt>Current version</dt>
              <dd>{r.version}</dd>
              <dt>Currency</dt>
              <dd>{r.currency}</dd>
            </dl>
          </div>
        </aside>
      </div>
      {editing && (
        <RecordForm kind={kind} record={r} onClose={() => setEditing(false)} />
      )}{" "}
      {(transition || renew) && (
        <Modal
          title={
            renew
              ? "Renew this contract"
              : `Move to ${label(transition).toLowerCase()}`
          }
          description={
            renew
              ? "The renewal becomes a new version and returns to review."
              : `${r.number} · This decision will be recorded and relevant teams notified.`
          }
          onClose={() => {
            setTransition("");
            setRenew(false);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              action();
            }}
          >
            <div className="modal-body form-stack">
              <FormError error={error} />
              {renew && (
                <Field label="New end date" required>
                  <Input
                    type="date"
                    required
                    min={r.payload.end_date}
                    value={renewDate}
                    onChange={(e) => setRenewDate(e.target.value)}
                  />
                </Field>
              )}
              <Field
                label={renew ? "Amendment / renewal notes" : "Decision note"}
                required={
                  renew ||
                  [
                    "rejected",
                    "clarification",
                    "terminated",
                    "revision",
                    "failed",
                    "cancelled",
                  ].includes(transition)
                }
              >
                <textarea
                  className="input"
                  rows={4}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  required={
                    renew ||
                    [
                      "rejected",
                      "clarification",
                      "terminated",
                      "revision",
                      "failed",
                      "cancelled",
                    ].includes(transition)
                  }
                  placeholder="Share the context your team needs…"
                />
              </Field>
            </div>
            <div className="modal-footer">
              <Button
                variant="secondary"
                type="button"
                onClick={() => {
                  setTransition("");
                  setRenew(false);
                }}
              >
                Cancel
              </Button>
              <Button busy={busy} type="submit">
                {renew ? "Request renewal" : "Confirm update"}
                <Check size={16} />
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {upload && (
        <DocumentUpload recordId={r.id} onClose={() => setUpload(false)} />
      )}
    </div>
  );
}
export function Comparison() {
  const { id } = useParams(),
    result = useApi<any>(`/records/rfqs/${id}/compare`);
  if (result.isPending) return <Loading />;
  if (result.error)
    return <ErrorState error={result.error} retry={() => result.refetch()} />;
  const { rfq, quotations } = result.data,
    lowest = Math.min(...quotations.map((q: WorkRecord) => q.amount_minor));
  return (
    <div>
      <BackLink to={`/app/rfqs/${id}`}>Back to {rfq.number}</BackLink>
      <PageHeader
        eyebrow="A CLEARER WAY TO DECIDE"
        title="Compare with confidence."
        description={rfq.title}
      >
        <Link
          className="button button-secondary"
          to={`/app/ai?mode=comparison&rfq=${id}`}
        >
          Analyze with VS AI <ArrowUpRight size={16} />
        </Link>
      </PageHeader>
      <div className="info-banner">
        <GitCompareArrows size={23} />
        <p>
          A factual, side-by-side view of commercial responses. Review
          compliance, delivery and terms before choosing your partner.
        </p>
      </div>
      {!quotations.length ? (
        <div className="card">
          <EmptyState
            title="Good decisions start with responses"
            description="Submitted quotations for this RFQ will appear here."
          />
        </div>
      ) : (
        <div className="card comparison-card">
          <ScrollRegion className="table-scroll" label="Quotation comparison">
            <table className="comparison-table">
              <thead>
                <tr>
                  <th>
                    <small>{rfq.number}</small>
                    <h3>{quotations.length} partner responses</h3>
                    <span>{rfq.currency} · Tax included in totals</span>
                  </th>
                  {quotations.map((q: WorkRecord) => (
                    <th key={q.id}>
                      <Avatar name={q.partner_name || q.title} />
                      <h3>{q.partner_name}</h3>
                      <small>{q.number}</small>
                      <Badge status={q.status} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    label: "Total quotation",
                    value: (q: WorkRecord) => (
                      <div className="comparison-price">
                        {money(q.amount_minor, q.currency)}
                        {q.amount_minor === lowest && <span>Lowest total</span>}
                      </div>
                    ),
                  },
                  {
                    label: "Delivery date",
                    value: (q: WorkRecord) =>
                      formatDate(q.payload.delivery_date),
                  },
                  {
                    label: "Delivery charges",
                    value: (q: WorkRecord) =>
                      money(q.payload.delivery_charges * 100, q.currency),
                  },
                  {
                    label: "Payment terms",
                    value: (q: WorkRecord) => q.payload.payment_terms,
                  },
                  {
                    label: "Warranty",
                    value: (q: WorkRecord) =>
                      q.payload.warranty || "Not specified",
                  },
                  {
                    label: "Valid until",
                    value: (q: WorkRecord) => formatDate(q.payload.validity),
                  },
                  ...rfq.items.map((item: any, i: number) => ({
                    label: `${item.name} · ${item.quantity} ${item.unit}`,
                    value: (q: WorkRecord) =>
                      q.items?.[i] ? (
                        <>
                          {money(q.items[i].unit_price * 100, q.currency)}{" "}
                          <small>
                            per {q.items[i].unit} · {q.items[i].tax}% tax ·{" "}
                            {q.items[i].discount}% discount
                          </small>
                        </>
                      ) : (
                        "Not provided"
                      ),
                  })),
                  {
                    label: "Commercial notes",
                    value: (q: WorkRecord) =>
                      q.payload.terms || q.payload.remarks || "—",
                  },
                ].map((row) => (
                  <tr key={row.label}>
                    <th>{row.label}</th>
                    {quotations.map((q: WorkRecord) => (
                      <td key={q.id}>{row.value(q)}</td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <th>Make an informed decision</th>
                  {quotations.map((q: WorkRecord) => (
                    <td key={q.id}>
                      <Link
                        className="button button-primary"
                        to={`/app/quotations/${q.id}`}
                      >
                        Review quotation
                        <ArrowRight size={16} />
                      </Link>
                      <small>View documents, clarify or approve</small>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </ScrollRegion>
        </div>
      )}
    </div>
  );
}
