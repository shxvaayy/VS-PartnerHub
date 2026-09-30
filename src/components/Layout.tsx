import { useEffect, useRef, useState } from "react";
import {
  Link,
  NavLink,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  BarChart3,
  Bell,
  Building2,
  ChevronDown,
  ChevronRight,
  FileCheck2,
  FileClock,
  Headphones,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  Settings2,
  ShieldCheck,
  ShieldHalf,
  Sparkles,
  PlugZap,
  UsersRound,
  X,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApi, useAction } from "../lib/api";
import {
  Avatar,
  Badge,
  EmptyState,
  ErrorState,
  Loading,
  Logo,
  Modal,
  useToast,
} from "./ui";
import { moduleIcons } from "./icons";
import {
  moduleDefinitions,
  organizationLabels,
  roleLabels,
  type Module,
} from "../../shared/domain";
import { relativeTime } from "../lib/format";
import InstallApp from "./InstallApp";

export default function Layout() {
  const { user, loading, error, signOut, demo } = useAuth();
  const location = useLocation(),
    navigate = useNavigate(),
    toast = useToast();
  const [mobile, setMobile] = useState(false),
    [searchOpen, setSearchOpen] = useState(false),
    [notificationsOpen, setNotificationsOpen] = useState(false);
  const [narrow, setNarrow] = useState(
    () => window.matchMedia("(max-width: 767px)").matches,
  );
  const sidebarRef = useRef<HTMLElement>(null),
    menuRef = useRef<HTMLButtonElement>(null);
  const notifications = useApi<any>("/notifications?limit=5", Boolean(user));
  const readAll = useAction("/notifications/read-all");
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const resize = () => {
      setNarrow(media.matches);
      if (!media.matches) setMobile(false);
    };
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, []);
  useEffect(() => {
    if (!mobile || !narrow) return;
    const sidebar = sidebarRef.current,
      main = document.querySelector<HTMLElement>(".app-main");
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (main) main.inert = true;
    sidebar?.querySelector<HTMLButtonElement>(".sidebar-close")?.focus();
    const trap = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = Array.from(
        sidebar?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), summary, input, [tabindex="0"]',
        ) || [],
      ).filter((element) => element.getClientRects().length > 0);
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    sidebar?.addEventListener("keydown", trap);
    return () => {
      sidebar?.removeEventListener("keydown", trap);
      document.body.style.overflow = overflow;
      if (main) main.inert = false;
      menuRef.current?.focus();
    };
  }, [mobile, narrow]);
  useEffect(() => {
    setMobile(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((s) => !s);
      }
      if (e.key === "Escape") setMobile(false);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  if (loading) return <Loading />;
  if (error)
    return <ErrorState error={error} retry={() => window.location.reload()} />;
  if (!user)
    return (
      <Navigate
        to="/login"
        state={{ from: location.pathname + location.search }}
        replace
      />
    );
  const has = (module: string) =>
    Boolean(user.permissions[module]?.includes("view"));
  const activeModule = location.pathname.split("/")[2] || "overview";
  const labels: Record<string, string> = {
    overview: "Overview",
    organizations: "Partner directory",
    discovery: "Discover partners",
    verification: "Verification center",
    documents: "Documents",
    profile: "Company profile",
    team: "People & access",
    reports: "Reports & analytics",
    audit: "Audit trail",
    roles: "Roles & permissions",
    settings: "Settings",
    notifications: "Notifications",
    ai: "VS AI assistant",
    integrations: "Integrations",
    approvals: "Approvals",
    resources: "Resources & bench",
    "master-data": "Master data & compliance",
    inquiries: "Public enquiries",
    insights: "Operational outlook",
  };
  const title =
    labels[activeModule] ||
    moduleDefinitions[activeModule as Module]?.label ||
    "Workspace";
  const nav = (to: string, text: string, Icon: any, count?: number) => (
    <NavLink
      key={to}
      end={to === "/app"}
      to={to}
      className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
    >
      <Icon size={18} />
      <span>{text}</span>
      {count ? <span className="nav-count">{count}</span> : null}
    </NavLink>
  );
  const business: Module[] =
    user.organization?.type === "recruitment" ||
    user.organization?.type === "staffing" ||
    user.role === "hr"
      ? [
          "requirements",
          "candidates",
          "interviews",
          "engagements",
          "timesheets",
          "contracts",
          "invoices",
          "payments",
        ]
      : user.role === "finance" || user.role === "org_finance"
        ? ["invoices", "payments", "orders", "contracts"]
        : [
            "requirements",
            "rfqs",
            "quotations",
            "orders",
            "deliveries",
            "contracts",
            "invoices",
            "payments",
          ];
  const extras: Module[] = [
    "catalog",
    "milestones",
    "demos",
    "performance",
    "candidates",
    "interviews",
    "engagements",
    "timesheets",
  ].filter((m) => !business.includes(m as Module)) as Module[];
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {mobile && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside
        ref={sidebarRef}
        id="workspace-navigation"
        className={`sidebar ${mobile ? "sidebar-open" : ""}`}
        aria-label="Main navigation"
        role={mobile && narrow ? "dialog" : undefined}
        aria-modal={mobile && narrow ? true : undefined}
        inert={narrow && !mobile}
      >
        <div className="sidebar-brand-row">
          <Link
            className="sidebar-brand"
            to="/"
            aria-label="VS PartnerHub home"
            onClick={() => setMobile(false)}
          >
            <Logo light />
          </Link>
          <button
            className="sidebar-close"
            aria-label="Close navigation"
            onClick={() => setMobile(false)}
          >
            <X size={21} />
          </button>
        </div>
        <div className="workspace-selector">
          <span className="workspace-icon">
            {user.internal ? (
              <Building2 size={18} />
            ) : (
              <span>{user.organization?.legal_name.charAt(0)}</span>
            )}
          </span>
          <div>
            <strong>
              {user.internal
                ? "VS Solutions"
                : user.organization?.trade_name ||
                  user.organization?.legal_name}
            </strong>
            <small>
              {user.internal
                ? roleLabels[user.role]
                : user.organization
                  ? organizationLabels[user.organization.type]
                  : "Partner workspace"}
            </small>
          </div>
          {user.internal || user.organization?.status === "active" ? (
            <ShieldCheck size={16} aria-label="Verified organization" />
          ) : (
            <FileClock size={16} aria-label="Verification pending" />
          )}
        </div>
        <div className="sidebar-mobile-shortcuts">
          <button
            onClick={() => {
              setMobile(false);
              setSearchOpen(true);
            }}
          >
            <Search size={18} />
            <span>Search</span>
          </button>
          <Link to="/app/notifications" onClick={() => setMobile(false)}>
            <Bell size={18} />
            <span>Notifications</span>
            {notifications.data?.unread > 0 && (
              <b>{notifications.data.unread}</b>
            )}
          </Link>
        </div>
        <div className="sidebar-scroll">
          <div className="nav-section">
            <span className="nav-label">WORKSPACE</span>
            {nav("/app", "Overview", LayoutDashboard)}
            {has("ai") && nav("/app/ai", "VS AI assistant", Sparkles)}
            {has("organizations") &&
              nav("/app/organizations", "Partner directory", Building2)}
            {has("discovery") &&
              nav("/app/discovery", "Discover partners", Search)}
            {has("verification") &&
              nav("/app/verification", "Verification center", ShieldCheck)}
            {user.organization &&
              nav("/app/profile", "Company profile", Building2)}
            {has("reports") &&
              nav("/app/reports", "Reports & analytics", BarChart3)}
            {has("reports") &&
              nav("/app/insights", "Operational outlook", BarChart3)}
            {has("resources") &&
              (user.internal ||
                [
                  "vendor",
                  "staffing",
                  "recruitment",
                  "service_provider",
                  "technology_partner",
                ].includes(user.organization?.type || "")) &&
              nav("/app/resources", "Resources & bench", UsersRound)}
          </div>
          {business.some(has) && (
            <div className="nav-section">
              <span className="nav-label">
                {user.role === "hr" ||
                ["recruitment", "staffing"].includes(
                  user.organization?.type || "",
                )
                  ? "TALENT OPERATIONS"
                  : "BUSINESS OPERATIONS"}
              </span>
              {business
                .filter(has)
                .map((m) =>
                  nav(`/app/${m}`, moduleDefinitions[m].label, moduleIcons[m]),
                )}
            </div>
          )}
          {extras.some(has) && (
            <details
              className="nav-extra"
              open={
                extras.includes(activeModule as Module) ||
                user.organization?.type === "technology_partner" ||
                user.organization?.type === "service_provider"
              }
            >
              <summary>
                <span>MORE WORKSPACES</span>
                <ChevronDown size={14} />
              </summary>
              <div>
                {extras
                  .filter(has)
                  .map((m) =>
                    nav(
                      `/app/${m}`,
                      moduleDefinitions[m].label,
                      moduleIcons[m],
                    ),
                  )}
              </div>
            </details>
          )}
          <div className="nav-section">
            <span className="nav-label">MANAGEMENT</span>
            {has("documents") && nav("/app/documents", "Documents", FileCheck2)}
            {has("team") && nav("/app/team", "People & access", UsersRound)}
            {has("roles") &&
              nav("/app/roles", "Roles & permissions", ShieldHalf)}
            {has("audit") && nav("/app/audit", "Audit trail", FileClock)}
            {has("settings") && nav("/app/settings", "Settings", Settings2)}
            {has("integrations") &&
              nav("/app/integrations", "Integrations", PlugZap)}
            {has("approvals") &&
              nav("/app/approvals", "Approvals", ShieldCheck)}
            {has("master-data") &&
              nav("/app/master-data", "Master data & compliance", Settings2)}
            {user.internal &&
              user.permissions.tickets?.includes("review") &&
              nav("/app/inquiries", "Public enquiries", Headphones)}
          </div>
        </div>
        <div className="sidebar-bottom">
          <InstallApp />
          <Link to="/app/tickets" className="help-card">
            <span className="help-icon">
              <Headphones size={20} />
            </span>
            <div>
              <strong>Here to help you grow</strong>
              <small>Talk to the VS support team</small>
            </div>
            <ChevronRight size={15} />
          </Link>
          <div className="sidebar-user">
            <Avatar name={user.name} size="sm" />
            <div>
              <strong>{user.name}</strong>
              <small>{roleLabels[user.role] || user.role}</small>
            </div>
            <button
              onClick={async () => {
                try {
                  await signOut();
                  navigate("/login");
                } catch (e) {
                  toast((e as Error).message, "error");
                }
              }}
              aria-label="Sign out"
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              ref={menuRef}
              aria-label="Open navigation"
              aria-controls="workspace-navigation"
              aria-expanded={mobile}
              onClick={() => setMobile(true)}
            >
              <Menu size={22} />
            </button>
            <span className="breadcrumb-home">Workspace</span>
            <ChevronRight size={14} />
            <strong title={title}>{title}</strong>
          </div>
          <div className="topbar-actions">
            <button
              className="global-search-trigger"
              aria-label="Search anything…"
              onClick={() => setSearchOpen(true)}
            >
              <Search size={17} />
              <span>Search anything…</span>
              <kbd>⌘ K</kbd>
            </button>
            {demo && (
              <Link className="demo-badge" to="/login?demo=true">
                <span />
                Demo workspace
                <ChevronDown size={12} />
              </Link>
            )}
            <div className="notification-anchor">
              <button
                className="icon-button notification-button"
                aria-label="Open notifications"
                aria-expanded={notificationsOpen}
                onClick={() => setNotificationsOpen(!notificationsOpen)}
              >
                <Bell size={20} />
                {notifications.data?.unread > 0 && <i />}
              </button>
              {notificationsOpen && (
                <>
                  <button
                    className="dropdown-backdrop"
                    aria-label="Close notifications"
                    onClick={() => setNotificationsOpen(false)}
                  />
                  <div className="notification-dropdown">
                    <div className="dropdown-heading">
                      <strong>
                        Notifications{" "}
                        <span>{notifications.data?.unread || 0}</span>
                      </strong>
                      <button onClick={() => readAll.mutate({})}>
                        Mark all read
                      </button>
                    </div>
                    {notifications.data?.items?.length ? (
                      notifications.data.items.map((n: any) => (
                        <Link
                          key={n.id}
                          to={n.href}
                          onClick={() => setNotificationsOpen(false)}
                          className={`notification-preview ${n.read_at ? "" : "unread"}`}
                        >
                          <span className="notification-dot" />
                          <div>
                            <strong>{n.title}</strong>
                            <p>{n.body}</p>
                            <small>{relativeTime(n.created_at)}</small>
                          </div>
                        </Link>
                      ))
                    ) : (
                      <EmptyState
                        title="You’re all caught up"
                        description="New updates will appear here."
                      />
                    )}
                    <Link
                      to="/app/notifications"
                      className="dropdown-footer"
                      onClick={() => setNotificationsOpen(false)}
                    >
                      View all notifications <ChevronRight size={14} />
                    </Link>
                  </div>
                </>
              )}
            </div>
            <Link
              to="/app/settings"
              aria-label="Account settings"
              className="topbar-avatar"
            >
              <Avatar name={user.name} size="sm" />
            </Link>
          </div>
        </header>
        <main id="main-content" className="main-content">
          <Outlet />
        </main>
        <footer className="app-footer">
          <span>
            © {new Date().getFullYear()} Vijay Software Solutions Pvt. Ltd.
          </span>
          <div>
            <span className="secure-indicator">
              <ShieldCheck size={13} />
              Your business, securely connected
            </span>
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
          </div>
        </footer>
      </div>
      {searchOpen && <GlobalSearch onClose={() => setSearchOpen(false)} />}
    </div>
  );
}
function GlobalSearch({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState(""),
    [value, setValue] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setValue(query), 200);
    return () => clearTimeout(id);
  }, [query]);
  const results = useApi<any>(
    `/search?q=${encodeURIComponent(value)}`,
    value.length >= 2,
  );
  return (
    <Modal title="Find something in your workspace" onClose={onClose}>
      <div className="modal-body">
        <div className="command-input">
          <Search size={20} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search partners, RFQs, orders, candidates…"
            aria-label="Search workspace"
          />
        </div>
        {value.length < 2 ? (
          <p className="muted search-hint">
            Type at least two characters to search records available to your
            role.
          </p>
        ) : results.isPending ? (
          <Loading />
        ) : results.error ? (
          <FormSearchError message={results.error.message} />
        ) : (
          <div className="search-results">
            {results.data?.organizations.map((org: any) => (
              <Link
                to={`/app/organizations/${org.id}`}
                key={org.id}
                onClick={onClose}
              >
                <Building2 size={18} />
                <div>
                  <strong>{org.legal_name}</strong>
                  <small>Organization</small>
                </div>
                <Badge status={org.status} />
              </Link>
            ))}
            {results.data?.records.map((r: any) => (
              <Link to={`/app/${r.kind}/${r.id}`} key={r.id} onClick={onClose}>
                <Search size={17} />
                <div>
                  <strong>{r.title}</strong>
                  <small>
                    {r.number} · {moduleDefinitions[r.kind as Module]?.singular}
                  </small>
                </div>
                <Badge status={r.status} />
              </Link>
            ))}
            {!results.data?.records.length &&
              !results.data?.organizations.length && (
                <EmptyState
                  title="No matches just yet"
                  description="Try a company name, title or reference number."
                />
              )}
          </div>
        )}
      </div>
    </Modal>
  );
}
function FormSearchError({ message }: { message: string }) {
  return (
    <p role="alert" className="form-error">
      {message}
    </p>
  );
}
