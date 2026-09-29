import { useState, type FormEvent } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  Eye,
  EyeOff,
  FileCheck2,
  Handshake,
  Layers3,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Waypoints,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { api, useApi } from "../lib/api";
import {
  Button,
  Field,
  FormError,
  Input,
  Loading,
  Logo,
  useToast,
} from "../components/ui";
import { organizationIcons } from "../components/icons";
import {
  organizationTypes,
  organizationLabels,
  organizationDescriptions,
} from "../../shared/domain";
import { demoAccounts, demoPassword } from "../../shared/demo";

export function Landing() {
  const { user, demo } = useAuth();
  return (
    <div className="public-page">
      <nav className="public-nav">
        <Link to="/">
          <Logo />
        </Link>
        <div className="public-links">
          <a href="#platform">The platform</a>
          <a href="#partners">Who it’s for</a>
          <a href="#how-it-works">How it works</a>
        </div>
        <div className="public-nav-actions">
          <Link className="text-button" to={user ? "/app" : "/login"}>
            {user ? "Your workspace" : "Sign in"}
            <ArrowUpRight size={16} />
          </Link>
          <Link className="button button-primary" to="/register">
            Become a partner
            <ArrowRight size={16} />
          </Link>
        </div>
      </nav>
      <section className="landing-hero">
        <div className="hero-copy">
          <span className="overline-pill">
            <span />A BETTER WAY TO DO BUSINESS
          </span>
          <h1>
            Great partnerships.
            <br />
            <em>Greater possibilities.</em>
          </h1>
          <p>
            Meet your next partner. Move your business forward.
            <br className="desktop-break" /> One connected workspace for your
            entire business network.
          </p>
          <div className="hero-buttons">
            <Link className="button button-primary button-large" to="/register">
              Build your next partnership
              <ArrowUpRight size={18} />
            </Link>
            <Link
              className="button button-secondary button-large"
              to={demo ? "/login?demo=true" : "/login"}
            >
              {demo ? "Explore the workspace" : "Enter your workspace"}
              <ArrowRight size={17} />
            </Link>
          </div>
          <div className="hero-assurance">
            <span>
              <ShieldCheck size={16} />
              Verified organizations
            </span>
            <span>
              <LockKeyhole size={15} />
              Secure by design
            </span>
            <span>
              <UsersRound size={16} />
              Built for every team
            </span>
          </div>
        </div>
        <div
          className="hero-visual"
          aria-label="A connected network of buyers, suppliers and talent partners"
        >
          <div className="hero-orbit orbit-one" />
          <div className="hero-orbit orbit-two" />
          <div className="hero-orbit orbit-three" />
          <div className="network-center">
            <Logo compact />
            <strong>PartnerHub</strong>
            <span>One connected ecosystem</span>
          </div>
          <div className="network-node node-top">
            <span className="node-icon sage">
              <Building2 size={22} />
            </span>
            <div>
              <strong>Verified partners</strong>
              <small>Trust at the foundation</small>
            </div>
            <CheckCircle2 size={17} />
          </div>
          <div className="network-node node-left">
            <span className="node-icon lavender">
              <UsersRound size={22} />
            </span>
            <div>
              <strong>Talent, connected</strong>
              <small>People who move you forward</small>
            </div>
          </div>
          <div className="network-node node-right">
            <span className="node-icon peach">
              <FileCheck2 size={22} />
            </span>
            <div>
              <strong>Procurement, simplified</strong>
              <small>From requirement to payment</small>
            </div>
          </div>
          <div className="network-label">
            <span />
            BETTER TOGETHER
          </div>
          <span className="orbit-dot orbit-dot-one" />
          <span className="orbit-dot orbit-dot-two" />
          <span className="orbit-dot orbit-dot-three" />
        </div>
      </section>
      <div className="platform-strip">
        <span>
          One shared identity.
          <br />
          <strong>Endless ways to collaborate.</strong>
        </span>
        <div>
          <b>09</b>
          <span>Organization types</span>
        </div>
        <div>
          <b>20+</b>
          <span>Connected capabilities</span>
        </div>
        <div>
          <b>01</b>
          <span>Unified workspace</span>
        </div>
        <a href="#platform" aria-label="Explore platform">
          <ArrowDown size={24} />
        </a>
      </div>
      <section className="landing-section" id="platform">
        <div className="section-intro">
          <span className="eyebrow">LESS FRICTION. MORE FORWARD.</span>
          <h2>
            Everything your partnerships
            <br />
            need to thrive.
          </h2>
          <p>
            Bring your partners, procurement and people together.
            <br />
            Give every team the clarity to do their best work.
          </p>
        </div>
        <div className="feature-grid">
          {[
            {
              Icon: ShieldCheck,
              title: "Start with trust",
              text: "Structured onboarding, verified documents and a single company profile. A stronger foundation for every relationship.",
              color: "sage",
              tag: "IDENTITY & COMPLIANCE",
            },
            {
              Icon: Waypoints,
              title: "Keep business moving",
              text: "Connect requirements, quotations, purchase orders and payments. See every commitment through to completion.",
              color: "peach",
              tag: "SOURCE TO SETTLEMENT",
            },
            {
              Icon: UsersRound,
              title: "Find your next great hire",
              text: "Give recruitment partners a dedicated space to submit candidates, coordinate interviews and track joining.",
              color: "lavender",
              tag: "PEOPLE & POSSIBILITIES",
            },
          ].map((f) => (
            <div className={`feature-card ${f.color}`} key={f.title}>
              <span className="feature-icon">
                <f.Icon size={26} />
              </span>
              <span className="eyebrow">{f.tag}</span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
              <Link to="/register">
                Explore the possibilities
                <ArrowUpRight size={17} />
              </Link>
            </div>
          ))}
        </div>
      </section>
      <section className="partner-section" id="partners">
        <div className="section-intro">
          <span className="eyebrow">A PLACE FOR EVERY PARTNER</span>
          <h2>
            Different expertise.
            <br />
            Shared ambition.
          </h2>
          <p>A workspace that fits the way your organization works.</p>
        </div>
        <div className="partner-type-grid">
          {organizationTypes.map((type) => {
            const Icon = organizationIcons[type];
            return (
              <Link to={`/register?type=${type}`} key={type}>
                <Icon size={22} />
                <div>
                  <h3>{organizationLabels[type]}</h3>
                  <p>{organizationDescriptions[type]}</p>
                </div>
                <ArrowUpRight size={17} />
              </Link>
            );
          })}
        </div>
      </section>
      <section className="landing-section" id="how-it-works">
        <div className="section-intro">
          <span className="eyebrow">YOUR NEXT CHAPTER STARTS HERE</span>
          <h2>
            From hello to
            <br />
            let’s do business.
          </h2>
        </div>
        <div className="how-grid">
          {[
            [
              "01",
              "Tell us about your business",
              "Choose your organization type and build a profile that reflects what you do best.",
            ],
            [
              "02",
              "Get verified",
              "Share your documents. Our team reviews your application and helps you get ready.",
            ],
            [
              "03",
              "Make great things happen",
              "Discover opportunities, collaborate with partners and manage every step in one place.",
            ],
          ].map(([number, title, text]) => (
            <div key={number}>
              <span>{number}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="landing-cta">
        <div>
          <span className="eyebrow">LET’S GROW, TOGETHER.</span>
          <h2>
            Your next opportunity
            <br />
            is a partnership away.
          </h2>
        </div>
        <Link to="/register" className="button button-lime button-large">
          Join VS PartnerHub
          <ArrowUpRight size={20} />
        </Link>
      </section>
      <footer className="public-footer">
        <Logo />
        <p>
          A Vijay Software Solutions platform.
          <br />
          Business, better connected.
        </p>
        <div>
          <Link to="/privacy">Privacy policy</Link>
          <Link to="/terms">Terms of use</Link>
          <Link to="/login">Partner sign in</Link>
        </div>
        <small>
          © {new Date().getFullYear()} Vijay Software Solutions Pvt. Ltd.
        </small>
      </footer>
    </div>
  );
}
export function AuthFrame({
  children,
  subtitle = "The right connections change everything.",
}: {
  children: React.ReactNode;
  subtitle?: string;
}) {
  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <Link to="/">
          <Logo light />
        </Link>
        <div className="auth-aside-copy">
          <span className="overline-pill">
            YOUR BUSINESS. BETTER CONNECTED.
          </span>
          <h1>{subtitle}</h1>
          <p>
            One trusted workspace for your partners, procurement and people.
          </p>
          <div className="auth-illustration">
            <div className="auth-illustration-center">
              <Handshake size={52} />
            </div>
            <span>
              <ShieldCheck size={27} />
            </span>
            <span>
              <Building2 size={27} />
            </span>
            <span>
              <UsersRound size={27} />
            </span>
            <i />
            <i />
          </div>
          <div className="auth-trust">
            <CheckCircle2 size={19} />
            <div>
              <strong>Built on trust. Designed for growth.</strong>
              <small>A Vijay Software Solutions platform</small>
            </div>
          </div>
        </div>
        <div className="auth-aside-footer">
          <span>© {new Date().getFullYear()} VS Solutions</span>
          <span>One network. More possibilities.</span>
        </div>
      </aside>
      <main className="auth-main">
        <div className="auth-mobile-brand">
          <Link to="/">
            <Logo />
          </Link>
        </div>
        {children}
        <div className="auth-footer">
          <ShieldCheck size={14} />
          Your business information stays protected.
          <div>
            <Link to="/privacy">Privacy</Link>
            <span>·</span>
            <Link to="/terms">Terms</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
export function Login() {
  const { signIn, demo, accept } = useAuth(),
    navigate = useNavigate(),
    location = useLocation();
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [selected, setSelected] = useState("admin"),
    [challenge, setChallenge] = useState<{
      id: string;
      demoCode?: string;
    } | null>(null),
    [otp, setOtp] = useState("");
  const submit = async (
    e?: FormEvent,
    account?: (typeof demoAccounts)[number],
  ) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await signIn(
        account?.email || email,
        account ? demoPassword : password,
      );
      if (result.requiresOtp) {
        setChallenge({
          id: result.challengeId!,
          demoCode: result.verificationCode,
        });
        return;
      }
      const user = result.user!;
      const target = (location.state as any)?.from;
      navigate(
        user.email_verified
          ? target?.startsWith("/app")
            ? target
            : "/app"
          : "/verify",
      );
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  if (challenge)
    return (
      <AuthFrame>
        <div className="auth-form-wrap">
          <span className="eyebrow">ONE MORE STEP TO YOUR WORKSPACE</span>
          <h1>A quick security check.</h1>
          <p className="auth-description">
            Enter the six-digit sign-in code sent to your verified email. The
            code expires in 10 minutes.
          </p>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                const result = await api("/auth/verify-login", {
                  method: "POST",
                  body: JSON.stringify({
                    challengeId: challenge.id,
                    code: otp,
                  }),
                });
                accept(result);
                navigate("/app");
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            <FormError error={error} />
            <Field label="Sign-in code" required>
              <Input
                className="input otp-input"
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                pattern="[0-9]{6}"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                required
              />
            </Field>
            <Button type="submit" busy={busy}>
              Verify and sign in
              <ArrowRight size={16} />
            </Button>
          </form>
          {demo && challenge.demoCode && (
            <div className="dev-code">
              <strong>Local development code</strong>
              <code>{challenge.demoCode}</code>
            </div>
          )}
          <button
            className="text-button space-top"
            onClick={() => {
              setChallenge(null);
              setOtp("");
              setError(null);
            }}
          >
            Return to sign in
          </button>
        </div>
      </AuthFrame>
    );
  return (
    <AuthFrame>
      <div className="auth-form-wrap">
        <span className="eyebrow">WELCOME BACK</span>
        <h1>Your workspace awaits.</h1>
        <p className="auth-description">
          Sign in to keep your business moving forward.
        </p>
        <form onSubmit={submit} className="form-stack">
          <FormError error={error} />
          <Field label="Work email" required>
            <Input
              type="email"
              autoComplete="email"
              name="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Password" required>
            <div className="password-input">
              <Input
                type={show ? "text" : "password"}
                name="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShow(!show)}
                aria-label={show ? "Hide password" : "Show password"}
              >
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </Field>
          <div className="form-right">
            <Link to="/forgot-password">Forgot password?</Link>
          </div>
          <Button type="submit" busy={busy} className="full-width">
            Sign in to PartnerHub
            <ArrowRight size={17} />
          </Button>
        </form>
        <p className="auth-bottom-link">
          New to our network?{" "}
          <Link to="/register">
            Become a partner
            <ArrowUpRight size={14} />
          </Link>
        </p>
        {demo && (
          <div className="demo-login">
            <div className="demo-login-title">
              <Sparkles size={17} />
              <strong>Take a look around</strong>
              <span>LOCAL DEMO</span>
            </div>
            <p>Explore a complete workspace with fictional company data.</p>
            <select
              className="input"
              aria-label="Demo workspace role"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {demoAccounts.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label} — {a.name}
                </option>
              ))}
            </select>
            <Button
              variant="secondary"
              busy={busy}
              className="full-width"
              onClick={() =>
                submit(
                  undefined,
                  demoAccounts.find((a) => a.key === selected),
                )
              }
            >
              Explore {demoAccounts.find((a) => a.key === selected)?.label}{" "}
              workspace
              <ArrowRight size={16} />
            </Button>
          </div>
        )}
      </div>
    </AuthFrame>
  );
}
export function Recovery({ mode }: { mode: "forgot" | "reset" | "invite" }) {
  const [params] = useSearchParams(),
    token = params.get("token") || "",
    [error, setError] = useState<unknown>(),
    [done, setDone] = useState(false),
    [busy, setBusy] = useState(false);
  const { accept } = useAuth(),
    navigate = useNavigate();
  const invitation = useApi<any>(
    `/auth/invitation/${encodeURIComponent(token)}`,
    mode === "invite" && Boolean(token),
  );
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const result = await api(
        `/auth/${mode === "forgot" ? "forgot-password" : mode === "reset" ? "reset-password" : "accept-invitation"}`,
        {
          method: "POST",
          body: JSON.stringify({
            ...data,
            ...(mode === "forgot" ? {} : { token }),
          }),
        },
      );
      if (mode === "invite") {
        accept(result);
        navigate("/app");
      } else setDone(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthFrame>
      <div className="auth-form-wrap">
        <Link className="back-link" to="/login">
          ← Back to sign in
        </Link>
        <h1>
          {mode === "forgot"
            ? "Let’s get you back in."
            : mode === "reset"
              ? "A fresh start."
              : "You’re invited."}
        </h1>
        <p className="auth-description">
          {mode === "forgot"
            ? "Enter your work email and we’ll send a reset link."
            : mode === "reset"
              ? "Choose a strong password for your workspace."
              : `Join your team on VS PartnerHub${invitation.data ? ` as ${invitation.data.name}` : ""}.`}
        </p>
        {done ? (
          <div className="success-panel">
            <CheckCircle2 size={34} />
            <h3>
              {mode === "forgot"
                ? "Check your inbox"
                : "Your password is updated"}
            </h3>
            <p>
              {mode === "forgot"
                ? "If this address is registered, a reset link has been sent. It expires in 30 minutes."
                : "Sign in with your new password to continue."}
            </p>
            <Link className="button button-primary" to="/login">
              Return to sign in
            </Link>
          </div>
        ) : (
          <form className="form-stack" onSubmit={submit}>
            <FormError error={error || invitation.error} />
            {mode === "forgot" ? (
              <Field label="Work email" required>
                <Input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                />
              </Field>
            ) : (
              <>
                {mode === "invite" && (
                  <Field label="Your name" required>
                    <Input
                      name="name"
                      defaultValue={invitation.data?.name}
                      required
                      minLength={2}
                    />
                  </Field>
                )}
                <Field
                  label="New password"
                  required
                  hint="At least 12 characters, including uppercase, lowercase and a number."
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
              </>
            )}
            <Button
              busy={busy}
              disabled={mode === "invite" && !invitation.data}
              type="submit"
            >
              {mode === "forgot"
                ? "Send reset link"
                : mode === "reset"
                  ? "Update password"
                  : "Create your account"}
              <ArrowRight size={16} />
            </Button>
          </form>
        )}
      </div>
    </AuthFrame>
  );
}
export function Legal({ type }: { type: "privacy" | "terms" }) {
  return (
    <div className="legal-page">
      <nav className="public-nav">
        <Link to="/">
          <Logo />
        </Link>
        <Link to="/login" className="text-link">
          Partner sign in
          <ArrowRight size={16} />
        </Link>
      </nav>
      <article>
        <span className="eyebrow">VS PARTNERHUB</span>
        <h1>
          {type === "privacy" ? "Privacy & your information" : "Terms of use"}
        </h1>
        <p className="muted">Platform policy · Updated September 2026</p>
        {type === "privacy" ? (
          <>
            <h2>Information in your workspace</h2>
            <p>
              VS PartnerHub stores organization profiles, authorized contact
              details, business documents and records needed for procurement,
              service delivery and recruitment. Candidate data should be
              submitted only with appropriate consent and a valid recruitment
              purpose.
            </p>
            <h2>How access works</h2>
            <p>
              Information is restricted by organization, role and transaction
              relationship. Verified directory profiles expose business
              capabilities; legal documents, bank documents and candidate
              records are restricted. Authorized VS teams may access information
              needed to verify and operate the platform.
            </p>
            <h2>Retention and your choices</h2>
            <p>
              You can edit your company profile and notification preferences.
              Closed recruitment records are anonymized after the configured
              retention period. Audit records and commercial documents may need
              to be retained for business or legal obligations. Contact the
              support team from your workspace to request access, correction or
              deletion; requests are reviewed against applicable obligations.
            </p>
            <h2>Notifications and processors</h2>
            <p>
              Account and workflow emails are delivered through the configured
              email provider. Operational records may be included in encrypted
              infrastructure backups. Do not upload unnecessary personal
              information or full bank credentials.
            </p>
            <h2>Contact</h2>
            <p>
              Use Support in your authenticated workspace to reach the VS team
              about privacy or account access.
            </p>
          </>
        ) : (
          <>
            <h2>Who can use PartnerHub</h2>
            <p>
              Use the platform only on behalf of an organization you are
              authorized to represent. Keep company details accurate and provide
              documents you are entitled to share. Registration does not
              guarantee approval or business opportunities.
            </p>
            <h2>Your account and responsibilities</h2>
            <p>
              Protect your credentials, grant access only to authorized
              colleagues and report suspected misuse. Do not upload malicious
              material, infringe third-party rights or attempt to access another
              organization’s restricted information.
            </p>
            <h2>Commercial transactions</h2>
            <p>
              Requirements, quotations, orders and contracts are managed by the
              authorized parties. Review commercial terms before approving any
              commitment. A payment record on PartnerHub documents a payment; it
              does not itself move funds or prove bank settlement.
            </p>
            <h2>Recruitment</h2>
            <p>
              Submit candidates only with appropriate consent. Hiring, offer and
              background-check decisions remain with authorized hiring teams.
              Keep information relevant to the role and respect candidate
              privacy.
            </p>
            <h2>Platform operation</h2>
            <p>
              VS may request clarification, suspend access or retain audit
              records to protect the integrity of the service. Availability,
              support and any service commitments are governed by your
              organization’s agreement with VS.
            </p>
            <h2>Questions and support</h2>
            <p>
              Use the support workspace for operational questions, corrections
              and disputes. These platform terms do not replace a signed
              commercial agreement.
            </p>
          </>
        )}
        <Link to="/" className="button button-secondary">
          Back to PartnerHub
          <ArrowRight size={16} />
        </Link>
      </article>
    </div>
  );
}
