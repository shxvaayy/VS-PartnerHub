import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Building2,
  Check,
  ChevronRight,
  CircleCheck,
  FileCheck2,
  FileText,
  Fingerprint,
  GitCompareArrows,
  Handshake,
  Layers3,
  LockKeyhole,
  Menu,
  Package,
  Search,
  ShieldCheck,
  Sparkles,
  Truck,
  UsersRound,
  Wallet,
  Workflow,
  X,
} from "lucide-react";
import { Avatar, Logo } from "../components/ui";
import { useAuth } from "../lib/auth";
import {
  organizationTypes,
  organizationLabels,
  roleLabels,
  type OrganizationType,
} from "../../shared/domain";
import { organizationIcons } from "../components/icons";

function tabKeys(event: KeyboardEvent<HTMLElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  );
  const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
  if (current < 0) return;
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
          tabs.length;
  event.preventDefault();
  tabs[next].focus();
  tabs[next].click();
}

export function PublicHeader() {
  const { user } = useAuth(),
    [open, setOpen] = useState(false);
  return (
    <header className="public-header hub-header">
      <a className="skip-link" href="#public-main">
        Skip to content
      </a>
      <nav className="public-nav" aria-label="Public navigation">
        <Link to="/" aria-label="VS PartnerHub home">
          <Logo />
        </Link>
        <div className="hub-nav-links">
          <a href="/#platform" onClick={() => setOpen(false)}>
            Platform
          </a>
          <a href="/#workspaces" onClick={() => setOpen(false)}>
            Who it’s for
          </a>
          <Link to="/partners" onClick={() => setOpen(false)}>
            Partner network
          </Link>
          <Link to="/contact" onClick={() => setOpen(false)}>
            Contact
          </Link>
        </div>
        <div className="public-nav-actions">
          <Link className="hub-signin" to={user ? "/app" : "/login"}>
            {user ? "My workspace" : "Sign in"}
          </Link>
          <Link className="button button-primary" to="/register">
            Get started <ArrowUpRight size={16} />
          </Link>
          <button
            className="icon-button hub-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="public-mobile-navigation"
            onClick={() => setOpen(!open)}
          >
            {open ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
      </nav>
      {open && <PublicMobileMenu onClose={() => setOpen(false)} />}
    </header>
  );
}
function PublicMobileMenu({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null),
    { user } = useAuth();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null,
      overflow = document.body.style.overflow,
      dialog = ref.current;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    const wide = window.matchMedia("(min-width: 801px)");
    const resize = () => {
      if (wide.matches) closeRef.current();
    };
    wide.addEventListener("change", resize);
    return () => {
      wide.removeEventListener("change", resize);
      dialog?.close();
      document.body.style.overflow = overflow;
      active?.focus();
    };
  }, []);
  const links = [
    {
      href: "/#platform",
      title: "The platform",
      detail: "Every partnership, connected",
      Icon: Layers3,
    },
    {
      href: "/#workspaces",
      title: "Who it’s for",
      detail: "A workspace built around your business",
      Icon: UsersRound,
    },
    {
      href: "/partners",
      title: "Partner network",
      detail: "Explore verified organizations",
      Icon: Handshake,
    },
    {
      href: "/contact",
      title: "Talk to VS",
      detail: "Onboarding, partnerships and support",
      Icon: Building2,
    },
  ];
  return createPortal(
    <dialog
      ref={ref}
      id="public-mobile-navigation"
      className="hub-mobile-drawer"
      aria-labelledby="mobile-nav-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="hub-drawer-shell">
        <div className="hub-drawer-top">
          <Link to="/" onClick={onClose} aria-label="VS PartnerHub home">
            <Logo />
          </Link>
          <button
            className="hub-drawer-close"
            onClick={onClose}
            aria-label="Close menu"
          >
            <X size={21} />
          </button>
        </div>
        <div className="hub-drawer-content">
          <div className="hub-drawer-intro">
            <span className="hub-eyebrow">ONE CONNECTED BUSINESS NETWORK</span>
            <h2 id="mobile-nav-title">
              Let’s get you
              <br />
              <em>connected.</em>
            </h2>
          </div>
          <nav aria-label="Explore PartnerHub" className="hub-drawer-links">
            {links.map(({ href, title, detail, Icon }) => (
              <Link
                key={href}
                to={href}
                reloadDocument={href.includes("#")}
                onClick={onClose}
              >
                <span className="hub-drawer-link-icon">
                  <Icon size={21} />
                </span>
                <span>
                  <strong>{title}</strong>
                  <small>{detail}</small>
                </span>
                <ChevronRight size={17} />
              </Link>
            ))}
          </nav>
          <details className="hub-drawer-workspaces">
            <summary>
              <span>
                Find your workspace
                <small>For all nine organization types</small>
              </span>
              <ChevronRight size={17} />
            </summary>
            <div>
              {organizationTypes.map((type) => {
                const Icon = organizationIcons[type];
                return (
                  <Link
                    key={type}
                    to={`/register?type=${type}`}
                    onClick={onClose}
                  >
                    <Icon size={17} />
                    <span>{organizationLabels[type]}</span>
                    <ArrowUpRight size={13} />
                  </Link>
                );
              })}
            </div>
          </details>
          <Link className="hub-drawer-ai" to="/app/ai" onClick={onClose}>
            <span>
              <Sparkles size={22} />
            </span>
            <div>
              <strong>
                A little intelligence.
                <br />A lot more possibility.
              </strong>
              <small>Meet your VS AI assistant</small>
            </div>
            <ArrowUpRight size={20} />
          </Link>
        </div>
        <div className="hub-drawer-bottom">
          {user ? (
            <>
              <div className="hub-drawer-account">
                <Avatar name={user.name} />
                <div>
                  <strong>{user.name}</strong>
                  <small>{roleLabels[user.role] || "Partner workspace"}</small>
                </div>
              </div>
              <Link
                className="button button-primary"
                to="/app"
                onClick={onClose}
              >
                Open my workspace <ArrowRight size={17} />
              </Link>
            </>
          ) : (
            <>
              <Link
                className="button button-primary"
                to="/register"
                onClick={onClose}
              >
                Register your organization <ArrowUpRight size={17} />
              </Link>
              <p>
                Already part of the network?{" "}
                <Link to="/login" onClick={onClose}>
                  Sign in <ArrowRight size={14} />
                </Link>
              </p>
            </>
          )}
          <span className="hub-drawer-footnote">
            <ShieldCheck size={13} />
            Vijay Software Solutions Pvt. Ltd.
          </span>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
export function PublicFooter() {
  return (
    <footer className="hub-footer">
      <div className="hub-footer-top">
        <div>
          <Link to="/">
            <Logo light />
          </Link>
          <p>
            One network. Every business relationship.
            <br />A Vijay Software Solutions platform.
          </p>
        </div>
        <div>
          <strong>Platform</strong>
          <a href="/#workspaces">Partner workspaces</a>
          <Link to="/partners">Partner network</Link>
          <Link to="/app/ai">VS AI assistant</Link>
        </div>
        <div>
          <strong>Get connected</strong>
          <Link to="/register">Register your organization</Link>
          <Link to="/login">Access your workspace</Link>
          <Link to="/contact">Contact the VS team</Link>
        </div>
      </div>
      <div className="hub-footer-bottom">
        <span>
          © {new Date().getFullYear()} Vijay Software Solutions Pvt. Ltd.
        </span>
        <div>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms of use</Link>
        </div>
      </div>
    </footer>
  );
}
const workspaces: Record<
  OrganizationType,
  { heading: string; copy: string; features: string[]; journey: string[] }
> = {
  client: {
    heading: "The right partner. A clearer purchase.",
    copy: "Bring your buying team and partner network into one shared process, from the first requirement to the final invoice.",
    features: [
      "Discover verified expertise",
      "Compare commercial responses",
      "Control approvals and commitments",
    ],
    journey: [
      "Requirement",
      "Find partners",
      "Compare quotes",
      "Approve & order",
    ],
  },
  vendor: {
    heading: "More opportunity. Less back and forth.",
    copy: "Make your expertise easy to discover, respond to requirements and keep every client commitment in view.",
    features: [
      "One complete company profile",
      "RFQs and quotation revisions",
      "Orders, invoices and payment visibility",
    ],
    journey: ["Receive RFQ", "Submit quotation", "Deliver", "Track payment"],
  },
  supplier: {
    heading: "From your catalog to their next order.",
    copy: "Keep products, prices and availability ready for new demand. Connect your catalog to the complete supply lifecycle.",
    features: [
      "Reusable catalog and SKU master",
      "MOQ, stock availability and lead times",
      "PO acknowledgement and delivery tracking",
    ],
    journey: [
      "Publish catalog",
      "Quote",
      "Acknowledge PO",
      "Deliver & invoice",
    ],
  },
  recruitment: {
    heading: "Every introduction, one step closer.",
    copy: "Give your recruiters a dedicated workspace for client requirements, candidate submissions and the entire hiring journey.",
    features: [
      "Assigned hiring requirements",
      "Interview and offer coordination",
      "BGV, onboarding and joining status",
    ],
    journey: ["Requirement", "Submit talent", "Interview & offer", "Joining"],
  },
  staffing: {
    heading: "Your talent. Their next chapter.",
    copy: "Connect staffing engagements, resource availability and approved time, with the commercial context alongside.",
    features: [
      "Resource pools and availability",
      "Deployment and engagement tracking",
      "Timesheets and approvals",
    ],
    journey: ["Match resources", "Engage", "Deploy", "Approve time"],
  },
  service_provider: {
    heading: "Turn expertise into lasting value.",
    copy: "Put your services in front of the right clients and keep proposals, milestones and billing connected to the agreement.",
    features: [
      "Service catalog and rate cards",
      "Proposals and contract agreements",
      "Milestones and performance reviews",
    ],
    journey: ["Share capabilities", "Propose", "Deliver milestones", "Invoice"],
  },
  technology_partner: {
    heading: "Bring your next solution to the table.",
    copy: "Showcase your software, cloud, AI and security capabilities, and help buyers understand what your technology can do.",
    features: [
      "Products and solution documentation",
      "API and integration capabilities",
      "Demo requests and partner contacts",
    ],
    journey: ["Showcase solution", "Connect", "Demonstrate", "Collaborate"],
  },
  business_partner: {
    heading: "Build what comes next, together.",
    copy: "A shared identity and workspace for your business capabilities, commercial agreements and evolving partnerships.",
    features: [
      "Verified business identity",
      "Capabilities and authorized contacts",
      "Opportunities and commercial workflows",
    ],
    journey: ["Introduce", "Verify", "Connect", "Collaborate"],
  },
  other: {
    heading: "A place in the network for your business.",
    copy: "Register your organization, share how you work and collaborate through a workspace with permissions your team can manage.",
    features: [
      "Structured company onboarding",
      "Document verification and renewal",
      "Connected partner operations",
    ],
    journey: ["Register", "Verify", "Set up your team", "Collaborate"],
  },
};
const lifecycle = [
  {
    title: "Requirement",
    Icon: FileText,
    lead: "Start with a clear business need.",
    copy: "Capture specifications, quantities, delivery dates and eligibility criteria before approaching partners.",
    details: [
      "Structured line items",
      "Supporting documents",
      "Commercial guidance",
    ],
    module: "requirements",
  },
  {
    title: "RFQ",
    Icon: Search,
    lead: "Bring the right partners to the table.",
    copy: "Invite eligible, verified organizations and set a clear deadline for comparable responses.",
    details: [
      "Verified partner invitations",
      "Response deadlines",
      "Shared specifications",
    ],
    module: "rfqs",
  },
  {
    title: "Quotation",
    Icon: GitCompareArrows,
    lead: "See the full commercial picture.",
    copy: "Review submitted prices, taxes, delivery terms and warranties side by side, then resolve open questions.",
    details: [
      "Side-by-side comparison",
      "Clarifications and revisions",
      "Recorded commercial terms",
    ],
    module: "quotations",
  },
  {
    title: "Approval",
    Icon: ShieldCheck,
    lead: "Put accountability behind every decision.",
    copy: "Route the decision through configured reviewers and keep the complete approval history attached.",
    details: [
      "Sequential approval policies",
      "Separate authorized reviewers",
      "Decision remarks and history",
    ],
    module: "approvals",
  },
  {
    title: "Purchase order",
    Icon: FileCheck2,
    lead: "Make the commitment clear.",
    copy: "Create an order from the approved quotation, with the agreed items, value and delivery terms carried forward.",
    details: [
      "Approved source pricing",
      "PO acknowledgement",
      "Linked contract agreements",
    ],
    module: "orders",
  },
  {
    title: "Delivery",
    Icon: Truck,
    lead: "Keep the promise in sight.",
    copy: "Follow dispatch, delivery or service milestones and record confirmation from the receiving team.",
    details: [
      "Delivery references",
      "Service milestones",
      "Goods or service confirmation",
    ],
    module: "deliveries",
  },
  {
    title: "Invoice",
    Icon: FileText,
    lead: "Connect the invoice to the work.",
    copy: "Submit supporting documents and review invoices against fulfilled orders or active contracts.",
    details: [
      "Linked PO or contract",
      "Invoice review and approval",
      "Due dates and supporting files",
    ],
    module: "invoices",
  },
  {
    title: "Payment",
    Icon: Wallet,
    lead: "Close the loop with confidence.",
    copy: "Record payment references, track outstanding balances and review partner performance after delivery.",
    details: [
      "Transaction references",
      "Partial payment tracking",
      "Partner performance history",
    ],
    module: "payments",
  },
];
function PlatformMetric({
  value,
  suffix = "",
  label,
  detail,
}: {
  value?: number;
  suffix?: string;
  label: string;
  detail: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    if (
      value === undefined ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !window.IntersectionObserver
    )
      return;
    let frame = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        const start = performance.now();
        const update = (at: number) => {
          const progress = Math.min(1, (at - start) / 1100);
          setDisplay(Math.round(value * (1 - Math.pow(1 - progress, 3))));
          if (progress < 1) frame = requestAnimationFrame(update);
        };
        frame = requestAnimationFrame(update);
      },
      { threshold: 0.5 },
    );
    if (ref.current) observer.observe(ref.current);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value]);
  return (
    <div ref={ref} className="hub-platform-metric">
      <strong>
        <span aria-hidden="true">
          {value === undefined ? "End-to-end" : `${display}${suffix}`}
        </span>
        <span className="sr-only">
          {value === undefined ? "End-to-end" : `${value}${suffix}`}
        </span>
      </strong>
      <h2>{label}</h2>
      <p>{detail}</p>
    </div>
  );
}

