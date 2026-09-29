import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  Bell,
  Check,
  CheckCheck,
  ChevronRight,
  Download,
  FileClock,
  KeyRound,
  LockKeyhole,
  Mail,
  Plus,
  Save,
  Settings2,
  ShieldCheck,
  UserPlus,
  UsersRound,
  X,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { api, queryString, setCsrf, useApi } from "../lib/api";
import {
  Avatar,
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
  useToast,
} from "../components/ui";
import { formatDate, formatTime, relativeTime } from "../lib/format";
import {
  defaultPermissions,
  documentCategories,
  label,
  moduleDefinitions,
  modules,
  roleLabels,
  type Action,
  type Permissions,
} from "../../shared/domain";
export function Team() {
  const { user } = useAuth(),
    result = useApi<any>("/admin/team"),
    [invite, setInvite] = useState(false),
    [edit, setEdit] = useState<any>(null),
    toast = useToast(),
    client = useQueryClient(),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  if (result.isPending) return <Loading />;
  if (result.error)
    return <ErrorState error={result.error} retry={() => result.refetch()} />;
  const canManage = user!.permissions.team?.includes("manage");
  return (
    <div>
      <PageHeader
        eyebrow="THE PEOPLE WHO MAKE IT HAPPEN"
        title="Great work starts with your team."
        description="Invite colleagues and give everyone the right access to contribute."
      >
        {canManage && (
          <Button onClick={() => setInvite(true)}>
            <UserPlus size={17} />
            Invite a teammate
          </Button>
        )}
      </PageHeader>
      <div className="card">
        <CardHeader
          title="Your people"
          description={`${result.data.users.length} team members · ${result.data.invitations.length} invitations pending`}
        />
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Team member</th>
                <th>Role</th>
                <th>Account status</th>
                <th>Email verification</th>
                <th>Joined</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {result.data.users.map((u: any) => (
                <tr key={u.id}>
                  <td>
                    <div className="identity-cell">
                      <Avatar name={u.name} />
                      <div>
                        <strong>
                          {u.name}
                          {u.id === user!.id && (
                            <span className="you-label">You</span>
                          )}
                        </strong>
                        <small>{u.email}</small>
                      </div>
                    </div>
                  </td>
                  <td>{roleLabels[u.role] || u.role}</td>
                  <td>
                    <Badge status={u.active ? "active" : "suspended"} />
                  </td>
                  <td className="subtle">
                    {u.email_verified ? (
                      <span className="verified-inline">
                        <Check size={13} />
                        Verified
                      </span>
                    ) : (
                      "Pending"
                    )}
                  </td>
                  <td className="subtle">{formatDate(u.created_at)}</td>
                  <td>
                    {canManage && u.id !== user!.id && (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setEdit({ ...u, active: Boolean(u.active) });
                          setError(null);
                        }}
                      >
                        Manage
                        <ChevronRight size={14} />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {result.data.invitations.length > 0 && (
        <div className="card space-top">
          <CardHeader
            title="A seat at the table"
            description="Pending invitations expire after 72 hours."
          />
          {result.data.invitations.map((i: any) => (
            <div className="invitation-row" key={i.id}>
              <span className="record-type-icon">
                <Mail size={20} />
              </span>
              <div>
                <strong>{i.name}</strong>
                <small>
                  {i.email} · {roleLabels[i.role]} · Expires{" "}
                  {formatDate(i.expires_at)}
                </small>
              </div>
              {canManage && (
                <Button
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await api(`/admin/team/invitations/${i.id}`, {
                        method: "DELETE",
                      });
                      await client.invalidateQueries();
                      toast("Invitation revoked.");
                    } catch (e) {
                      toast((e as Error).message, "error");
                    }
                  }}
                >
                  Revoke
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      {invite && (
        <InviteUser
          onClose={() => setInvite(false)}
          roles={result.data.roles}
        />
      )}
      {edit && (
        <Modal
          title={`Manage ${edit.name}`}
          description="Role changes and account suspension end this user’s existing sessions."
          onClose={() => setEdit(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                await api(`/admin/team/${edit.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({
                    role: edit.role,
                    active: edit.active,
                  }),
                });
                await client.invalidateQueries();
                toast("Team member updated.");
                setEdit(null);
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="modal-body form-stack">
              <FormError error={error} />
              <Field label="Role">
                <select
                  className="input"
                  value={edit.role}
                  onChange={(e) => setEdit({ ...edit, role: e.target.value })}
                >
                  {result.data.roles
                    .filter((r: any) =>
                      edit.organization_id ? !r.internal : r.internal,
                    )
                    .map((r: any) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </Field>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={edit.active}
                  onChange={(e) =>
                    setEdit({ ...edit, active: e.target.checked })
                  }
                />
                Account active
              </label>
            </div>
            <div className="modal-footer">
              <Button
                variant="secondary"
                type="button"
                onClick={() => setEdit(null)}
              >
                Cancel
              </Button>
              <Button busy={busy} type="submit">
                Save access
                <Check size={16} />
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
function InviteUser({ roles, onClose }: { roles: any[]; onClose: () => void }) {
  const { user } = useAuth(),
    [role, setRole] = useState(user!.internal ? "procurement" : "org_member"),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [url, setUrl] = useState(""),
    client = useQueryClient(),
    toast = useToast();
  const orgs = useApi<any>("/organizations?limit=100", user!.internal),
    external = roles.find((r) => r.id === role)?.internal === false;
  return (
    <Modal
      title="Good work is better together."
      description="Your teammate will receive an invitation to create their own secure account."
      onClose={onClose}
    >
      {url ? (
        <div className="modal-body form-stack">
          <div className="success-panel">
            <CheckCheck size={30} />
            <h3>Invitation created</h3>
            <p>
              This local demo link lets you verify the invitation flow without
              an email provider.
            </p>
          </div>
          <Input readOnly aria-label="Local invitation link" value={url} />
          <a
            className="button button-secondary"
            href={url}
            target="_blank"
            rel="noreferrer"
          >
            Open invitation
            <ChevronRight size={15} />
          </a>
          <Button onClick={onClose}>Done</Button>
        </div>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            const input = Object.fromEntries(new FormData(e.currentTarget));
            try {
              const result = await api("/admin/team/invite", {
                method: "POST",
                body: JSON.stringify({
                  ...input,
                  role,
                  organization_id: input.organization_id || null,
                }),
              });
              await client.invalidateQueries();
              toast("Invitation created.");
              if (result.invitationUrl) setUrl(result.invitationUrl);
              else onClose();
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="modal-body form-stack">
            <FormError error={error} />
            <Field label="Full name" required>
              <Input name="name" required minLength={2} />
            </Field>
            <Field label="Work email" required>
              <Input name="email" type="email" required />
            </Field>
            <Field label="Role">
              <select
                className="input"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
            {user!.internal && external && (
              <Field label="Organization" required>
                <select className="input" name="organization_id" required>
                  <option value="">Select an organization</option>
                  {orgs.data?.items.map((o: any) => (
                    <option key={o.id} value={o.id}>
                      {o.legal_name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
          <div className="modal-footer">
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" busy={busy}>
              <Mail size={16} />
              Create invitation
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
export function Roles() {
  const result = useApi<any[]>("/admin/roles"),
    [selected, setSelected] = useState("procurement"),
    [draft, setDraft] = useState<Permissions | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    toast = useToast(),
    client = useQueryClient();
  if (result.isPending) return <Loading />;
  if (result.error)
    return <ErrorState error={result.error} retry={() => result.refetch()} />;
  const role = result.data.find((r) => r.id === selected) || result.data[0],
    permissions = draft || role.permissions;
  const all = [
    ...modules,
    "dashboard",
    "profile",
    "documents",
    "notifications",
    "settings",
    "organizations",
    "verification",
    "team",
    "roles",
    "reports",
    "audit",
    "discovery",
  ];
  const allowed = role.internal
    ? all
    : all.filter((m) => defaultPermissions.org_admin[m]);
  const toggle = (module: string, action: Action, enabled: boolean) => {
    const p = structuredClone(permissions) as Permissions;
    const actions = new Set(p[module] || []);
    if (enabled) {
      actions.add("view");
      actions.add(action);
    } else if (action === "view") actions.clear();
    else actions.delete(action);
    p[module] = [...actions];
    setDraft(p);
  };
  return (
    <div>
      <PageHeader
        eyebrow="THE RIGHT ACCESS. THE RIGHT PEOPLE."
        title="Roles & permissions"
        description="Give every team the access they need, within clear organization boundaries."
      />
      <div className="roles-layout">
        <div className="card role-list">
          {result.data.map((r) => (
            <button
              key={r.id}
              className={selected === r.id ? "active" : ""}
              onClick={() => {
                setSelected(r.id);
                setDraft(null);
                setError(null);
              }}
            >
              <span className="role-icon">
                <ShieldCheck size={19} />
              </span>
              <span>
                <strong>{r.name}</strong>
                <small>
                  {r.internal ? "VS internal role" : "Organization role"}
                </small>
              </span>
              <ChevronRight size={15} />
            </button>
          ))}
        </div>
        <div className="card">
          <CardHeader
            title={role.name}
            description={
              role.id === "super_admin"
                ? "Full platform access. This protected role cannot be changed."
                : role.internal
                  ? "Access applies to authorized internal operations."
                  : "Access is always limited to the user’s organization and organization type."
            }
          >
            <Button
              busy={busy}
              disabled={!draft || role.id === "super_admin"}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await api(`/admin/roles/${role.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ permissions }),
                  });
                  await client.invalidateQueries();
                  setDraft(null);
                  toast("Role permissions saved.");
                } catch (e) {
                  setError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Save size={16} />
              Save permissions
            </Button>
          </CardHeader>
          <FormError error={error} />
          <div className="table-scroll">
            <table className="data-table permissions-table">
              <thead>
                <tr>
                  <th>Workspace / module</th>
                  {["View", "Create", "Edit", "Review", "Manage"].map((a) => (
                    <th key={a}>{a}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allowed.map((m) => (
                  <tr key={m}>
                    <td>
                      {moduleDefinitions[m as keyof typeof moduleDefinitions]
                        ?.label || label(m)}
                    </td>
                    {(
                      ["view", "create", "edit", "review", "manage"] as Action[]
                    ).map((a) => (
                      <td key={a}>
                        <input
                          aria-label={`${label(m)} ${a}`}
                          type="checkbox"
                          checked={permissions[m]?.includes(a) || false}
                          disabled={
                            role.id === "super_admin" ||
                            (!role.internal &&
                              !defaultPermissions.org_admin[m]?.includes(a))
                          }
                          onChange={(e) => toggle(m, a, e.target.checked)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
export function Audit() {
  const [query, setQuery] = useState(""),
    [module, setModule] = useState(""),
    [page, setPage] = useState(1),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const result = useApi<any>(
    `/admin/audit?${queryString({ q: query, category: module, page, from, to })}`,
  );
  return (
    <div>
      <PageHeader
        eyebrow="A CLEAR RECORD OF EVERY STEP"
        title="Trust you can trace."
        description="Who did what, when, and why. Your platform’s activity and decision history."
      />
      <div className="card">
        <div className="table-filters">
          <SearchInput
            value={query}
            onChange={(v) => {
              setQuery(v);
              setPage(1);
            }}
            placeholder="Search a person, action or reference…"
          />
          <div className="filter-right">
            <select
              className="compact-select"
              aria-label="Audit module"
              value={module}
              onChange={(e) => {
                setModule(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All modules</option>
              {[
                ...modules,
                "organizations",
                "documents",
                "auth",
                "roles",
                "team",
                "settings",
              ].map((m) => (
                <option key={m} value={m}>
                  {label(m)}
                </option>
              ))}
            </select>
            <Input
              type="date"
              aria-label="Audit start date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
            <Input
              type="date"
              aria-label="Audit end date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
        {result.isPending ? (
          <Loading />
        ) : result.error ? (
          <ErrorState error={result.error} retry={() => result.refetch()} />
        ) : result.data.items.length ? (
          <div className="table-scroll">
            <table className="data-table audit-table">
              <thead>
                <tr>
                  <th>Actor</th>
                  <th>Action / module</th>
                  <th>Record</th>
                  <th>Status change</th>
                  <th>Date & time</th>
                  <th>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {result.data.items.map((a: any) => (
                  <tr key={a.id}>
                    <td>
                      <div className="identity-cell">
                        <Avatar name={a.actor_name} size="sm" />
                        <div>
                          <strong>{a.actor_name}</strong>
                          <small>{roleLabels[a.role] || label(a.role)}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="two-line-cell">
                        <strong>{label(a.action)}</strong>
                        <small>{label(a.module)}</small>
                      </div>
                    </td>
                    <td className="reference-cell">{a.record_number || "—"}</td>
                    <td>
                      {a.new_status ? (
                        <div className="audit-status">
                          {a.previous_status &&
                            a.previous_status !== a.new_status && (
                              <>
                                <Badge status={a.previous_status} />
                                <ChevronRight size={12} />
                              </>
                            )}
                          <Badge status={a.new_status} />
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="subtle nowrap">
                      {formatTime(a.created_at)}
                    </td>
                    <td className="audit-remarks">{a.remarks || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No activity in this view"
            description="Try another filter or a wider date range."
          />
        )}
        {result.data && (
          <Pagination
            total={result.data.total}
            page={page}
            onChange={setPage}
          />
        )}
      </div>
    </div>
  );
}
export function Notifications() {
  const [status, setStatus] = useState(""),
    [page, setPage] = useState(1),
    result = useApi<any>(`/notifications?${queryString({ status, page })}`),
    client = useQueryClient(),
    toast = useToast();
  const read = async (id?: string) => {
    try {
      await api(id ? `/notifications/${id}/read` : "/notifications/read-all", {
        method: "POST",
      });
      await client.invalidateQueries();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  return (
    <div>
      <PageHeader
        eyebrow="IN THE LOOP. AHEAD OF THE CURVE."
        title="Your updates, together."
        description="The decisions, opportunities and reminders that keep your business moving."
      >
        <Button variant="secondary" onClick={() => read()}>
          <CheckCheck size={17} />
          Mark all as read
        </Button>
      </PageHeader>
      <div className="card notifications-card">
        <div className="records-toolbar">
          <div className="status-tabs">
            <button
              className={!status ? "active" : ""}
              onClick={() => {
                setStatus("");
                setPage(1);
              }}
            >
              All updates
            </button>
            <button
              className={status ? "active" : ""}
              onClick={() => {
                setStatus("unread");
                setPage(1);
              }}
            >
              Unread <span>{result.data?.unread || 0}</span>
            </button>
          </div>
        </div>
        {result.isPending ? (
          <Loading />
        ) : result.error ? (
          <ErrorState error={result.error} retry={() => result.refetch()} />
        ) : result.data.items.length ? (
          <div>
            {result.data.items.map((n: any) => (
              <div
                className={`notification-row ${n.read_at ? "" : "unread"}`}
                key={n.id}
              >
                <span className="notification-type">
                  <Bell size={20} />
                </span>
                <Link
                  to={n.href}
                  onClick={() => {
                    if (!n.read_at) read(n.id);
                  }}
                >
                  <strong>{n.title}</strong>
                  <p>{n.body}</p>
                  <small>
                    {label(n.category)} · {relativeTime(n.created_at)}
                  </small>
                </Link>
                {!n.read_at && (
                  <button
                    className="icon-button"
                    aria-label={`Mark ${n.title} as read`}
                    onClick={() => read(n.id)}
                  >
                    <Check size={17} />
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="All caught up. Nicely done."
            description="We’ll keep you posted when something needs your attention."
          />
        )}
        {result.data && (
          <Pagination
            total={result.data.total}
            page={page}
            onChange={setPage}
          />
        )}
      </div>
    </div>
  );
}
export function Settings() {
  const { user, refresh } = useAuth(),
    [tab, setTab] = useState("account"),
    settings = useApi<any>("/admin/settings"),
    preferences = useApi<any>("/auth/preferences"),
    emailStatus = useApi<any[]>(
      "/admin/email-status",
      user!.role === "super_admin" && tab === "email",
    ),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    client = useQueryClient(),
    toast = useToast();
  const savePassword = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = e.currentTarget,
      data = Object.fromEntries(new FormData(form));
    if (data.password !== data.confirm_password) {
      setError(new Error("The new passwords do not match."));
      setBusy(false);
      return;
    }
    try {
      const result = await api("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          current_password: data.current_password,
          password: data.password,
        }),
      });
      setCsrf(result.csrfToken);
      await refresh();
      toast("Password updated. Other sessions have been signed out.");
      form.reset();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <PageHeader
        eyebrow="MAKE YOUR WORKSPACE WORK FOR YOU"
        title="A few thoughtful settings."
        description="Manage your account, preferences and platform configuration."
      />
      <div className="settings-layout">
        <div className="card settings-nav">
          {[
            ["account", "Your account", UsersRound],
            ["security", "Password & security", LockKeyhole],
            ["notifications", "Notification preferences", Bell],
            ...(user!.role === "super_admin"
              ? [
                  ["platform", "Platform configuration", Settings2],
                  ["email", "Email delivery", Mail],
                ]
              : []),
          ].map(([key, name, Icon]: any) => (
            <button
              key={key}
              className={tab === key ? "active" : ""}
              onClick={() => {
                setTab(key);
                setError(null);
              }}
            >
              <Icon size={18} />
              {name}
              <ChevronRight size={14} />
            </button>
          ))}
        </div>
        <div>
          {tab === "account" && (
            <div className="card">
              <CardHeader
                title="Your account"
                description="The person behind the partnerships."
              />
              <div className="settings-content">
                <div className="account-identity">
                  <Avatar name={user!.name} size="lg" />
                  <div>
                    <h2>{user!.name}</h2>
                    <p>{user!.email}</p>
                    <Badge
                      status={user!.email_verified ? "verified" : "registered"}
                    />
                  </div>
                </div>
                <div className="detail-fields">
                  <div>
                    <span>Role</span>
                    <p>{roleLabels[user!.role]}</p>
                  </div>
                  <div>
                    <span>Organization</span>
                    <p>
                      {user!.organization?.legal_name ||
                        "Vijay Software Solutions Pvt. Ltd."}
                    </p>
                  </div>
                </div>
                <div className="info-banner">
                  <ShieldCheck size={22} />
                  <p>
                    Contact your organization administrator to change your role.
                    Company contact information can be updated from the Company
                    Profile workspace.
                  </p>
                </div>
                {user!.organization && (
                  <Link to="/app/profile" className="button button-secondary">
                    Company profile
                    <ChevronRight size={15} />
                  </Link>
                )}
              </div>
            </div>
          )}
          {tab === "security" && (
            <div className="card">
              <CardHeader
                title="Keep your account secure"
                description="Choose a unique password you do not use for other services."
              />
              <form onSubmit={savePassword}>
                <div className="settings-content form-stack">
                  <FormError error={error} />
                  <Field label="Current password" required>
                    <Input
                      type="password"
                      name="current_password"
                      autoComplete="current-password"
                      required
                    />
                  </Field>
                  <Field
                    label="New password"
                    required
                    hint="At least 12 characters with uppercase, lowercase and a number."
                  >
                    <Input
                      type="password"
                      name="password"
                      autoComplete="new-password"
                      minLength={12}
                      maxLength={128}
                      required
                    />
                  </Field>
                  <Field label="Confirm new password" required>
                    <Input
                      type="password"
                      name="confirm_password"
                      autoComplete="new-password"
                      minLength={12}
                      maxLength={128}
                      required
                    />
                  </Field>
                  <p className="muted">
                    Updating your password signs out your other active sessions.
                  </p>
                  <Button busy={busy} type="submit">
                    <KeyRound size={16} />
                    Update password
                  </Button>
                </div>
              </form>
              <MfaSettings enabled={preferences.data?.mfa || false} />
            </div>
          )}
          {tab === "notifications" && (
            <div className="card">
              <CardHeader
                title="Stay connected, your way"
                description="Choose how you receive business updates."
              />
              <div className="settings-content">
                <div className="preference-row">
                  <div>
                    <strong>Email notifications</strong>
                    <p>
                      Approvals, transactions, document reminders and support
                      updates.
                    </p>
                  </div>
                  <button
                    className={`switch ${preferences.data?.email !== false ? "on" : ""}`}
                    role="switch"
                    aria-checked={preferences.data?.email !== false}
                    aria-label="Email notifications"
                    onClick={async () => {
                      try {
                        await api("/auth/preferences", {
                          method: "PATCH",
                          body: JSON.stringify({
                            email: preferences.data?.email === false,
                          }),
                        });
                        await client.invalidateQueries();
                        toast("Notification preferences saved.");
                      } catch (e) {
                        toast((e as Error).message, "error");
                      }
                    }}
                  >
                    <span />
                  </button>
                </div>
                <div className="preference-row">
                  <div>
                    <strong>In-app notifications</strong>
                    <p>
                      Your workflow updates remain available in the notification
                      center.
                    </p>
                  </div>
                  <Badge status="active">Always available</Badge>
                </div>
                <div className="info-banner">
                  <Mail size={21} />
                  <p>
                    Email verification, password resets and security messages
                    are sent regardless of your business notification
                    preference.
                  </p>
                </div>
              </div>
            </div>
          )}
          {tab === "platform" &&
            (settings.isPending ? (
              <Loading />
            ) : settings.error ? (
              <FormError error={settings.error} />
            ) : (
              <PlatformSettings initial={settings.data} />
            ))}
          {tab === "email" && (
            <div className="card">
              <CardHeader
                title="Email delivery"
                description={
                  settings.data?.emailConfigured
                    ? "SMTP is configured. The outbox retries temporary delivery failures."
                    : "SMTP is not configured. Local demo emails are kept in the outbox."
                }
              />
              <div className="settings-content">
                <div className="info-banner">
                  <Mail size={22} />
                  <p>
                    Email provider credentials are configured on the server.
                    Delivery status is shown below; secret keys and
                    authentication message contents are never displayed here.
                  </p>
                </div>
              </div>
              {emailStatus.isPending ? (
                <Loading />
              ) : emailStatus.error ? (
                <FormError error={emailStatus.error} />
              ) : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Message</th>
                        <th>Recipient</th>
                        <th>Status</th>
                        <th>Attempts</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {emailStatus.data?.map((m) => (
                        <tr key={m.id}>
                          <td>
                            <div className="two-line-cell">
                              <strong>{m.subject}</strong>
                              <small>{formatTime(m.created_at)}</small>
                            </div>
                          </td>
                          <td className="subtle">{m.to_address}</td>
                          <td>
                            <Badge status={m.status} />
                          </td>
                          <td>{m.attempts}</td>
                          <td>
                            {m.status === "failed" && (
                              <Button
                                variant="ghost"
                                onClick={async () => {
                                  try {
                                    await api(
                                      `/admin/email-status/${m.id}/retry`,
                                      { method: "POST" },
                                    );
                                    await client.invalidateQueries();
                                    toast("Email queued for retry.");
                                  } catch (e) {
                                    toast((e as Error).message, "error");
                                  }
                                }}
                              >
                                Retry
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
function MfaSettings({ enabled }: { enabled: boolean }) {
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const client = useQueryClient();
  const toast = useToast();
  return (
    <section className="settings-content security-factor">
      <h2>Email sign-in verification</h2>
      <p>
        Add a one-time email code after your password when you sign in. Changing
        this setting signs out your other sessions.
      </p>
      <Badge status={enabled ? "active" : "draft"}>
        {enabled ? "Enabled" : "Disabled"}
      </Badge>
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const current_password = String(
            new FormData(form).get("mfa_password") || "",
          );
          setBusy(true);
          setError(null);
          try {
            await api("/auth/mfa", {
              method: "POST",
              body: JSON.stringify({ enabled: !enabled, current_password }),
            });
            await client.invalidateQueries({ queryKey: ["/auth/preferences"] });
            toast(
              enabled
                ? "Email sign-in verification disabled."
                : "Email sign-in verification enabled.",
            );
            form.reset();
          } catch (error) {
            setError(error);
          } finally {
            setBusy(false);
          }
        }}
      >
        <FormError error={error} />
        <Field label="Password to change sign-in verification" required>
          <Input
            type="password"
            name="mfa_password"
            autoComplete="current-password"
            required
            maxLength={128}
          />
        </Field>
        <Button type="submit" variant="secondary" busy={busy}>
          <ShieldCheck size={16} />
          {enabled ? "Disable sign-in codes" : "Enable sign-in codes"}
        </Button>
      </form>
    </section>
  );
}

function PlatformSettings({ initial }: { initial: any }) {
  const [data, setData] = useState({
      name: initial.name,
      documentExpiryDays: initial.documentExpiryDays,
      requiredDocuments: initial.requiredDocuments,
      candidateRetentionDays: initial.candidateRetentionDays,
      auditRetentionDays: initial.auditRetentionDays,
      emailEnabled: initial.emailEnabled,
      approvalThreshold: initial.approvalThreshold,
      categories: initial.categories,
    }),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    client = useQueryClient(),
    toast = useToast();
  return (
    <div className="card">
      <CardHeader
        title="Platform configuration"
        description="Shared settings for verification, approvals and retention."
      />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api("/admin/settings", {
              method: "PATCH",
              body: JSON.stringify(data),
            });
            await client.invalidateQueries();
            toast("Platform settings saved.");
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="settings-content form-stack">
          <FormError error={error} />
          <Field label="Platform name">
            <Input
              value={data.name}
              onChange={(e) => setData((d) => ({ ...d, name: e.target.value }))}
              required
            />
          </Field>
          <div className="form-grid">
            <Field
              label="Second-approver threshold"
              hint="In the transaction currency. Orders at or above this value need a different authorized approver."
            >
              <Input
                type="number"
                min={0}
                value={data.approvalThreshold}
                onChange={(e) =>
                  setData((d) => ({
                    ...d,
                    approvalThreshold: Number(e.target.value),
                  }))
                }
              />
            </Field>
            <Field label="Document reminders (days before expiry)">
              <Input
                value={data.documentExpiryDays.join(", ")}
                onChange={(e) =>
                  setData((d) => ({
                    ...d,
                    documentExpiryDays: e.target.value
                      .split(",")
                      .map((v) => Number(v.trim())),
                  }))
                }
              />
            </Field>
            <Field
              label="Candidate retention (days)"
              hint="Completed or closed recruitment records are anonymized after this period."
            >
              <Input
                type="number"
                min={30}
                max={1095}
                value={data.candidateRetentionDays}
                onChange={(e) =>
                  setData((d) => ({
                    ...d,
                    candidateRetentionDays: Number(e.target.value),
                  }))
                }
              />
            </Field>
            <Field
              label="Minimum audit retention (days)"
              hint="Operational retention policy; archival requires an administrator’s maintenance procedure."
            >
              <Input
                type="number"
                min={365}
                max={3650}
                value={data.auditRetentionDays}
                onChange={(e) =>
                  setData((d) => ({
                    ...d,
                    auditRetentionDays: Number(e.target.value),
                  }))
                }
              />
            </Field>
          </div>
          <Field label="Documents required for organization approval">
            <div className="checkbox-grid">
              {documentCategories
                .filter(
                  (c) => !["Resume", "Invoice attachment", "Other"].includes(c),
                )
                .map((c) => (
                  <label key={c}>
                    <input
                      type="checkbox"
                      checked={data.requiredDocuments.includes(c)}
                      onChange={(e) =>
                        setData((d) => ({
                          ...d,
                          requiredDocuments: e.target.checked
                            ? [...d.requiredDocuments, c]
                            : d.requiredDocuments.filter(
                                (v: string) => v !== c,
                              ),
                        }))
                      }
                    />
                    {c}
                  </label>
                ))}
            </div>
          </Field>
          <Field
            label="Business categories / master data"
            hint="One category per line."
          >
            <textarea
              className="input"
              rows={9}
              value={data.categories.join("\n")}
              onChange={(e) =>
                setData((d) => ({
                  ...d,
                  categories: e.target.value.split("\n"),
                }))
              }
            />
          </Field>
          <label className="check-label">
            <input
              type="checkbox"
              checked={data.emailEnabled}
              onChange={(e) =>
                setData((d) => ({ ...d, emailEnabled: e.target.checked }))
              }
            />
            Enable business notification emails platform-wide
          </label>
          <Button busy={busy} type="submit">
            <Save size={16} />
            Save platform settings
          </Button>
        </div>
      </form>
    </div>
  );
}
