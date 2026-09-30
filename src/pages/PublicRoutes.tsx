import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Globe2,
  Handshake,
  MapPin,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { api, queryString, useApi } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  Avatar,
  BackLink,
  Badge,
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
import { PublicFooter, PublicHeader } from "./Home";
import { AuthFrame } from "./Public";
import {
  organizationLabels,
  organizationTypes,
  type OrganizationType,
} from "../../shared/domain";
import { formatDate } from "../lib/format";

export function PartnerNetwork() {
  const [q, setQ] = useState(""),
    [type, setType] = useState(""),
    [location, setLocation] = useState(""),
    [page, setPage] = useState(1);
  const result = useApi<any>(
    `/public/partners?${queryString({ q, type, location, page, limit: 12 })}`,
  );
  return (
    <div className="hub-public-page">
      <PublicHeader />
      <main id="public-main" className="hub-public-content">
        <PageHeader
          eyebrow="THE VS PARTNER NETWORK"
          title="Find your next connection."
          description="Explore verified businesses that have chosen to share their capabilities publicly."
        >
          <Link className="button button-primary" to="/register">
            Join the network <ArrowUpRight size={16} />
          </Link>
        </PageHeader>
        <div className="card">
          <div className="directory-filters">
            <SearchInput
              value={q}
              onChange={(v) => {
                setQ(v);
                setPage(1);
              }}
              placeholder="Search companies, capabilities or expertise…"
            />
            <div className="directory-filter-row">
              <select
                className="input"
                aria-label="Partner type"
                value={type}
                onChange={(e) => {
                  setType(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All partner types</option>
                {organizationTypes.map((t) => (
                  <option key={t} value={t}>
                    {organizationLabels[t]}
                  </option>
                ))}
              </select>
              <Input
                aria-label="Partner location"
                placeholder="City or location served"
                value={location}
                onChange={(e) => {
                  setLocation(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>
          {result.isPending ? (
            <Loading />
          ) : result.error ? (
            <ErrorState error={result.error} retry={result.refetch} />
          ) : result.data.items.length ? (
            <div className="public-partner-grid">
              {result.data.items.map((org: any) => (
                <article className="public-partner-card" key={org.id}>
                  <div className="operations-heading">
                    {org.logo_url ? (
                      <img
                        src={org.logo_url}
                        className="company-logo small"
                        alt={`${org.legal_name} logo`}
                      />
                    ) : (
                      <Avatar name={org.legal_name} />
                    )}
                    <Badge status="verified" />
                  </div>
                  <div>
                    <h2>{org.legal_name}</h2>
                    <p>
                      {organizationLabels[org.type as OrganizationType]} ·{" "}
                      {org.industry}
                    </p>
                  </div>
                  <p>
                    {String(
                      org.details.description || org.details.capabilities || "",
                    ).slice(0, 200)}
                  </p>
                  <p>
                    <MapPin size={14} /> {org.city}, {org.country}
                  </p>
                  <Link className="text-link" to={`/partners/${org.id}`}>
                    Explore capabilities <ArrowUpRight size={15} />
                  </Link>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title={
                q || type || location
                  ? "No matching public profiles"
                  : "Your next partnership starts here"
              }
              description={
                q || type || location
                  ? "Try a different capability, partner type or location."
                  : "Organizations appear here after VS verification and their choice to publish a profile. Register your business to become part of the network."
              }
            >
              <Link to="/register" className="button button-primary">
                Register your organization <ArrowRight size={16} />
              </Link>
            </EmptyState>
          )}
          <Pagination
            page={page}
            limit={12}
            total={result.data?.total || 0}
            onChange={setPage}
          />
        </div>
        <div className="info-banner space-top">
          <ShieldCheck size={23} />
          <div>
            <strong>Looking for a sourcing partner?</strong>
            <p>
              Sign in to your buyer workspace for detailed partner discovery,
              RFQ invitations and quotation comparison.
            </p>
          </div>
          <Link className="button button-secondary" to="/app/discovery">
            Open discovery
          </Link>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
export function PublicPartner() {
  const { id } = useParams(),
    result = useApi<any>(`/public/partners/${id}`);
  const org = result.data;
  return (
    <div className="hub-public-page">
      <PublicHeader />
      <main id="public-main" className="hub-public-content">
        <BackLink to="/partners">Partner network</BackLink>
        {result.isPending ? (
          <Loading />
        ) : result.error ? (
          <ErrorState error={result.error} retry={result.refetch} />
        ) : (
          <article className="card public-partner-profile">
            <div className="operations-heading">
              {org.logo_url ? (
                <img
                  src={org.logo_url}
                  className="company-logo"
                  alt={`${org.legal_name} logo`}
                />
              ) : (
                <Avatar name={org.legal_name} size="lg" />
              )}
              <Badge status="verified" />
            </div>
            <h1>{org.legal_name}</h1>
            <p>
              {organizationLabels[org.type as OrganizationType]} ·{" "}
              {org.industry} · {org.city}, {org.country}
            </p>
            <div className="detail-fields">
              {[
                ["About the business", "description"],
                ["Capabilities", "capabilities"],
                ["Products", "products"],
                ["Services", "services"],
                ["Locations served", "locations"],
                ["Certifications", "certifications"],
                ["Technologies", "technologies"],
                ["Recruitment domains", "domains"],
                ["Integrations", "integrations"],
              ]
                .filter(([, key]) => org.details[key])
                .map(([title, key]) => (
                  <div key={key}>
                    <span>{title}</span>
                    <p>{org.details[key]}</p>
                  </div>
                ))}
            </div>
            {org.website && (
              <a
                href={org.website}
                target="_blank"
                rel="noreferrer"
                className="text-link"
              >
                <Globe2 size={15} />
                Company website <ArrowUpRight size={15} />
              </a>
            )}
            <div>
              <Link
                className="button button-primary"
                to={`/app/organizations/${org.id}`}
              >
                Connect through your workspace <ArrowRight size={16} />
              </Link>
            </div>
          </article>
        )}
      </main>
      <PublicFooter />
    </div>
  );
}
export function Contact() {
  const [reference, setReference] = useState(""),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const r = await api<{ reference: string }>("/public/contact", {
        method: "POST",
        body: JSON.stringify({
          ...Object.fromEntries(form),
          consent: form.has("consent"),
        }),
      });
      setReference(r.reference);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="hub-public-page">
      <PublicHeader />
      <main id="public-main" className="hub-public-content">
        <div className="public-contact-grid">
          <div className="public-contact-copy">
            <span className="hub-eyebrow">START A CONVERSATION</span>
            <h1>
              Good business begins
              <br />
              with a connection.
            </h1>
            <p>
              Tell us about your organization, partnership needs or a question
              about getting started. Your enquiry goes directly into the VS
              team’s support workspace.
            </p>
            <div className="public-contact-points">
              <div>
                <Handshake size={23} />
                Partnership and onboarding enquiries
              </div>
              <div>
                <Building2 size={23} />
                Procurement and supplier collaboration
              </div>
              <div>
                <UsersRound size={23} />
                Recruitment and technology partnerships
              </div>
            </div>
            <p className="space-top">
              Already a partner?{" "}
              <Link className="text-link" to="/app/tickets">
                Open a support ticket <ArrowUpRight size={14} />
              </Link>
            </p>
          </div>
          <div className="card public-contact-form">
            {reference ? (
              <div className="success-panel">
                <CheckCircle2 size={38} />
                <h2>Your enquiry is with the VS team.</h2>
                <p>
                  Save your reference: <strong>{reference}</strong>. The team
                  can review your message and contact you at the email address
                  you provided.
                </p>
                <Link className="button button-primary" to="/">
                  Back to PartnerHub <ArrowRight size={16} />
                </Link>
              </div>
            ) : (
              <form onSubmit={submit} className="form-stack">
                <FormError error={error} />
                <Field label="Your name" required>
                  <Input
                    name="name"
                    required
                    minLength={2}
                    maxLength={180}
                    autoComplete="name"
                  />
                </Field>
                <Field label="Work email" required>
                  <Input
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                  />
                </Field>
                <Field label="Organization" required>
                  <Input
                    name="company"
                    required
                    minLength={2}
                    maxLength={255}
                    autoComplete="organization"
                  />
                </Field>
                <Field label="How can we help?" required>
                  <textarea
                    name="message"
                    className="input"
                    rows={5}
                    minLength={20}
                    maxLength={5000}
                    required
                    placeholder="Tell us a little about your business and what you would like to discuss."
                  />
                </Field>
                <label className="checkbox-row">
                  <input type="checkbox" name="consent" required />
                  <span>
                    I agree to the{" "}
                    <Link to="/privacy" className="text-link">
                      privacy policy
                    </Link>{" "}
                    and consent to the VS team contacting me about this enquiry.
                  </span>
                </label>
                <Button type="submit" busy={busy}>
                  Send enquiry <ArrowUpRight size={16} />
                </Button>
              </form>
            )}
          </div>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
export function Setup() {
  const status = useApi<any>("/public/setup"),
    { accept } = useAuth(),
    navigate = useNavigate();
  const [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    const form = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (form.password !== form.confirm)
        throw new Error("Both passwords must match.");
      const result = await api("/public/setup", {
        method: "POST",
        body: JSON.stringify(form),
      });
      accept(result);
      navigate("/app/integrations");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthFrame subtitle="A strong foundation for every connection.">
      <div className="auth-form-wrap">
        <span className="eyebrow">FIRST ADMINISTRATOR SETUP</span>
        <h1>Make this workspace yours.</h1>
        <p className="auth-description">
          Create the platform administrator, then connect email, invite your
          team and begin onboarding real organizations.
        </p>
        {status.isPending ? (
          <Loading />
        ) : status.error ? (
          <ErrorState error={status.error} retry={status.refetch} />
        ) : !status.data.available ? (
          <EmptyState
            title="Your platform is already configured"
            description="Sign in with your administrator account to manage settings."
          >
            <Link className="button button-primary" to="/login">
              Sign in
            </Link>
          </EmptyState>
        ) : (
          <form className="form-stack" onSubmit={submit}>
            <FormError error={error} />
            <Field label="Your full name" required>
              <Input name="name" required minLength={2} autoComplete="name" />
            </Field>
            <Field label="Administrator work email" required>
              <Input name="email" type="email" required autoComplete="email" />
            </Field>
            <Field
              label="Password"
              required
              hint="At least 12 characters, with uppercase, lowercase and a number."
            >
              <Input
                name="password"
                type="password"
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                required
              />
            </Field>
            <Field label="Confirm password" required>
              <Input
                name="confirm"
                type="password"
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                required
              />
            </Field>
            {status.data.tokenRequired && (
              <Field
                label="One-time setup token"
                required
                hint="Provided by the operator who configured this installation."
              >
                <Input
                  name="token"
                  type="password"
                  autoComplete="off"
                  required
                />
              </Field>
            )}
            <Button busy={busy} type="submit">
              Create administrator <ArrowRight size={16} />
            </Button>
          </form>
        )}
      </div>
    </AuthFrame>
  );
}
export function Inquiries() {
  const [q, setQ] = useState(""),
    [status, setStatus] = useState(""),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<any>(),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    client = useQueryClient(),
    toast = useToast();
  const result = useApi<any>(`/inquiries?${queryString({ q, status, page })}`);
  return (
    <>
      <PageHeader
        eyebrow="BEFORE THE FIRST PARTNERSHIP"
        title="Public enquiries"
        description="Follow up with businesses contacting the VS team from the public portal."
      />
      <div className="card">
        <div className="table-filters">
          <SearchInput
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(1);
            }}
            placeholder="Search company, email or enquiry reference…"
          />
          <select
            className="compact-select"
            aria-label="Enquiry status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All enquiries</option>
            {["open", "in_progress", "resolved", "closed"].map((s) => (
              <option key={s} value={s}>
                {s.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </div>
        {result.isPending ? (
          <Loading />
        ) : result.error ? (
          <ErrorState error={result.error} retry={result.refetch} />
        ) : result.data.items.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Reference / company</th>
                  <th>Contact</th>
                  <th>Received</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.data.items.map((row: any) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.reference}</strong>
                      <small className="table-subtext">{row.company}</small>
                    </td>
                    <td>
                      {row.name}
                      <small className="table-subtext">{row.email}</small>
                    </td>
                    <td>{formatDate(row.created_at)}</td>
                    <td>
                      <Badge status={row.status} />
                    </td>
                    <td>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setSelected(row);
                          setError(undefined);
                        }}
                      >
                        Review
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No enquiries to show"
            description="Messages from the public contact form will appear here for the VS support team."
          />
        )}
        <Pagination
          total={result.data?.total || 0}
          page={page}
          onChange={setPage}
        />
      </div>
      {selected && (
        <Modal
          title={selected.reference}
          description={`${selected.company} · ${selected.name}`}
          onClose={() => !busy && setSelected(undefined)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = Object.fromEntries(new FormData(e.currentTarget));
              setBusy(true);
              setError(undefined);
              try {
                await api(`/inquiries/${selected.id}`, {
                  method: "PATCH",
                  body: JSON.stringify(form),
                });
                await client.invalidateQueries();
                setSelected(undefined);
                toast("Enquiry updated.");
              } catch (err) {
                setError(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="modal-body form-stack">
              <FormError error={error} />
              <p className="inquiry-message">{selected.message}</p>
              <a className="text-link" href={`mailto:${selected.email}`}>
                Contact {selected.email} <ArrowUpRight size={15} />
              </a>
              <Field label="Status">
                <select
                  className="input"
                  name="status"
                  defaultValue={selected.status}
                >
                  {["open", "in_progress", "resolved", "closed"].map((s) => (
                    <option key={s} value={s}>
                      {s.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Internal resolution notes">
                <textarea
                  className="input"
                  name="resolution"
                  defaultValue={selected.resolution}
                  maxLength={5000}
                  rows={4}
                />
              </Field>
            </div>
            <div className="modal-footer">
              <Button type="submit" busy={busy}>
                Save follow-up
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