export default function Home() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = root.current;
    if (!container || !window.IntersectionObserver) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const targets = container.querySelectorAll<HTMLElement>(
      ".hub-section-heading, .hub-feature-grid > article, .hub-platform-metric, .hub-workspace-panel, .hub-ai-section",
    );
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            entry.target.classList.add("hub-revealed");
            observer.unobserve(entry.target);
          }
      },
      { threshold: 0.08 },
    );
    const start = () => {
      container.classList.toggle("hub-motion", !preference.matches);
      targets.forEach((target, index) => {
        target.classList.add("hub-reveal");
        target.style.setProperty("--reveal-delay", `${(index % 3) * 70}ms`);
        observer.observe(target);
      });
    };
    start();
    preference.addEventListener("change", start);
    return () => {
      observer.disconnect();
      preference.removeEventListener("change", start);
    };
  }, []);
  const [type, setType] = useState<OrganizationType>("client"),
    [stage, setStage] = useState(0),
    [track, setTrack] = useState(0);
  const selected = workspaces[type],
    TypeIcon = organizationIcons[type],
    step = lifecycle[stage];
  const tracks = [
    {
      label: "Source & procure",
      Icon: Package,
      cards: ["Requirement", "Quotation", "Approved order"],
      copy: "A connected path from business need to commitment.",
    },
    {
      label: "Recruit & deploy",
      Icon: UsersRound,
      cards: ["Hiring need", "Candidate", "Joining"],
      copy: "Keep the people, partners and next steps together.",
    },
    {
      label: "Deliver & grow",
      Icon: Workflow,
      cards: ["Agreement", "Milestone", "Payment"],
      copy: "Bring delivery and commercial visibility into one place.",
    },
  ];
  return (
    <div className="hub-home" ref={root}>
      <PublicHeader />
      <main id="public-main">
        <section className="hub-hero">
          <div className="hub-hero-copy">
            <span className="hub-eyebrow">
              <i />
              THE BUSINESS OF BETTER PARTNERSHIPS
            </span>
            <h1>
              Your partners.
              <br />
              Your possibilities.
              <br />
              <em>One platform.</em>
            </h1>
            <p>
              Bring your business network together. Onboard the right partners,
              move procurement forward and connect great talent to opportunity.
            </p>
            <div className="hub-hero-actions">
              <Link
                className="button button-primary button-large"
                to="/register"
              >
                Build your next partnership <ArrowUpRight size={18} />
              </Link>
              <a href="#platform" className="hub-text-link">
                Explore the platform <ArrowDown size={16} />
              </a>
            </div>
            <div className="hub-hero-note">
              <ShieldCheck size={18} />
              <span>Verified identities. Purpose-built workspaces.</span>
            </div>
          </div>
          <div className="hub-network">
            <div className="hub-network-heading">
              <span>
                <i />
                THE CONNECTED WORKSPACE
              </span>
              <Layers3 size={17} />
            </div>
            <div className="hub-identity">
              <div className="hub-identity-logo">
                <Logo compact />
              </div>
              <div>
                <span>ONE SHARED BUSINESS IDENTITY</span>
                <h2>Connected by trust.</h2>
              </div>
              <ShieldCheck size={29} />
            </div>
            <div className="hub-network-line">
              <i />
              <span />
              <i />
            </div>
            <div
              className="hub-network-tabs"
              role="tablist"
              onKeyDown={tabKeys}
              aria-label="Explore business workflows"
            >
              {tracks.map((t, i) => (
                <button
                  key={t.label}
                  type="button"
                  role="tab"
                  tabIndex={track === i ? 0 : -1}
                  aria-selected={track === i}
                  aria-controls={`track-panel-${i}`}
                  id={`track-tab-${i}`}
                  className={track === i ? "active" : ""}
                  onClick={() => setTrack(i)}
                >
                  <t.Icon size={21} />
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
            <div
              className="hub-track-panel"
              role="tabpanel"
              tabIndex={0}
              id={`track-panel-${track}`}
              aria-labelledby={`track-tab-${track}`}
            >
              <div className="hub-track-label">
                <span>YOUR WORKFLOW, CONNECTED</span>
                <ArrowUpRight size={15} />
              </div>
              <div className="hub-track-stages">
                {tracks[track].cards.map((title, i) => (
                  <div key={title}>
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    <strong>{title}</strong>
                    {i < 2 ? (
                      <ChevronRight size={16} />
                    ) : (
                      <CircleCheck size={17} />
                    )}
                  </div>
                ))}
              </div>
              <p>{tracks[track].copy}</p>
            </div>
            <div className="hub-network-bottom">
              <span>
                <LockKeyhole size={14} /> Access follows your role
              </span>
              <span>
                <Sparkles size={14} /> VS AI intelligence
              </span>
            </div>
            <div className="hub-network-tag">
              <Fingerprint size={19} />
              <span>
                One organization.<strong>Every connection.</strong>
              </span>
            </div>
          </div>
        </section>
        <section
          className="hub-platform-scale"
          aria-label="Platform at a glance"
        >
          <div className="hub-scale-intro">
            <span className="hub-eyebrow">BUILT FOR THE WHOLE BUSINESS</span>
            <p>
              One platform.
              <br />
              <strong>Room for every partnership.</strong>
            </p>
          </div>
          <div className="hub-platform-metrics">
            <PlatformMetric
              value={8}
              suffix="+"
              label="Organization types"
              detail="A relevant workspace for every partner."
            />
            <PlatformMetric
              value={20}
              label="Core modules"
              detail="Connected from onboarding to analytics."
            />
            <PlatformMetric
              value={5}
              suffix="+"
              label="Internal roles"
              detail="The right access for each VS team."
            />
            <PlatformMetric
              label="Business lifecycle"
              detail="From the first requirement to payment."
            />
          </div>
        </section>
        <div className="hub-discipline-strip">
          <span>
            BUILT AROUND
            <br />
            <strong>the way you do business.</strong>
          </span>
          {[
            [Package, "Procurement"],
            [Truck, "Supplier operations"],
            [UsersRound, "Talent partnerships"],
            [ShieldCheck, "Compliance & finance"],
          ].map(([Icon, title]) => {
            const I = Icon as typeof Package;
            return (
              <div key={String(title)}>
                <I size={22} />
                <span>{String(title)}</span>
              </div>
            );
          })}
        </div>
        <section className="hub-section hub-platform" id="platform">
          <div className="hub-section-heading">
            <div>
              <span className="hub-eyebrow">
                LESS FRAGMENTATION. MORE MOMENTUM.
              </span>
              <h2>
                Business moves better
                <br />
                when everyone is connected.
              </h2>
            </div>
            <p>
              Give every company a verified identity and every team the context
              to take the next step.
            </p>
          </div>
          <div className="hub-feature-grid">
            <article className="hub-feature-featured">
              <div className="hub-feature-art">
                <span>
                  <Building2 size={28} />
                </span>
                <i />
                <span>
                  <Handshake size={28} />
                </span>
                <i />
                <span>
                  <ShieldCheck size={28} />
                </span>
              </div>
              <span className="hub-card-kicker">01 / PARTNER FOUNDATION</span>
              <h3>
                Start every relationship
                <br />
                on solid ground.
              </h3>
              <p>
                Dynamic onboarding, organization profiles, authorized contacts
                and document verification. One identity throughout your business
                lifecycle.
              </p>
              <Link to="/register">
                Join the network <ArrowUpRight size={18} />
              </Link>
            </article>
            <article>
              <span className="hub-feature-icon">
                <Workflow size={25} />
              </span>
              <span className="hub-card-kicker">02 / CONNECTED OPERATIONS</span>
              <h3>
                Keep the work
                <br />
                moving forward.
              </h3>
              <p>
                RFQs, comparisons, orders, contracts and invoices stay
                connected. Every team sees the commitments and actions relevant
                to them.
              </p>
              <a href="#lifecycle">
                Follow the workflow <ArrowUpRight size={18} />
              </a>
            </article>
            <article>
              <span className="hub-feature-icon violet">
                <UsersRound size={25} />
              </span>
              <span className="hub-card-kicker">03 / TALENT COLLABORATION</span>
              <h3>
                Great people.
                <br />
                Shared possibilities.
              </h3>
              <p>
                Bring recruitment partners into the hiring journey. Track
                candidates, interviews, offers, BGV and joining in a dedicated
                workspace.
              </p>
              <Link to="/register?type=recruitment">
                Connect your talent team <ArrowUpRight size={18} />
              </Link>
            </article>
          </div>
        </section>
        <section className="hub-section hub-workspaces" id="workspaces">
          <div className="hub-section-heading">
            <div>
              <span className="hub-eyebrow">YOUR ROLE. YOUR WORKSPACE.</span>
              <h2>
                A shared platform.
                <br />A space that feels like yours.
              </h2>
            </div>
            <p>
              Different businesses need different tools. Choose your
              organization type to explore how PartnerHub fits your work.
            </p>
          </div>
          <div
            className="hub-workspace-tabs"
            role="tablist"
            onKeyDown={tabKeys}
            aria-label="Organization workspaces"
          >
            {organizationTypes.map((t) => (
              <button
                key={t}
                id={`workspace-tab-${t}`}
                role="tab"
                aria-controls="workspace-description"
                tabIndex={type === t ? 0 : -1}
                aria-selected={type === t}
                onClick={() => setType(t)}
              >
                {organizationLabels[t]}
              </button>
            ))}
          </div>
          <div
            className="hub-workspace-panel"
            role="tabpanel"
            tabIndex={0}
            id="workspace-description"
            aria-labelledby={`workspace-tab-${type}`}
          >
            <div>
              <span className="hub-workspace-type">
                <TypeIcon size={20} />
                {organizationLabels[type]}
              </span>
              <h3>{selected.heading}</h3>
              <p>{selected.copy}</p>
              <ul>
                {selected.features.map((f) => (
                  <li key={f}>
                    <Check size={17} />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                className="button button-primary"
                to={`/register?type=${type}`}
              >
                Get started as{" "}
                {type === "client"
                  ? "a buyer"
                  : type === "other"
                    ? "a partner"
                    : `a ${organizationLabels[type].toLowerCase()}`}
                <ArrowUpRight size={16} />
              </Link>
            </div>
            <div className="hub-workspace-journey">
              <span>FROM FIRST STEP TO WHAT’S NEXT</span>
              {selected.journey.map((title, i) => (
                <div key={title}>
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <strong>{title}</strong>
                  {i === selected.journey.length - 1 ? (
                    <CircleCheck size={21} />
                  ) : (
                    <ArrowRight size={19} />
                  )}
                </div>
              ))}
              <p>
                <LockKeyhole size={15} /> Your records. Your team. The right
                access.
              </p>
            </div>
          </div>
        </section>
        <section className="hub-section hub-lifecycle" id="lifecycle">
          <div className="hub-section-heading">
            <div>
              <span className="hub-eyebrow">END TO END, IN CONTEXT</span>
              <h2>
                Every step belongs
                <br />
                to the bigger picture.
              </h2>
            </div>
            <p>
              Follow a requirement through the complete procurement lifecycle.
              Select a stage to see what happens there.
            </p>
          </div>
          <div
            className="hub-lifecycle-tabs"
            role="tablist"
            onKeyDown={tabKeys}
            aria-label="Procurement lifecycle"
          >
            {lifecycle.map((s, i) => (
              <button
                key={s.title}
                role="tab"
                id={`stage-${i}`}
                tabIndex={stage === i ? 0 : -1}
                aria-selected={stage === i}
                aria-controls="lifecycle-description"
                onClick={() => setStage(i)}
              >
                <span>{String(i + 1).padStart(2, "0")}</span>
                {s.title}
              </button>
            ))}
          </div>
          <div
            className="hub-lifecycle-panel"
            role="tabpanel"
            tabIndex={0}
            id="lifecycle-description"
            aria-labelledby={`stage-${stage}`}
          >
            <div className="hub-lifecycle-icon">
              <step.Icon size={48} strokeWidth={1.2} />
              <span>STEP {String(stage + 1).padStart(2, "0")}</span>
            </div>
            <div>
              <span className="hub-card-kicker">
                {step.title.toUpperCase()}
              </span>
              <h3>{step.lead}</h3>
              <p>{step.copy}</p>
              <Link className="hub-text-link" to={`/app/${step.module}`}>
                Open your workspace <ArrowUpRight size={16} />
              </Link>
            </div>
            <ul>
              {step.details.map((d) => (
                <li key={d}>
                  <CircleCheck size={17} />
                  {d}
                </li>
              ))}
            </ul>
          </div>
        </section>
        <section className="hub-ai">
          <div className="hub-ai-copy">
            <span className="hub-ai-badge">
              <Sparkles size={15} /> MEET VS AI · YOUR WORKSPACE ASSISTANT
            </span>
            <h2>
              A clearer view.
              <br />A better next step.
            </h2>
            <p>
              Turn the context in your workspace into useful answers. Draft
              requirements, understand quotations and extract document details
              with VS AI.
            </p>
            <Link className="button button-lime button-large" to="/app/ai">
              Work with VS AI <ArrowUpRight size={18} />
            </Link>
            <small>
              Grounded in the records your role can access. Every business
              decision stays with your team.
            </small>
          </div>
          <div className="hub-ai-tools">
            {[
              {
                Icon: FileText,
                title: "Shape your next requirement",
                copy: "Turn a business brief into a draft you can review.",
                mode: "draft",
              },
              {
                Icon: GitCompareArrows,
                title: "Make sense of the responses",
                copy: "Identify differences, gaps and clarification questions.",
                mode: "comparison",
              },
              {
                Icon: Search,
                title: "Find relevant expertise",
                copy: "Match your needs with verified partner capabilities.",
                mode: "discovery",
              },
              {
                Icon: FileCheck2,
                title: "Get clarity from documents",
                copy: "Extract readable text and fields for your review.",
                mode: "document",
              },
            ].map((t) => (
              <Link key={t.mode} to={`/app/ai?mode=${t.mode}`}>
                <span>
                  <t.Icon size={22} />
                </span>
                <div>
                  <strong>{t.title}</strong>
                  <p>{t.copy}</p>
                </div>
                <ArrowUpRight size={17} />
              </Link>
            ))}
          </div>
        </section>
        <section className="hub-section hub-trust">
          <div>
            <span className="hub-eyebrow">
              CONFIDENCE IS PART OF THE WORKFLOW
            </span>
            <h2>
              Built for relationships
              <br />
              that matter.
            </h2>
            <p>
              Trust needs more than a badge. Keep identities, permissions,
              documents and decisions connected to the work.
            </p>
            <Link to="/partners" className="hub-text-link">
              Explore the partner network <ArrowUpRight size={17} />
            </Link>
          </div>
          <div className="hub-trust-grid">
            {[
              {
                Icon: Fingerprint,
                title: "One verified identity",
                text: "Company and document review before transactions begin.",
              },
              {
                Icon: LockKeyhole,
                title: "Access with purpose",
                text: "Organization and role permissions govern records and actions.",
              },
              {
                Icon: FileCheck2,
                title: "Documents that stay current",
                text: "Version history, expiry rules and renewal reminders.",
              },
              {
                Icon: ShieldCheck,
                title: "Decisions with a trail",
                text: "Approval steps, signing evidence and recorded activity.",
              },
            ].map((t) => (
              <article key={t.title}>
                <t.Icon size={23} />
                <h3>{t.title}</h3>
                <p>{t.text}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="hub-final-cta">
          <div>
            <span className="hub-eyebrow">
              YOUR NEXT CHAPTER STARTS WITH A CONNECTION
            </span>
            <h2>
              Let’s build better
              <br />
              <em>business, together.</em>
            </h2>
          </div>
          <div>
            <Link className="button button-primary button-large" to="/register">
              Become a VS partner <ArrowUpRight size={19} />
            </Link>
            <Link className="hub-text-link" to="/contact">
              Talk to our team <ArrowRight size={16} />
            </Link>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
