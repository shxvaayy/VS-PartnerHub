import { useEffect, useState, type FormEvent } from "react";
import {
  CheckCircle2,
  CircleHelp,
  KeyRound,
  Mail,
  PlugZap,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { api, useApi } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  Badge,
  Button,
  Field,
  FormError,
  Input,
  Loading,
  PageHeader,
  useToast,
} from "../components/ui";
import { formatDate } from "../lib/format";
import { integrationScopes } from "../../shared/analytics";
import { modules, moduleDefinitions, type Module } from "../../shared/domain";

export default function Integrations() {
  const { user } = useAuth(),
    toast = useToast();
  const providers = useApi<any>(
    "/integrations/providers",
    user?.role === "super_admin",
  );
  const deliveries = useApi<any[]>(
    "/admin/email-status",
    user?.role === "super_admin",
  );
  const [mail, setMail] = useState<any>(),
    [gemini, setGemini] = useState<any>(),
    [busy, setBusy] = useState(""),
    [error, setError] = useState<unknown>(),
    [recipient, setRecipient] = useState(""),
    [result, setResult] = useState("");
  useEffect(() => {
    if (providers.data) {
      setMail({
        ...providers.data.email,
        password: "",
        apiKey: "",
        webhookSecret: "",
      });
      setGemini({ ...providers.data.gemini, apiKey: "" });
    }
  }, [providers.data]);
  const set = (key: string, value: any) =>
    setMail((m: any) => ({ ...m, [key]: value }));
  async function run(name: string, action: () => Promise<any>) {
    setBusy(name);
    setError(undefined);
    setResult("");
    try {
      const r = await action();
      setResult(
        r.message ||
          (r.response
            ? `Gemini responded: ${r.response}`
            : r.status
              ? `Email status: ${r.status}. ${["sent", "delivered"].includes(r.status) ? "Check the recipient inbox." : "Check the delivery log for retry details."}`
              : "Connection settings saved."),
      );
      toast("Connection updated");
      await providers.refetch();
      await deliveries.refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy("");
    }
  }
  async function saveMail(e: FormEvent) {
    e.preventDefault();
    const { configured, hasPassword, hasApiKey, hasWebhookSecret, ...data } =
      mail;
    await run("email-save", () =>
      api("/integrations/email", { method: "PUT", body: JSON.stringify(data) }),
    );
  }
  async function saveGemini(e: FormEvent) {
    e.preventDefault();
    const { configured, hasApiKey, ...data } = gemini;
    await run("gemini-save", () =>
      api("/integrations/gemini", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    );
  }
  if (user?.role === "super_admin" && providers.isPending) return <Loading />;
  return (
    <>
      <PageHeader
        eyebrow="CONNECTED OPERATIONS"
        title="Integrations"
        description="Connect your email, intelligence and business systems securely."
      />
      <FormError error={error || providers.error} />
      {result && (
        <div className="connection-result" role="status">
          <CheckCircle2 size={18} />
          {result}
        </div>
      )}
      {user?.role === "super_admin" && mail && gemini && (
        <>
          <div className="provider-grid">
            <form className="card provider-card" onSubmit={saveGemini}>
              <div className="provider-heading">
                <span className="provider-icon gemini">
                  <Sparkles size={24} />
                </span>
                <div>
                  <h2>Google Gemini</h2>
                  <p>VS AI, document extraction and business analysis</p>
                </div>
                <Badge
                  status={
                    providers.data.gemini.configured ? "active" : "pending"
                  }
                >
                  {providers.data.gemini.configured
                    ? "Configured"
                    : "Not connected"}
                </Badge>
              </div>
              <label className="provider-toggle">
                <input
                  type="checkbox"
                  checked={gemini.enabled}
                  onChange={(e) =>
                    setGemini({ ...gemini, enabled: e.target.checked })
                  }
                />
                Enable VS AI for authorized workspace users
              </label>
              <Field label="Gemini API key">
                <Input
                  type="password"
                  value={gemini.apiKey}
                  onChange={(e) =>
                    setGemini({ ...gemini, apiKey: e.target.value })
                  }
                  placeholder={
                    gemini.hasApiKey
                      ? "Saved securely · enter a new key to replace"
                      : "Enter your Google AI Studio API key"
                  }
                  autoComplete="new-password"
                />
              </Field>
              <div className="form-grid">
                <Field label="Gemini model">
                  <Input
                    value={gemini.model}
                    onChange={(e) =>
                      setGemini({ ...gemini, model: e.target.value })
                    }
                    required
                  />
                </Field>
                <Field label="Daily requests per user">
                  <Input
                    type="number"
                    min={1}
                    max={2000}
                    value={gemini.dailyLimit}
                    onChange={(e) =>
                      setGemini({
                        ...gemini,
                        dailyLimit: Number(e.target.value),
                      })
                    }
                    required
                  />
                </Field>
              </div>
              <p className="provider-note">
                <ShieldCheck size={16} />
                The key stays on the server. Record access is checked before
                every AI request.
              </p>
              <div className="provider-actions">
                <Button type="submit" disabled={!!busy}>
                  Save Gemini settings
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!!busy || !providers.data.gemini.configured}
                  onClick={() =>
                    run("gemini-test", () =>
                      api("/integrations/gemini/test", {
                        method: "POST",
                        body: "{}",
                      }),
                    )
                  }
                >
                  {busy === "gemini-test"
                    ? "Contacting Gemini…"
                    : "Test live connection"}
                </Button>
              </div>
            </form>
            <form className="card provider-card" onSubmit={saveMail}>
              <div className="provider-heading">
                <span className="provider-icon email">
                  <Mail size={24} />
                </span>
                <div>
                  <h2>Email delivery</h2>
                  <p>Registration OTPs, invitations and business updates</p>
                </div>
                <Badge
                  status={
                    providers.data.email.configured ? "active" : "pending"
                  }
                >
                  {providers.data.email.configured
                    ? "Configured"
                    : "Not connected"}
                </Badge>
              </div>
              <label className="provider-toggle">
                <input
                  type="checkbox"
                  checked={mail.enabled}
                  onChange={(e) => set("enabled", e.target.checked)}
                />
                Enable real email delivery
              </label>
              <div className="form-grid">
                <Field label="Delivery provider">
                  <select
                    className="input"
                    value={mail.provider}
                    onChange={(e) => set("provider", e.target.value)}
                  >
                    <option value="smtp">SMTP</option>
                    <option value="resend">Resend</option>
                  </select>
                </Field>
                <Field label="Sender">
                  <Input
                    value={mail.from}
                    onChange={(e) => set("from", e.target.value)}
                    placeholder="VS PartnerHub <partners@company.com>"
                    required
                  />
                </Field>
                <Field label="Reply-to email">
                  <Input
                    type="email"
                    value={mail.replyTo}
                    onChange={(e) => set("replyTo", e.target.value)}
                  />
                </Field>
              </div>
              {mail.provider === "smtp" ? (
                <div className="form-grid">
                  <Field label="SMTP host">
                    <Input
                      value={mail.host}
                      onChange={(e) => set("host", e.target.value)}
                      required
                    />
                  </Field>
                  <Field label="Port">
                    <Input
                      type="number"
                      value={mail.port}
                      onChange={(e) => set("port", Number(e.target.value))}
                      min={1}
                      max={65535}
                    />
                  </Field>
                  <Field label="Username">
                    <Input
                      value={mail.username}
                      onChange={(e) => set("username", e.target.value)}
                      autoComplete="off"
                    />
                  </Field>
                  <Field label="Password / app password">
                    <Input
                      type="password"
                      value={mail.password}
                      onChange={(e) => set("password", e.target.value)}
                      placeholder={
                        mail.hasPassword
                          ? "Saved securely · enter to replace"
                          : "SMTP app password"
                      }
                      autoComplete="new-password"
                    />
                  </Field>
                  <label className="provider-toggle">
                    <input
                      type="checkbox"
                      checked={mail.secure}
                      onChange={(e) => set("secure", e.target.checked)}
                    />
                    Implicit TLS (usually port 465)
                  </label>
                </div>
              ) : (
                <>
                  <Field label="Resend API key">
                    <Input
                      type="password"
                      value={mail.apiKey}
                      onChange={(e) => set("apiKey", e.target.value)}
                      placeholder={
                        mail.hasApiKey
                          ? "Saved securely · enter to replace"
                          : "Resend API key"
                      }
                      autoComplete="new-password"
                    />
                  </Field>
                  <Field label="Delivery webhook signing secret (optional)">
                    <Input
                      type="password"
                      value={mail.webhookSecret}
                      onChange={(e) => set("webhookSecret", e.target.value)}
                      placeholder={
                        mail.hasWebhookSecret
                          ? "Saved securely · enter to replace"
                          : "whsec_…"
                      }
                      autoComplete="new-password"
                    />
                  </Field>
                  <p className="provider-note">
                    Configure delivery events at your public origin +{" "}
                    <code>/api/integrations/email/webhook</code>.
                  </p>
                </>
              )}
              <div className="provider-actions">
                <Button type="submit" disabled={!!busy}>
                  Save email settings
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!!busy || !providers.data.email.configured}
                  onClick={() =>
                    run("email-verify", () =>
                      api("/integrations/email/verify", {
                        method: "POST",
                        body: "{}",
                      }),
                    )
                  }
                >
                  Verify connection
                </Button>
              </div>
            </form>
          </div>
          <section className="card email-delivery-card">
            <div className="provider-heading">
              <Send size={23} />
              <div>
                <h2>Verify the complete delivery path</h2>
                <p>
                  Send a real message through your configured provider and
                  inspect its delivery status.
                </p>
              </div>
            </div>
            <form
              className="email-test-form"
              onSubmit={(e) => {
                e.preventDefault();
                run("email-test", () =>
                  api("/integrations/email/test", {
                    method: "POST",
                    body: JSON.stringify({ recipient }),
                  }),
                );
              }}
            >
              <Field label="Test recipient">
                <Input
                  type="email"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  required
                  placeholder="you@company.com"
                />
              </Field>
              <Button
                type="submit"
                disabled={!!busy || !providers.data.email.configured}
              >
                {busy === "email-test" ? "Sending…" : "Send test email"}
              </Button>
            </form>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Recipient</th>
                    <th>Subject</th>
                    <th>Status</th>
                    <th>Attempts</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.data?.map((m) => (
                    <tr key={m.id}>
                      <td>{m.to_address}</td>
                      <td>
                        {m.subject}
                        {m.last_error && (
                          <small className="delivery-error">
                            {m.last_error}
                          </small>
                        )}
                      </td>
                      <td>
                        <Badge status={m.status} />
                      </td>
                      <td>{m.attempts}</td>
                      <td>{formatDate(m.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!deliveries.data?.length && (
                <p className="table-empty">
                  Delivery activity appears here after the first email is
                  requested.
                </p>
              )}
            </div>
          </section>
        </>
      )}
      <BusinessConnections />
    </>
  );
}
function BusinessConnections() {
  const { user } = useAuth();
  const data = useApi<any>("/integrations/business");
  const [name, setName] = useState(""),
    [url, setUrl] = useState(""),
    [error, setError] = useState<unknown>(),
    [secret, setSecret] = useState(""),
    [keyName, setKeyName] = useState(""),
    [keyScopes, setKeyScopes] = useState<string[]>([]),
    [events, setEvents] = useState<string[]>([]),
    [expiresInDays, setExpiresInDays] = useState(90),
    [token, setToken] = useState(""),
    [busy, setBusy] = useState(false);
  const permitted = integrationScopes.filter((scope) =>
    user?.permissions[scope]?.includes("view"),
  );
  const canManage = Boolean(user?.permissions.integrations?.includes("manage"));
  async function createWebhook(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const r = await api<any>("/integrations/webhooks", {
        method: "POST",
        body: JSON.stringify({
          name,
          url,
          events,
        }),
      });
      setSecret(r.secret);
      setName("");
      setUrl("");
      data.refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function createToken(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const r = await api<any>("/integrations/tokens", {
        method: "POST",
        body: JSON.stringify({
          name: keyName,
          scopes: keyScopes,
          expiresInDays,
        }),
      });
      setToken(r.token);
      setKeyName("");
      data.refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card business-connections">
      <div className="provider-heading">
        <PlugZap size={25} />
        <div>
          <h2>Business systems & reporting</h2>
          <p>Connect accounting, ERP and BI tools with access you control.</p>
        </div>
      </div>
      <FormError error={error || data.error} />
      <div className="provider-grid">
        <div>
          <h3>Outgoing webhooks</h3>
          <form onSubmit={createWebhook}>
            <fieldset
              className="integration-form-fields"
              disabled={!canManage || busy}
            >
              <Field label="Connection name">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="Accounting system"
                />
              </Field>
              <Field label="HTTPS endpoint">
                <Input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                  placeholder="https://your-system.com/partnerhub/events"
                />
              </Field>
              <ScopePicker
                title="Events to send"
                values={events}
                options={modules.filter((scope) => permitted.includes(scope))}
                onChange={setEvents}
              />
              <Button disabled={busy || !events.length} type="submit">
                Create webhook
              </Button>
            </fieldset>
          </form>
          {secret && (
            <div className="one-time-secret">
              <strong>Save this signing secret now</strong>
              <code>{secret}</code>
              <button
                onClick={() => {
                  navigator.clipboard
                    .writeText(secret)
                    .catch(() =>
                      setError(
                        new Error(
                          "Clipboard access was declined. Select and copy the secret directly.",
                        ),
                      ),
                    );
                }}
              >
                Copy signing secret
              </button>
            </div>
          )}
          {data.data?.webhooks?.map((w: any) => (
            <div className="connection-row" key={w.id}>
              <div>
                <strong>{w.name}</strong>
                <small>{w.url}</small>
              </div>
              <Badge status={w.active ? "active" : "closed"} />
              <button
                className="text-button"
                disabled={!canManage}
                onClick={async () => {
                  setError(undefined);
                  try {
                    await api(`/integrations/webhooks/${w.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({ active: !w.active }),
                    });
                    await data.refetch();
                  } catch (e) {
                    setError(e);
                  }
                }}
              >
                {w.active ? "Disable" : "Enable"}
              </button>
            </div>
          ))}
        </div>
        <div>
          <h3>Read-only integration API</h3>
          <p className="muted">
            Tokens inherit your current organization and module permissions.
            Revoking access takes effect immediately.
          </p>
          <form onSubmit={createToken}>
            <fieldset
              className="integration-form-fields"
              disabled={!canManage || busy}
            >
              <Field label="Token name">
                <Input
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  required
                  placeholder="Finance reporting"
                />
              </Field>
              <Field label="Token expiry">
                <select
                  className="input"
                  value={expiresInDays}
                  onChange={(e) => setExpiresInDays(Number(e.target.value))}
                >
                  {[7, 30, 90, 180, 365].map((days) => (
                    <option key={days} value={days}>
                      {days} days
                    </option>
                  ))}
                </select>
              </Field>
              <div
                className="scope-presets"
                aria-label="Suggested token scopes"
              >
                <span>Quick selection</span>
                <button
                  type="button"
                  onClick={() =>
                    setKeyScopes(
                      ["reports", "invoices", "payments"].filter((scope) =>
                        permitted.includes(scope as (typeof permitted)[number]),
                      ),
                    )
                  }
                >
                  Finance reports
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setKeyScopes(
                      [
                        "reports",
                        "requirements",
                        "rfqs",
                        "quotations",
                        "orders",
                        "deliveries",
                        "performance",
                      ].filter((scope) =>
                        permitted.includes(scope as (typeof permitted)[number]),
                      ),
                    )
                  }
                >
                  Procurement reports
                </button>
                <button type="button" onClick={() => setKeyScopes([])}>
                  Clear
                </button>
              </div>
              <ScopePicker
                title="Data this token can read"
                values={keyScopes}
                options={permitted}
                onChange={setKeyScopes}
              />
              {keyScopes.includes("reports") && keyScopes.length === 1 && (
                <p className="provider-note">
                  Select a source module as well to enable reporting.
                </p>
              )}
              <Button
                type="submit"
                variant="secondary"
                disabled={
                  busy ||
                  !keyScopes.length ||
                  (keyScopes.includes("reports") && keyScopes.length === 1)
                }
              >
                <KeyRound size={16} />
                Create API token
              </Button>
            </fieldset>
          </form>
          {token && (
            <div className="one-time-secret">
              <strong>Copy this token now; it will not be shown again</strong>
              <code>{token}</code>
              <button
                onClick={() =>
                  navigator.clipboard
                    .writeText(token)
                    .catch(() =>
                      setError(
                        new Error(
                          "Clipboard access was declined. Select and copy the token directly.",
                        ),
                      ),
                    )
                }
              >
                Copy API token
              </button>
            </div>
          )}
          {data.data?.tokens?.map((t: any) => (
            <div className="connection-row" key={t.id}>
              <div>
                <strong>{t.name}</strong>
                <small>
                  {t.prefix}… · Expires {formatDate(t.expires_at)}
                </small>
                <small>Read access: {t.scopes.map(scopeName).join(", ")}</small>
                <small>
                  {!t.active
                    ? "Revoked"
                    : Date.parse(t.expires_at) <= Date.now()
                      ? "Expired"
                      : t.last_used_at
                        ? `Last used ${formatDate(t.last_used_at)}`
                        : "Not used yet"}
                </small>
              </div>
              <button
                className="text-button"
                disabled={!t.active || !canManage}
                onClick={async () => {
                  setError(undefined);
                  try {
                    await api(`/integrations/tokens/${t.id}`, {
                      method: "DELETE",
                    });
                    await data.refetch();
                  } catch (e) {
                    setError(e);
                  }
                }}
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      </div>
      {data.data?.deliveries?.length > 0 && (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Webhook</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>HTTP</th>
                <th>Date</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.data.deliveries.map((d: any) => (
                <tr key={d.id}>
                  <td>{d.endpoint_name}</td>
                  <td>
                    <Badge status={d.status} />
                  </td>
                  <td>{d.attempts}</td>
                  <td>{d.http_status || "—"}</td>
                  <td>{formatDate(d.created_at)}</td>
                  <td>
                    {d.status === "failed" && (
                      <button
                        className="text-button"
                        onClick={async () => {
                          setError(undefined);
                          try {
                            await api(
                              `/integrations/deliveries/${d.id}/retry`,
                              {
                                method: "POST",
                                body: "{}",
                              },
                            );
                            await data.refetch();
                          } catch (e) {
                            setError(e);
                          }
                        }}
                      >
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="provider-note">
        <CircleHelp size={15} />
        Use <code>GET /api/integration/records/:module</code> with a Bearer
        token. Webhook verification uses HMAC-SHA256 of the timestamp and
        request body.
      </p>
    </section>
  );
}

function scopeName(scope: string) {
  return (
    moduleDefinitions[scope as Module]?.label ||
    (
      {
        reports: "Reports & analytics",
        organizations: "Organizations",
        documents: "Documents",
      } as Record<string, string>
    )[scope] ||
    scope
  );
}
function ScopePicker({
  title,
  values,
  options,
  onChange,
}: {
  title: string;
  values: string[];
  options: readonly string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <fieldset className="integration-scopes">
      <legend>
        {title}
        <span>{values.length} selected</span>
      </legend>
      <div>
        {options.map((scope) => (
          <label key={scope}>
            <input
              type="checkbox"
              checked={values.includes(scope)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...values, scope]
                    : values.filter((value) => value !== scope),
                )
              }
            />
            <span>{scopeName(scope)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
