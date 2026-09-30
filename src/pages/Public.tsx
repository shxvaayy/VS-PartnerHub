import { useState, type FormEvent } from "react";
import { PasswordField, useCountdown } from "../components/AuthControls";
import { emailHint } from "../../shared/auth";
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
import EmailDeliveryStatus from "../components/EmailDeliveryStatus";

export { default as Landing } from "./Home";
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
          <div className="auth-illustration" aria-hidden="true">
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
  const setup = useApi<any>("/public/setup");
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [selected, setSelected] = useState("admin"),
    [challenge, setChallenge] = useState<{
      id: string;
      demoCode?: string;
      resendAt?: string;
    } | null>(null),
    [otp, setOtp] = useState("");
  const resendWait = useCountdown(challenge?.resendAt);
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
          resendAt: result.resendAt,
        });
        return;
      }
      const user = result.user!;
      const target = (location.state as any)?.from;
      navigate(
        user.email_verified
          ? typeof target === "string" && /^\/app(?:[/?]|$)/.test(target)
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
            Enter the six-digit code requested for{" "}
            <strong>{email.trim()}</strong>. Your code expires in 10 minutes.
          </p>
          <EmailDeliveryStatus challengeId={challenge.id} />
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
                const target = (location.state as any)?.from;
                navigate(
                  result.user.email_verified
                    ? typeof target === "string" &&
                      /^\/app(?:[/?]|$)/.test(target)
                      ? target
                      : "/app"
                    : "/verify",
                  { replace: true },
                );
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
          <Button
            variant="ghost"
            disabled={busy || resendWait > 0}
            onClick={async () => {
              setBusy(true);
              setError(undefined);
              try {
                const result = await api("/auth/resend-login", {
                  method: "POST",
                  body: JSON.stringify({ challengeId: challenge.id }),
                });
                setChallenge({
                  id: result.challengeId,
                  demoCode: result.verificationCode,
                  resendAt: result.resendAt,
                });
                setOtp("");
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {resendWait > 0
              ? `Resend code in ${resendWait}s`
              : "Resend sign-in code"}
          </Button>
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
          <Field label="Work email" required hint={emailHint}>
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
          <PasswordField
            label="Password"
            name="password"
            autoComplete="current-password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
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
        {setup.data?.available && (
          <p className="auth-bottom-link">
            New installation?{" "}
            <Link to="/setup">Create the first administrator</Link>
          </p>
        )}
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
  const { accept, refresh } = useAuth(),
    navigate = useNavigate();
  const invitation = useApi<any>(
    `/auth/invitation/${encodeURIComponent(token)}`,
    mode === "invite" && Boolean(token) && !done,
  );
  const reset = useApi<any>(
    `/auth/reset-password/${encodeURIComponent(token)}`,
    mode === "reset" && Boolean(token) && !done,
  );
  const link = mode === "invite" ? invitation : reset;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (mode !== "forgot" && data.password !== data.confirm_password)
        throw new Error(
          "The passwords do not match. Enter the same new password in both fields.",
        );
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
        navigate("/app", { replace: true });
      } else {
        setDone(true);
        if (mode === "reset") {
          await refresh();
          navigate("/reset-password", { replace: true });
        }
      }
    } catch (error) {
      setError(error);
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
            ? "Enter your registered email to request a secure password reset link."
            : mode === "reset"
              ? "Choose a strong password for your workspace."
              : "Your team has invited you to join VS PartnerHub. Create your account to get started."}
        </p>
        {done ? (
          <div className="success-panel">
            <CheckCircle2 size={34} />
            <h2>
              {mode === "forgot"
                ? "Check your inbox"
                : "Your password is updated"}
            </h2>
            <p>
              {mode === "forgot"
                ? "If this address has an active account, a reset email has been requested. The link works once and expires in 30 minutes. Check your spam folder too."
                : "Your previous sessions have been signed out. Sign in with your new password to continue."}
            </p>
            <Link className="button button-primary" to="/login">
              Return to sign in
            </Link>
            {mode === "forgot" && (
              <button
                className="text-button space-top"
                onClick={() => {
                  setDone(false);
                  setError(null);
                }}
              >
                Use a different email
              </button>
            )}
          </div>
        ) : mode !== "forgot" && (!token || link.error) ? (
          <div className="auth-link-error">
            <FormError
              error={
                link.error ||
                new Error(
                  "This link is incomplete. Open the full link from your email.",
                )
              }
            />
            {mode === "reset" ? (
              <Link className="button button-primary" to="/forgot-password">
                Request a new reset link
              </Link>
            ) : (
              <p>
                Ask your organization administrator to send a new invitation.
              </p>
            )}
          </div>
        ) : mode !== "forgot" && link.isPending ? (
          <p role="status">Checking your secure link…</p>
        ) : (
          <form className="form-stack" onSubmit={submit}>
            <FormError error={error} />
            {mode === "forgot" ? (
              <Field label="Work email" required hint={emailHint}>
                <Input
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  required
                />
              </Field>
            ) : (
              <>
                {mode === "invite" && (
                  <>
                    <Field label="Invited email">
                      <Input
                        type="email"
                        value={invitation.data.email}
                        readOnly
                        autoComplete="username"
                      />
                    </Field>
                    <Field label="Your name" required>
                      <Input
                        name="name"
                        defaultValue={invitation.data.name}
                        minLength={2}
                        maxLength={150}
                        autoComplete="name"
                        required
                      />
                    </Field>
                  </>
                )}
                <PasswordField
                  label="New password"
                  name="password"
                  newPassword
                  required
                />
                <PasswordField
                  label="Confirm new password"
                  name="confirm_password"
                  autoComplete="new-password"
                  minLength={12}
                  required
                />
                {mode === "invite" && (
                  <p className="auth-agreement">
                    By creating your account, you agree to the{" "}
                    <Link to="/terms">Terms</Link> and{" "}
                    <Link to="/privacy">Privacy Policy</Link>.
                  </p>
                )}
              </>
            )}
            <Button busy={busy} type="submit">
              {mode === "forgot"
                ? "Send reset link"
                : mode === "reset"
                  ? "Update password"
                  : "Create your account"}
              <ArrowRight size={16} />
            </Button>
          </form>
        )}
        <p className="auth-bottom-link">
          Need help accessing your account?{" "}
          <Link to="/contact">Contact VS support</Link>
        </p>
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
