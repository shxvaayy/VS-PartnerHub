import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  Download,
  Globe2,
  Grid2X2,
  Layers3,
  LayoutList,
  Mail,
  MapPin,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { api, queryString, useApi } from "../lib/api";
import {
  Avatar,
  BackLink,
  Badge,
  Button,
  CardHeader,
  Checklist,
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
import { organizationIcons } from "../components/icons";
import { formatDate, money } from "../lib/format";
import {
  categories,
  label,
  organizationLabels,
  organizationTypes,
  type Organization,
  type OrganizationType,
} from "../../shared/domain";
import Documents from "./Documents";
import { ContactsPanel } from "../components/PartnerOperations";
export default function Organizations({
  discovery = false,
  verification = false,
}: {
  discovery?: boolean;
  verification?: boolean;
}) {
  const [params, setParams] = useSearchParams(),
    { user } = useAuth(),
    [query, setQuery] = useState(""),
    [layout, setLayout] = useState(discovery ? "grid" : "list");
  const type = params.get("type") || "",
    status = params.get("status") || (verification ? "under_review" : ""),
    page = Number(params.get("page") || 1),
    [location, setLocation] = useState(""),
    [industry, setIndustry] = useState(""),
    [certification, setCertification] = useState("");
  const [advanced, setAdvanced] = useState<Record<string, string>>({});
  const masterData = useApi<any>("/master-data");
  const result = useApi<any>(
    `/organizations?${queryString({ type, status, q: query, page, location, category: industry, certification, discovery, ...advanced })}`,
  );
  const update = (key: string, value: string) => {
    const p = new URLSearchParams(params);
    value ? p.set(key, value) : p.delete(key);
    if (key !== "page") p.delete("page");
    setParams(p);
  };
  return (
    <div>
      <PageHeader
        eyebrow={
          verification
            ? "TRUST STARTS HERE"
            : discovery
              ? "YOUR NEXT GREAT CONNECTION"
              : "YOUR BUSINESS ECOSYSTEM"
        }
        title={
          verification
            ? "A stronger foundation of trust."
            : discovery
              ? "Find your next great partner."
              : "People behind the possibilities."
        }
        description={
          verification
            ? "Review company identities, check documents and welcome new partners."
            : discovery
              ? "Discover verified organizations with the expertise to move your business forward."
              : "One place for every organization in your partner network."
        }
      >
        {!discovery && (
          <a
            href={`/api/admin/organizations-export?${queryString({ type, status, q: query })}`}
            className="button button-secondary"
          >
            <Download size={16} />
            Export directory
          </a>
        )}
        {discovery && user!.permissions.rfqs?.includes("create") && (
          <Link to="/app/rfqs?new=true" className="button button-primary">
            <Plus size={16} />
            Create RFQ
          </Link>
        )}
      </PageHeader>
      {discovery && (
        <div className="discovery-banner">
          <div>
            <span className="eyebrow">BUILT ON VERIFIED EXPERTISE</span>
            <h2>
              The right partner makes
              <br />
              all the difference.
            </h2>
            <p>
              Explore capabilities, compare experience, and start a conversation
              through an RFQ.
            </p>
          </div>
          <div className="discovery-art">
            <span>
              <Building2 size={34} />
            </span>
            <span>
              <ShieldCheck size={24} />
            </span>
            <span>
              <UsersRound size={28} />
            </span>
          </div>
        </div>
      )}
      {verification && (
        <div className="info-banner">
          <ShieldCheck size={22} />
          <div>
            <strong>Review documents before approving a company</strong>
            <p>
              The platform checks email verification and required document
              approvals before granting access to transactions.
            </p>
          </div>
        </div>
      )}
      <div className="card directory-card">
        {verification && (
          <div className="records-toolbar">
            <div className="status-tabs">
              {[
                ["under_review", "Ready for review"],
                ["registered", "Email verification pending"],
                ["clarification", "Needs clarification"],
                ["verified", "Verified"],
                ["active", "Approved"],
                ["rejected", "Rejected"],
              ].map(([value, text]) => (
                <button
                  key={value}
                  className={status === value ? "active" : ""}
                  onClick={() => update("status", value)}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="directory-filters">
          <SearchInput
            placeholder="Search companies, products, expertise, NAICS or SIC…"
            value={query}
            onChange={(v) => {
              setQuery(v);
              update("page", "1");
            }}
          />
          <div className="directory-filter-row">
            <select
              className="compact-select"
              aria-label="Organization type"
              value={type}
              onChange={(e) => update("type", e.target.value)}
            >
              <option value="">All partner types</option>
              {organizationTypes.map((t) => (
                <option key={t} value={t}>
                  {organizationLabels[t]}
                </option>
              ))}
            </select>
            <select
              className="compact-select"
              aria-label="Industry"
              value={industry}
              onChange={(e) => {
                setIndustry(e.target.value);
                update("page", "1");
              }}
            >
              <option value="">All industries</option>
              {(
                masterData.data?.industry?.map((c: any) => c.label) ||
                categories
              ).map((c: string) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <Input
              aria-label="Location filter"
              placeholder="Location"
              value={location}
              onChange={(e) => {
                setLocation(e.target.value);
                update("page", "1");
              }}
            />
            <Input
              aria-label="Certification filter"
              list="discovery-certifications"
              placeholder="Certification"
              value={certification}
              onChange={(e) => {
                setCertification(e.target.value);
                update("page", "1");
              }}
            />
            <datalist id="discovery-certifications">
              {masterData.data?.certification?.map((c: any) => (
                <option key={c.id} value={c.label} />
              ))}
            </datalist>
            {!discovery && !verification && (
              <select
                className="compact-select"
                aria-label="Verification status"
                value={status}
                onChange={(e) => update("status", e.target.value)}
              >
                <option value="">All statuses</option>
                {[
                  "active",
                  "under_review",
                  "registered",
                  "clarification",
                  "rejected",
                  "suspended",
                  "archived",
                ].map((s) => (
                  <option key={s} value={s}>
                    {label(s)}
                  </option>
                ))}
              </select>
            )}
            <div className="view-toggle">
              <button
                className={layout === "list" ? "selected" : ""}
                aria-label="Directory list view"
                onClick={() => setLayout("list")}
              >
                <LayoutList size={17} />
              </button>
              <button
                className={layout === "grid" ? "selected" : ""}
                aria-label="Directory grid view"
                onClick={() => setLayout("grid")}
              >
                <Grid2X2 size={17} />
              </button>
            </div>
          </div>
        </div>
        <details className="discovery-advanced">
          <summary>Technology, products and business identifiers</summary>
          <div className="form-grid">
            {[
              ["technology", "Technology"],
              ["product", "Products"],
              ["service", "Services"],
              ["naics", "NAICS"],
              ["sic", "SIC"],
              ["business_type", "Business type"],
            ].map(([key, title]) => (
              <Field key={key} label={title}>
                <Input
                  value={advanced[key] || ""}
                  onChange={(e) => {
                    setAdvanced((v) => ({ ...v, [key]: e.target.value }));
                    update("page", "1");
                  }}
                  maxLength={150}
                />
              </Field>
            ))}
          </div>
        </details>
        {result.isPending ? (
          <Loading />
        ) : result.error ? (
          <ErrorState error={result.error} retry={() => result.refetch()} />
        ) : !result.data.items.length ? (
          <EmptyState
            title="Your next connection is out there"
            description="Try widening your search or adjusting the filters."
          />
        ) : layout === "grid" ? (
          <div className="organization-grid">
            {result.data.items.map((o: Organization) => (
              <div className="organization-card" key={o.id}>
                <div className="organization-card-top">
                  <Avatar
                    name={o.legal_name}
                    size="lg"
                    color={o.details.logo_color}
                  />
                  <Badge status={o.status} />
                </div>
                <Link to={`/app/organizations/${o.id}`}>
                  <h3>{o.legal_name}</h3>
                </Link>
                <span className="organization-card-type">
                  {organizationLabels[o.type]}
                  <span>·</span>
                  {o.industry}
                </span>
                <p>
                  {o.details.description ||
                    o.details.capabilities ||
                    "Explore this organization’s capabilities and business profile."}
                </p>
                <div className="company-tags">
                  {(o.details.certifications || "")
                    .split(",")
                    .slice(0, 2)
                    .map(
                      (c: string) =>
                        c.trim() && (
                          <span key={c}>
                            <ShieldCheck size={12} />
                            {c.trim()}
                          </span>
                        ),
                    )}
                </div>
                <div className="organization-card-footer">
                  <span>
                    <MapPin size={14} />
                    {o.city}
                  </span>
                  <TextLink to={`/app/organizations/${o.id}`}>
                    View profile
                  </TextLink>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Organization</th>
                  <th>Type</th>
                  <th>Industry</th>
                  <th>Location</th>
                  <th>Status</th>
                  <th>Joined</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {result.data.items.map((o: Organization) => (
                  <tr key={o.id}>
                    <td>
                      <Link
                        className="identity-cell"
                        to={`/app/organizations/${o.id}`}
                      >
                        <Avatar name={o.legal_name} />
                        <div>
                          <strong>{o.legal_name}</strong>
                          <small>{o.number}</small>
                        </div>
                      </Link>
                    </td>
                    <td className="subtle">{organizationLabels[o.type]}</td>
                    <td className="subtle">{o.industry}</td>
                    <td className="subtle">{o.city}</td>
                    <td>
                      <Badge status={o.status} />
                    </td>
                    <td className="subtle nowrap">
                      {formatDate(o.created_at)}
                    </td>
                    <td>
                      <Link
                        to={`/app/organizations/${o.id}`}
                        className="button button-ghost"
                      >
                        {verification ? "Review" : "View"}
                        <ChevronRight size={14} />
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
            total={result.data.total}
            page={page}
            onChange={(p) => update("page", String(p))}
          />
        )}
      </div>
    </div>
  );
}
export function OrganizationProfile({ own = false }: { own?: boolean }) {
  const { id: paramId } = useParams(),
    { user, refresh } = useAuth(),
    id = own ? user!.organization_id : paramId,
    toast = useToast(),
    client = useQueryClient();
  const result = useApi<any>(`/organizations/${id}`, Boolean(id)),
    [tab, setTab] = useState("about"),
    [edit, setEdit] = useState(false),
    [decision, setDecision] = useState(""),
    [note, setNote] = useState(""),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  if (!id)
    return (
      <EmptyState
        title="Your internal VS workspace"
        description="Manage your account preferences in Settings, or explore the partner directory."
      >
        <Link className="button button-primary" to="/app/settings">
          Account settings
        </Link>
      </EmptyState>
    );
  if (result.isPending) return <Loading />;
  if (result.error)
    return <ErrorState error={result.error} retry={() => result.refetch()} />;
  const org = result.data as Organization & { catalog: any[] },
    mine = user!.organization_id === id,
    canEdit =
      (mine && user!.permissions.profile?.includes("edit")) ||
      (user!.internal && user!.permissions.verification?.includes("edit")),
    canReview =
      user!.internal && user!.permissions.verification?.includes("review"),
    canDocuments =
      mine || (user!.internal && user!.permissions.documents?.includes("view"));
  const statusActions: Record<string, string[]> = {
    registered: ["under_review", "clarification", "rejected"],
    under_review: ["active", "verified", "clarification", "rejected"],
    clarification: ["under_review", "active", "rejected"],
    verified: ["active", "clarification"],
    active: [
      "under_review",
      ...(user!.role === "super_admin" ? ["suspended"] : []),
    ],
    rejected: ["under_review"],
    suspended: user!.role === "super_admin" ? ["active", "archived"] : [],
    archived: ["under_review"],
  };
  const completeness = [
    Boolean(org.legal_name),
    Boolean(org.contact_phone),
    Boolean(org.website),
    Boolean(org.details.description),
    Boolean(org.details.capabilities),
    Boolean(org.details.locations),
    Boolean(org.details.pan),
    Boolean(org.details.certifications),
  ].filter(Boolean).length;
  return (
    <div>
      {!own && (
        <BackLink to={canReview ? "/app/verification" : "/app/organizations"}>
          {canReview ? "Verification center" : "Partner directory"}
        </BackLink>
      )}
      <div className="company-hero">
        <div className="company-hero-pattern" />
        <div className="company-hero-body">
          {org.logo_url ? (
            <img
              className="company-logo"
              src={org.logo_url}
              alt={`${org.legal_name} logo`}
            />
          ) : (
            <Avatar
              name={org.legal_name}
              size="lg"
              color={org.details.logo_color}
            />
          )}
          <div>
            <div className="company-title">
              <h1>{org.legal_name}</h1>
              <Badge status={org.status} />
            </div>
            <p>
              {organizationLabels[org.type]}
              <span>·</span>
              {org.industry}
              <span>·</span>
              <MapPin size={14} />
              {org.city}, {org.country}
            </p>
            <div className="company-meta">
              <span>{org.number}</span>
              <span>Member since {formatDate(org.created_at)}</span>
            </div>
          </div>
          <div className="company-hero-actions">
            {canEdit && (
              <label className="button button-secondary logo-upload">
                Upload logo
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  className="sr-only"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const form = new FormData();
                    form.append("file", file);
                    try {
                      await api(`/organizations/${id}/logo`, {
                        method: "POST",
                        body: form,
                      });
                      await client.invalidateQueries();
                      toast("Company logo updated.");
                    } catch (err) {
                      toast((err as Error).message, "error");
                    }
                    e.target.value = "";
                  }}
                />
              </label>
            )}
            {canEdit && (
              <Button variant="secondary" onClick={() => setEdit(true)}>
                Edit profile
              </Button>
            )}
            {canReview && (
              <details className="action-menu">
                <summary className="button button-primary">
                  <ShieldCheck size={16} />
                  Verification decision
                  <ChevronRight size={14} />
                </summary>
                <div>
                  {(statusActions[org.status] || []).map((s) => (
                    <button
                      key={s}
                      onClick={(e) => {
                        e.currentTarget
                          .closest("details")
                          ?.removeAttribute("open");
                        setDecision(s);
                        setError(null);
                        setNote("");
                      }}
                    >
                      {s === "active"
                        ? org.status === "suspended"
                          ? "Reactivate organization"
                          : "Approve organization"
                        : label(s)}
                      <ArrowRight size={14} />
                    </button>
                  ))}
                </div>
              </details>
            )}
          </div>
        </div>
      </div>
      {org.details.verification_note && (
        <div className="notice-banner">
          <ShieldCheck size={22} />
          <div>
            <strong>A note from the verification team</strong>
            <span>{org.details.verification_note}</span>
          </div>
          {mine && ["clarification", "rejected"].includes(org.status) && (
            <Button
              variant="secondary"
              busy={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(`/organizations/${id}/resubmit`, {
                    method: "POST",
                  });
                  await client.invalidateQueries();
                  toast("Application resubmitted for review.");
                } catch (e) {
                  toast((e as Error).message, "error");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Resubmit application
            </Button>
          )}
        </div>
      )}
      <div className="profile-layout">
        <div className="card">
          <div className="detail-tabs">
            {[
              ["about", "Company overview"],
              ["capabilities", "Capabilities"],
              ["catalog", "Products & services"],
              ...(canDocuments ? [["documents", "Documents & KYC"]] : []),
              ...((mine || user!.internal) &&
              user!.permissions.contacts?.includes("view")
                ? [["contacts", "Authorized contacts"]]
                : []),
            ].map(([key, text]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={tab === key ? "active" : ""}
              >
                {text}
              </button>
            ))}
          </div>
          {tab === "about" && (
            <div className="detail-content">
              <div className="detail-description">
                <h3>About {org.trade_name || org.legal_name}</h3>
                <p>
                  {org.details.description ||
                    "Add a company introduction to help partners understand your business."}
                </p>
              </div>
              <div className="detail-fields">
                {[
                  ["Company type", org.details.company_type],
                  ["Industry", org.industry],
                  ["Organization type", organizationLabels[org.type]],
                  ["Locations served", org.details.locations],
                  ["Years of experience", org.details.experience],
                  ["NAICS", org.details.naics],
                  ["SIC", org.details.sic],
                  ["Registered address", org.details.address],
                  ["PAN", org.details.pan],
                  ["GSTIN", org.details.gst],
                  ["CIN / registration", org.details.cin],
                  ["Udyam / MSME", org.details.udyam],
                ]
                  .filter(([, v]) => v !== undefined && v !== "")
                  .map(([name, value]) => (
                    <div key={name}>
                      <span>{name}</span>
                      <p>{value}</p>
                    </div>
                  ))}
              </div>
            </div>
          )}
          {tab === "capabilities" && (
            <div className="detail-content">
              <h3>What we bring to the partnership</h3>
              <div className="capability-sections">
                {[
                  "capabilities",
                  "products",
                  "services",
                  "domains",
                  "hiring_types",
                  "recruiters",
                  "resources",
                  "technologies",
                  "integrations",
                  "lead_time",
                  "moq",
                  "delivery_locations",
                  "warehouse",
                  "pricing_model",
                  "procurement_categories",
                  "payment_terms",
                  "certifications",
                ]
                  .filter(
                    (k) =>
                      org.details[k] !== undefined && org.details[k] !== "",
                  )
                  .map((key) => (
                    <div key={key}>
                      <span>{label(key)}</span>
                      <p>
                        {Array.isArray(org.details[key])
                          ? org.details[key].join(" · ")
                          : org.details[key]}
                      </p>
                    </div>
                  ))}
              </div>
            </div>
          )}
          {tab === "catalog" && (
            <div className="detail-content">
              {org.catalog?.length ? (
                <div className="profile-catalog">
                  {org.catalog.map((item: any) => (
                    <div key={item.id}>
                      <span className="catalog-item-icon">
                        <Layers3 size={24} />
                      </span>
                      <div>
                        <span className="eyebrow">
                          {item.payload.item_type} · {item.payload.sku}
                        </span>
                        <h3>{item.title}</h3>
                        <p>{item.payload.description}</p>
                        <div className="catalog-details">
                          <span>
                            {money(item.amount_minor, item.currency)} /{" "}
                            {item.payload.unit}
                          </span>
                          <span>MOQ {item.payload.moq}</span>
                          <span>{item.payload.lead_time}</span>
                        </div>
                        {item.payload.item_type === "Technology" &&
                          user!.permissions.demos?.includes("create") && (
                            <Link
                              className="button button-secondary"
                              to={`/app/demos?new=true&parent=${item.id}`}
                            >
                              <Sparkles size={15} />
                              Request a demo
                            </Link>
                          )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="Expertise worth sharing"
                  description={
                    mine
                      ? "Add products or services in your catalog workspace to showcase them here."
                      : "This partner has not published catalog items yet."
                  }
                >
                  {mine && user!.permissions.catalog?.includes("create") && (
                    <Link
                      className="button button-primary"
                      to="/app/catalog?new=true"
                    >
                      <Plus size={16} />
                      Add to catalog
                    </Link>
                  )}
                </EmptyState>
              )}
            </div>
          )}
          {tab === "documents" && canDocuments && (
            <Documents organizationId={id} embedded />
          )}
          {tab === "contacts" && (
            <ContactsPanel
              organizationId={id}
              canEdit={Boolean(
                canEdit && user!.permissions.contacts?.includes("edit"),
              )}
            />
          )}
        </div>
        <aside className="profile-sidebar">
          {mine && canEdit && (
            <div className="card marketplace-settings">
              <h3>Public partner directory</h3>
              <p>
                Let new businesses discover your company name, capabilities,
                location, website and logo. Private documents and authorized
                contacts stay within your workspace.
              </p>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={Boolean(org.marketplace_visible)}
                  disabled={
                    busy ||
                    (!org.marketplace_visible && org.status !== "active")
                  }
                  onChange={async (e) => {
                    setBusy(true);
                    try {
                      await api(`/organizations/${id}/marketplace`, {
                        method: "PATCH",
                        body: JSON.stringify({ visible: e.target.checked }),
                      });
                      await client.invalidateQueries();
                      toast("Public visibility updated.");
                    } catch (err) {
                      toast((err as Error).message, "error");
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
                Publish my verified business profile
              </label>
              {org.status !== "active" && (
                <small>
                  Available after VS verifies and approves your company.
                </small>
              )}
              {org.marketplace_visible && (
                <Link className="text-link" to={`/partners/${id}`}>
                  View public profile <ArrowUpRight size={15} />
                </Link>
              )}
            </div>
          )}
          {mine && (
            <div className="card profile-progress">
              <div className="inline-heading">
                <h3>Your profile, at its best</h3>
                <span>{Math.round((completeness / 8) * 100)}%</span>
              </div>
              <div className="progress-track">
                <span style={{ width: `${(completeness / 8) * 100}%` }} />
              </div>
              <p>A complete profile helps the right partners find you.</p>
              <Checklist
                items={[
                  { text: "Company identity", done: Boolean(org.legal_name) },
                  {
                    text: "Company introduction",
                    done: Boolean(org.details.description),
                  },
                  {
                    text: "Capabilities & locations",
                    done: Boolean(
                      org.details.capabilities && org.details.locations,
                    ),
                  },
                  {
                    text: "Website & certifications",
                    done: Boolean(org.website && org.details.certifications),
                  },
                ]}
              />
            </div>
          )}
          <div className="card company-contact">
            <h3>Let’s stay connected</h3>
            {org.website && (
              <a href={org.website} target="_blank" rel="noreferrer">
                <Globe2 size={17} />
                <span>{org.website.replace(/^https?:\/\//, "")}</span>
                <ArrowUpRight size={14} />
              </a>
            )}
            {org.contact_email && (
              <div>
                <Mail size={17} />
                <span>{org.contact_email}</span>
              </div>
            )}
            {org.contact_phone && (
              <div>
                <Phone size={17} />
                <span>{org.contact_phone}</span>
              </div>
            )}
            <div>
              <MapPin size={17} />
              <span>
                {org.city}, {org.country}
              </span>
            </div>
            {org.contact_name && (
              <div>
                <UsersRound size={17} />
                <span>{org.contact_name}</span>
              </div>
            )}
          </div>
          <div className="card verified-note">
            <ShieldCheck size={30} />
            <h3>
              {org.status === "active"
                ? "A verified connection."
                : "Trust is a process."}
            </h3>
            <p>
              {org.status === "active"
                ? "This organization has completed the VS company verification process. Review transaction terms and current compliance before engaging."
                : "Company and document checks help build a reliable business network."}
            </p>
          </div>
        </aside>
      </div>
      {edit && (
        <EditProfile organization={org} onClose={() => setEdit(false)} />
      )}
      {decision && (
        <Modal
          title={
            decision === "active"
              ? "Approve this organization"
              : `${label(decision)} · organization`
          }
          description={`${org.legal_name} · The organization will be notified of your decision.`}
          onClose={() => setDecision("")}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                await api(`/organizations/${id}/status`, {
                  method: "POST",
                  body: JSON.stringify({ status: decision, note }),
                });
                await client.invalidateQueries();
                await refresh();
                toast("Organization status updated.");
                setDecision("");
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="modal-body form-stack">
              <FormError error={error} />
              {decision === "active" && (
                <div className="info-banner">
                  <ShieldCheck size={22} />
                  <p>
                    Company email and all required documents must be verified
                    before approval.
                  </p>
                </div>
              )}
              <Field
                label="Verification notes"
                required={[
                  "clarification",
                  "rejected",
                  "suspended",
                  "archived",
                ].includes(decision)}
              >
                <textarea
                  className="input"
                  rows={4}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  required={[
                    "clarification",
                    "rejected",
                    "suspended",
                    "archived",
                  ].includes(decision)}
                  placeholder="Share a helpful explanation for the organization…"
                />
              </Field>
            </div>
            <div className="modal-footer">
              <Button
                variant="secondary"
                type="button"
                onClick={() => setDecision("")}
              >
                Cancel
              </Button>
              <Button busy={busy} type="submit">
                <Check size={16} />
                Confirm decision
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
function EditProfile({
  organization: org,
  onClose,
}: {
  organization: Organization;
  onClose: () => void;
}) {
  const [data, setData] = useState<any>({
      ...org,
      details: { ...org.details },
    }),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    client = useQueryClient(),
    toast = useToast(),
    { refresh } = useAuth();
  const masterData = useApi<any>("/master-data");
  const rootFields = [
    "legal_name",
    "trade_name",
    "industry",
    "city",
    "country",
    "website",
    "contact_name",
    "contact_email",
    "contact_phone",
  ];
  const detailFields = [
    "company_type",
    "address",
    "postal_code",
    "pan",
    "gst",
    "cin",
    "udyam",
    "company_email",
    "linkedin",
    "description",
    "capabilities",
    "products",
    "services",
    "locations",
    "certifications",
    "naics",
    "sic",
    "rate_card",
    "resources",
    "bank_name",
    "bank_account_last4",
    "bank_ifsc",
    ...(["recruitment", "staffing"].includes(org.type)
      ? ["domains", "experience", "recruiters"]
      : []),
    ...(org.type === "supplier"
      ? ["moq", "lead_time", "delivery_locations", "warehouse"]
      : []),
    ...(org.type === "technology_partner"
      ? ["technologies", "integrations", "documentation_url", "partner_contact"]
      : []),
    ...(org.type === "client"
      ? [
          "procurement_categories",
          "annual_budget",
          "payment_terms",
          "partner_contact",
        ]
      : []),
    ...(org.type === "service_provider"
      ? ["pricing_model", "payment_terms"]
      : []),
  ];
  return (
    <Modal
      title="Make your profile work for you"
      description="Keep your company information accurate. Legal identity changes trigger re-verification."
      onClose={onClose}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const body = {
              type: org.type,
              ...Object.fromEntries(rootFields.map((k) => [k, data[k] || ""])),
              details: data.details,
            };
            await api(`/organizations/${org.id}`, {
              method: "PATCH",
              body: JSON.stringify(body),
            });
            await client.invalidateQueries();
            await refresh();
            toast("Company profile updated.");
            onClose();
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          <FormError error={error} />
          <div className="form-grid">
            <datalist id="profile-master-industries">
              {masterData.data?.industry?.map((v: any) => (
                <option key={v.id} value={v.label} />
              ))}
            </datalist>
            <datalist id="profile-master-certifications">
              {masterData.data?.certification?.map((v: any) => (
                <option key={v.id} value={v.label} />
              ))}
            </datalist>
            {rootFields.map((key) => (
              <Field
                label={label(key)}
                key={key}
                required={!["trade_name", "website"].includes(key)}
              >
                <Input
                  name={key}
                  list={
                    key === "industry" ? "profile-master-industries" : undefined
                  }
                  type={
                    key === "website"
                      ? "url"
                      : key === "contact_email"
                        ? "email"
                        : "text"
                  }
                  value={data[key] || ""}
                  onChange={(e) =>
                    setData((d: any) => ({ ...d, [key]: e.target.value }))
                  }
                  required={!["trade_name", "website"].includes(key)}
                />
              </Field>
            ))}
            {detailFields.map((key) => (
              <Field
                label={label(key)}
                key={key}
                className={
                  ["description", "capabilities"].includes(key) ? "span-2" : ""
                }
                hint={
                  key === "bank_account_last4"
                    ? "Enter only the last four digits."
                    : undefined
                }
              >
                {["description", "capabilities"].includes(key) ? (
                  <textarea
                    className="input"
                    rows={3}
                    value={data.details[key] || ""}
                    onChange={(e) =>
                      setData((d: any) => ({
                        ...d,
                        details: { ...d.details, [key]: e.target.value },
                      }))
                    }
                  />
                ) : (
                  <Input
                    name={key}
                    list={
                      key === "certifications"
                        ? "profile-master-certifications"
                        : undefined
                    }
                    value={data.details[key] ?? ""}
                    type={
                      ["experience", "moq"].includes(key)
                        ? "number"
                        : key === "company_email"
                          ? "email"
                          : "text"
                    }
                    onChange={(e) =>
                      setData((d: any) => ({
                        ...d,
                        details: {
                          ...d.details,
                          [key]: ["experience", "moq"].includes(key)
                            ? Number(e.target.value)
                            : e.target.value,
                        },
                      }))
                    }
                  />
                )}
              </Field>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={busy}>
            Save company profile
            <Check size={16} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}
