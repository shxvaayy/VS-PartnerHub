import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PasswordField, useCountdown } from "../components/AuthControls";
import { emailHint } from "../../shared/auth";
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  FileCheck2,
  Mail,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import { AuthFrame } from "./Public";
import EmailDeliveryStatus, {
  useEmailDelivery,
} from "../components/EmailDeliveryStatus";
import { useAuth } from "../lib/auth";
import { api, useApi } from "../lib/api";
import {
  Button,
  Field,
  FormError,
  Input,
  Loading,
  Logo,
  Modal,
  useToast,
} from "../components/ui";
import { organizationIcons } from "../components/icons";
import {
  categories,
  contactRoles,
  organizationTypes,
  organizationLabels,
  organizationDescriptions,
  type OrganizationType,
} from "../../shared/domain";
export default function Onboarding() {
  const [params] = useSearchParams(),
    navigate = useNavigate(),
    { accept } = useAuth();
  const selected = params.get("type") as OrganizationType;
  const [step, setStep] = useState(0),
    [type, setType] = useState<OrganizationType>(
      organizationTypes.includes(selected) ? selected : "vendor",
    );
  const [data, setData] = useState<Record<string, any>>({
    name: "",
    email: "",
    password: "",
    contact_role: "Authorized Representative",
    legal_name: "",
    trade_name: "",
    company_type: "Private Limited",
    industry: categories[0],
    city: "",
    country: "India",
    website: "",
    contact_phone: "",
    address: "",
    description: "",
    capabilities: "",
    pan: "",
    gst: "",
    cin: "",
    locations: "",
    hiring_types: [],
    accept_terms: false,
  });
  const configuration = useApi<any>(`/public/config?type=${type}`);
  const requiredPolicies: { category: string; expiry_required: boolean }[] =
    configuration.data?.documents?.filter((p: any) => p.required) || [
      { category: "PAN", expiry_required: false },
      { category: "Incorporation", expiry_required: false },
    ];
  const [fileExpiries, setFileExpiries] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File | null>>({
    PAN: null,
    Incorporation: null,
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const set = (key: string, value: any) =>
    setData((d) => ({ ...d, [key]: value }));
  const textField = (
    name: string,
    title: string,
    required = false,
    placeholder = "",
    inputType = "text",
  ) => (
    <Field
      key={name}
      label={title}
      required={required}
      hint={inputType === "email" ? emailHint : undefined}
    >
      <Input
        name={name}
        type={inputType}
        value={data[name] || ""}
        onChange={(e) => set(name, e.target.value)}
        required={required}
        placeholder={placeholder}
      />
    </Field>
  );
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (step === 1 && data.password !== data.confirm_password) {
      setError(new Error("Both passwords must match."));
      return;
    }
    if (step < 4) {
      setStep(step + 1);
      window.scrollTo(0, 0);
      return;
    }
    setBusy(true);
    try {
      const detailKeys = [
        "company_type",
        "company_email",
        "linkedin",
        "contact_role",
        "pan",
        "gst",
        "cin",
        "address",
        "description",
        "capabilities",
        "locations",
        "products",
        "services",
        "domains",
        "hiring_types",
        "experience",
        "recruiters",
        "moq",
        "lead_time",
        "delivery_locations",
        "warehouse",
        "technologies",
        "integrations",
        "documentation_url",
        "pricing_model",
        "procurement_categories",
        "annual_budget",
        "payment_terms",
        "resources",
        "partner_contact",
      ];
      const details = Object.fromEntries(
        detailKeys
          .filter((k) => data[k] !== undefined)
          .map((k) => [k, data[k]]),
      );
      const organization = {
        type,
        legal_name: data.legal_name,
        trade_name: data.trade_name,
        industry: data.industry,
        city: data.city,
        country: data.country,
        website: data.website,
        contact_name: data.name,
        contact_email: data.email,
        contact_phone: data.contact_phone,
        details,
      };
      const result = await api("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          name: data.name,
          email: data.email,
          password: data.password,
          organization,
          accept_terms: data.accept_terms,
        }),
      });
      accept(result);
      const uploadErrors: string[] = [];
      for (const [category, file] of Object.entries(files))
        if (file) {
          const form = new FormData();
          form.set("category", category);
          form.set("file", file);
          if (fileExpiries[category])
            form.set("expires_at", fileExpiries[category]);
          try {
            await api("/documents", { method: "POST", body: form });
          } catch {
            uploadErrors.push(category);
          }
        }
      navigate("/verify", {
        state: {
          code: result.verificationCode,
          resendAt: result.resendAt,
          uploadErrors,
        },
      });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const steps = [
    "Organization",
    "Your role",
    "Company details",
    "Your business",
    "Documents",
  ];
  return (
    <div className="onboarding-page">
      <nav className="public-nav">
        <Link to="/">
          <Logo />
        </Link>
        <span>
          Already a partner?{" "}
          <Link to="/login">
            Sign in <ArrowRight size={14} />
          </Link>
        </span>
      </nav>
      <div className="onboarding-layout">
        <aside className="onboarding-sidebar">
          <span className="eyebrow">LET’S BUILD SOMETHING GREAT</span>
          <h1>
            Your next chapter
            <br />
            starts here.
          </h1>
          <p>
            Tell us a little about your business.
            <br />
            We’ll help you find your place in the network.
          </p>
          <ol className="onboarding-steps">
            {steps.map((title, i) => (
              <li
                key={title}
                className={i === step ? "current" : i < step ? "done" : ""}
              >
                <span>{i < step ? <Check size={16} /> : i + 1}</span>
                <div>
                  <strong>{title}</strong>
                  <small>
                    {
                      [
                        "Choose your workspace",
                        "Your authorized contact",
                        "Your company identity",
                        "What makes you, you",
                        "Build a foundation of trust",
                      ][i]
                    }
                  </small>
                </div>
              </li>
            ))}
          </ol>
          <div className="onboarding-reassurance">
            <ShieldCheck size={25} />
            <strong>In good company.</strong>
            <p>
              Your information is protected and reviewed by our dedicated
              verification team.
            </p>
          </div>
        </aside>
        <main className="onboarding-content">
          <div className="onboarding-progress">
            <span>STEP {step + 1} OF 5</span>
            <div>
              <i style={{ width: `${(step + 1) * 20}%` }} />
            </div>
          </div>
          <form onSubmit={submit}>
            <div className="onboarding-heading">
              <h2>
                {
                  [
                    "How will you partner with us?",
                    "Let’s make an introduction.",
                    "Tell us about your company.",
                    "Show us what you do best.",
                    "A little paperwork. A lot of trust.",
                  ][step]
                }
              </h2>
              <p>
                {
                  [
                    "Choose the relationship that best fits your organization.",
                    "Your role helps us connect the right people to the right opportunities.",
                    "Use your registered company information for a smooth verification.",
                    "Your workspace will be tailored to your organization’s capabilities.",
                    "Upload your PAN and incorporation certificate for company verification.",
                  ][step]
                }
              </p>
            </div>
            <FormError error={error} />
            {configuration.error && <FormError error={configuration.error} />}
            {configuration.data &&
              !configuration.data.emailVerificationAvailable && (
                <div className="data-policy-note">
                  New partner registration is temporarily unavailable.{" "}
                  <Link className="text-link" to="/contact">
                    Contact the VS team
                  </Link>{" "}
                  for help getting started.
                </div>
              )}
            {step === 0 && (
              <div className="onboarding-types">
                {organizationTypes.map((value) => {
                  const Icon = organizationIcons[value];
                  return (
                    <label
                      className={`onboarding-type ${type === value ? "selected" : ""}`}
                      key={value}
                    >
                      <input
                        type="radio"
                        name="organization_type"
                        value={value}
                        checked={type === value}
                        onChange={() => setType(value)}
                      />
                      <span className="type-icon">
                        <Icon size={23} />
                      </span>
                      <div>
                        <strong>{organizationLabels[value]}</strong>
                        <small>{organizationDescriptions[value]}</small>
                      </div>
                      <span className="radio-indicator">
                        {type === value && <Check size={12} />}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            {step === 1 && (
              <div className="form-grid">
                <Field label="Your authorized role" required className="span-2">
                  <select
                    className="input"
                    name="contact_role"
                    value={data.contact_role}
                    onChange={(e) => set("contact_role", e.target.value)}
                  >
                    {contactRoles.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </Field>
                {textField("name", "Full name", true, "Your name")}
                {textField(
                  "email",
                  "Work email",
                  true,
                  "you@company.com",
                  "email",
                )}
                {textField("contact_phone", "Phone number", true, "+91", "tel")}
                <PasswordField
                  label="Create a password"
                  name="password"
                  newPassword
                  value={data.password}
                  onChange={(e) => set("password", e.target.value)}
                  required
                />
                <PasswordField
                  label="Confirm password"
                  name="confirm_password"
                  autoComplete="new-password"
                  minLength={12}
                  value={data.confirm_password || ""}
                  onChange={(e) => set("confirm_password", e.target.value)}
                  required
                />
              </div>
            )}
            {step === 2 && (
              <div className="form-grid">
                {textField(
                  "legal_name",
                  "Registered company name",
                  true,
                  "As shown on your registration certificate",
                )}
                {textField("trade_name", "Trade / brand name")}
                {textField(
                  "company_email",
                  "Company email (recommended)",
                  false,
                  "contact@company.com",
                  "email",
                )}
                {textField(
                  "linkedin",
                  "Company LinkedIn",
                  false,
                  "https://www.linkedin.com/company/…",
                  "url",
                )}
                <Field label="Company type" required>
                  <select
                    name="company_type"
                    className="input"
                    value={data.company_type}
                    onChange={(e) => set("company_type", e.target.value)}
                  >
                    {[
                      "Private Limited",
                      "Public Limited",
                      "LLP",
                      "Partnership",
                      "Proprietorship",
                      "Nonprofit",
                      "Other",
                    ].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Industry" required>
                  <select
                    name="industry"
                    className="input"
                    value={data.industry}
                    onChange={(e) => set("industry", e.target.value)}
                  >
                    {(
                      configuration.data?.lists.industry?.map(
                        (c: any) => c.label,
                      ) || categories
                    ).map((c: string) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                {textField("city", "City", true)}
                {textField("country", "Country", true)}
                {textField("address", "Registered address", true)}
                {textField(
                  "website",
                  "Company website",
                  false,
                  "https://",
                  "url",
                )}
                {textField("pan", "PAN", false, "ABCDE1234F")}
                {textField("gst", "GSTIN", false, "If applicable")}
                {textField("cin", "CIN / registration number")}
              </div>
            )}
            {step === 3 && (
              <div className="form-grid">
                <div className="selected-type-summary span-2">
                  {(() => {
                    const Icon = organizationIcons[type];
                    return <Icon size={22} />;
                  })()}
                  <div>
                    <strong>{organizationLabels[type]} workspace</strong>
                    <span>Purpose-built for your business</span>
                  </div>
                </div>
                <Field label="About your company" required className="span-2">
                  <textarea
                    name="description"
                    className="input"
                    rows={3}
                    value={data.description}
                    onChange={(e) => set("description", e.target.value)}
                    required
                    placeholder="What does your company do, and what sets you apart?"
                  />
                </Field>
                {textField(
                  "locations",
                  "Locations served",
                  true,
                  "Bengaluru, Hyderabad, Pan India…",
                )}
                {textField("capabilities", "Core capabilities", true)}
                {["recruitment", "staffing"].includes(type) && (
                  <>
                    {textField(
                      "domains",
                      "Recruitment domains",
                      true,
                      "IT, Non-IT, healthcare, finance…",
                    )}
                    {textField(
                      "experience",
                      "Years of experience",
                      true,
                      "5",
                      "number",
                    )}
                    {textField("recruiters", "Recruiter contacts / team", true)}
                    <fieldset className="field span-2">
                      <legend className="field-label">
                        Hiring capabilities
                      </legend>
                      <div className="checkbox-grid">
                        {[
                          "Permanent Hiring",
                          "Contract Staffing",
                          "Campus Hiring",
                          "Executive Hiring",
                          "IT Recruitment",
                          "Non-IT Recruitment",
                        ].map((t) => (
                          <label key={t}>
                            <input
                              type="checkbox"
                              checked={data.hiring_types.includes(t)}
                              onChange={(e) =>
                                set(
                                  "hiring_types",
                                  e.target.checked
                                    ? [...data.hiring_types, t]
                                    : data.hiring_types.filter(
                                        (s: string) => s !== t,
                                      ),
                                )
                              }
                            />
                            {t}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </>
                )}
                {type === "supplier" && (
                  <>
                    {textField("products", "Product categories", true)}
                    {textField(
                      "moq",
                      "Typical minimum order quantity",
                      true,
                      "10",
                      "number",
                    )}
                    {textField(
                      "lead_time",
                      "Typical lead time",
                      true,
                      "7–14 business days",
                    )}
                    {textField("delivery_locations", "Delivery coverage", true)}
                    {textField("warehouse", "Warehouse locations")}
                  </>
                )}
                {type === "client" && (
                  <>
                    {textField(
                      "procurement_categories",
                      "Procurement categories",
                      true,
                    )}
                    {textField(
                      "annual_budget",
                      "Indicative annual procurement budget",
                    )}
                    {textField(
                      "payment_terms",
                      "Standard payment terms",
                      false,
                      "Net 30",
                    )}
                    {textField("partner_contact", "Procurement team contact")}
                  </>
                )}
                {type === "technology_partner" && (
                  <>
                    {textField(
                      "technologies",
                      "Products & technology expertise",
                      true,
                      "SaaS, AI / ML, cloud, cybersecurity…",
                    )}
                    {textField("integrations", "APIs & integrations", true)}
                    {textField(
                      "documentation_url",
                      "Documentation URL",
                      false,
                      "https://",
                      "url",
                    )}
                    {textField("partner_contact", "Technical / demo contact")}
                  </>
                )}
                {type === "service_provider" && (
                  <>
                    {textField(
                      "services",
                      "Service categories",
                      true,
                      "IT, consulting, training, logistics…",
                    )}
                    {textField(
                      "pricing_model",
                      "Pricing model",
                      true,
                      "Project, retainer, hourly…",
                    )}
                  </>
                )}
                {["vendor", "business_partner", "other"].includes(type) && (
                  <>
                    {textField("products", "Products & solutions")}
                    {textField("services", "Services offered", true)}
                    {textField("resources", "Team / resource capabilities")}
                  </>
                )}
              </div>
            )}
            {step === 4 && (
              <div className="form-stack">
                <div className="info-banner">
                  <FileCheck2 size={22} />
                  <div>
                    <strong>Help us verify your business</strong>
                    <p>
                      PDF, PNG or JPEG · Maximum 10 MB per document. Additional
                      documents can be added from your workspace.
                    </p>
                  </div>
                </div>
                {requiredPolicies.map(({ category, expiry_required }) => (
                  <div key={category} className="form-stack">
                    <Field
                      key={category}
                      label={
                        category === "PAN"
                          ? "Company PAN"
                          : "Certificate of incorporation / registration"
                      }
                      required
                    >
                      <div
                        className={`upload-zone ${files[category] ? "has-file" : ""}`}
                      >
                        <UploadCloud size={28} />
                        <strong>
                          {files[category]?.name || "Choose a document"}
                        </strong>
                        <span>
                          {files[category]
                            ? `${(files[category]!.size / 1024).toFixed(0)} KB · Click to change`
                            : "PDF, PNG or JPEG up to 10 MB"}
                        </span>
                        <input
                          name={`document_${category}`}
                          type="file"
                          accept="application/pdf,image/png,image/jpeg"
                          required={!files[category]}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f && f.size > 10 * 1024 * 1024) {
                              setError(
                                new Error(
                                  "Please choose a document smaller than 10 MB.",
                                ),
                              );
                              return;
                            }
                            setFiles((v) => ({ ...v, [category]: f || null }));
                          }}
                          aria-label={`Upload ${category}`}
                        />
                      </div>
                    </Field>
                    {expiry_required && (
                      <Field label={`${category} expiry date`} required>
                        <Input
                          type="date"
                          required
                          value={fileExpiries[category] || ""}
                          onChange={(e) =>
                            setFileExpiries((v) => ({
                              ...v,
                              [category]: e.target.value,
                            }))
                          }
                        />
                      </Field>
                    )}
                  </div>
                ))}
                <label className="check-label terms-check">
                  <input
                    type="checkbox"
                    name="accept_terms"
                    checked={data.accept_terms}
                    onChange={(e) => set("accept_terms", e.target.checked)}
                    required
                  />
                  <span>
                    I am authorized to represent this organization. I agree to
                    the{" "}
                    <Link to="/terms" target="_blank">
                      Terms of Use
                    </Link>{" "}
                    and{" "}
                    <Link to="/privacy" target="_blank">
                      Privacy Policy
                    </Link>
                    , and confirm that this information is accurate.
                  </span>
                </label>
              </div>
            )}
            <div className="onboarding-form-footer">
              {step > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setStep(step - 1)}
                >
                  <ArrowLeft size={17} />
                  Back
                </Button>
              ) : (
                <Link to="/" className="text-button">
                  <ArrowLeft size={16} />
                  Back to home
                </Link>
              )}
              <Button
                type="submit"
                busy={busy}
                disabled={
                  step === 4 &&
                  (!configuration.data ||
                    !configuration.data.emailVerificationAvailable)
                }
              >
                {step === 4 ? "Create your partner account" : "Continue"}
                <ArrowRight size={17} />
              </Button>
            </div>
          </form>
        </main>
      </div>
    </div>
  );
}
export function VerifyEmail() {
  const { user, loading, refresh, accept, signOut, demo } = useAuth(),
    location = useLocation(),
    navigate = useNavigate(),
    toast = useToast(),
    client = useQueryClient();
  const [code, setCode] = useState(""),
    [demoCode, setDemoCode] = useState((location.state as any)?.code || ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [correcting, setCorrecting] = useState(false),
    [correctionError, setCorrectionError] = useState<unknown>(),
    [resendAt, setResendAt] = useState<string | undefined>(
      (location.state as any)?.resendAt,
    );
  const delivery = useEmailDelivery(
    undefined,
    Boolean(user && !user.email_verified),
  );
  const resendWait = useCountdown(resendAt || delivery.data?.resendAt);
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.email_verified) return <Navigate to="/app" replace />;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/verify", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      await refresh();
      navigate("/app", { replace: true });
      toast("Email verified. Your company application is ready for review.");
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  async function resend() {
    setBusy(true);
    setError(null);
    try {
      const result = await api("/auth/resend-code", { method: "POST" });
      setDemoCode(result.verificationCode || "");
      setResendAt(result.resendAt);
      setCode("");
      await client.invalidateQueries({
        queryKey: ["/auth/verification-delivery"],
      });
      toast(
        "A new verification code has been requested. Use the latest email.",
      );
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthFrame subtitle="One small step. A world of possibilities.">
      <div className="auth-form-wrap">
        <div className="auth-feature-icon">
          <Mail size={30} />
        </div>
        <span className="eyebrow">VERIFY YOUR EMAIL</span>
        <h1>Check your inbox.</h1>
        <p className="auth-description">
          A six-digit verification code has been requested for{" "}
          <strong>{user.email}</strong>. Enter it below to continue.
        </p>
        <EmailDeliveryStatus />
        {(location.state as any)?.uploadErrors?.length > 0 && (
          <div className="form-error">
            Some documents could not be uploaded. Add them in your Documents
            workspace after verifying your email.
          </div>
        )}
        <form className="form-stack" onSubmit={submit}>
          <FormError error={error} />
          <Field
            label="Verification code"
            required
            hint="Your code expires in 10 minutes. Never share it with anyone."
          >
            <Input
              className="input otp-input"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, ""))
              }
              placeholder="000000"
              required
            />
          </Field>
          <Button type="submit" busy={busy}>
            Verify email <ArrowRight size={16} />
          </Button>
        </form>
        {demo && demoCode && (
          <div className="dev-code">
            <strong>Local development code</strong>
            <code>{demoCode}</code>
            <span>Visible only in isolated demo mode.</span>
          </div>
        )}
        <div className="auth-bottom-link">
          Didn’t receive a code?{" "}
          <button disabled={busy || resendWait > 0} onClick={resend}>
            {resendWait > 0 ? `Resend in ${resendWait}s` : "Resend code"}
          </button>
        </div>
        <div className="verification-actions">
          <button
            className="text-button"
            disabled={busy}
            onClick={() => {
              setCorrecting(true);
              setCorrectionError(null);
            }}
          >
            Correct email address
          </button>
          <Link to="/contact">Get help</Link>
        </div>
        <div className="verification-next">
          <ShieldCheck size={22} />
          <div>
            <strong>Next, a review by the VS team</strong>
            <p>
              After email verification, our team reviews your company profile
              and documents before activating transactions.
            </p>
          </div>
        </div>
        <Link to="/app/documents" className="text-link">
          Continue with company documents <ArrowRight size={14} />
        </Link>
        <button
          className="text-button auth-signout"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await signOut();
              navigate("/login");
            } catch (error) {
              setError(error);
            } finally {
              setBusy(false);
            }
          }}
        >
          Sign out
        </button>
        {correcting && (
          <Modal
            title="Correct your email"
            description="We’ll send a new verification code to the corrected address."
            onClose={() => !busy && setCorrecting(false)}
          >
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                setCorrectionError(null);
                try {
                  const body = Object.fromEntries(
                    new FormData(event.currentTarget),
                  );
                  const result = await api("/auth/correct-email", {
                    method: "POST",
                    body: JSON.stringify(body),
                  });
                  accept(result);
                  setDemoCode(result.verificationCode || "");
                  setResendAt(result.resendAt);
                  setCode("");
                  setCorrecting(false);
                  setError(null);
                  await client.invalidateQueries({
                    queryKey: ["/auth/verification-delivery"],
                  });
                  toast("Email updated. Enter the code from the latest email.");
                } catch (error) {
                  setCorrectionError(error);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className="modal-body form-stack">
                <FormError error={correctionError} />
                <Field label="Correct email address" required hint={emailHint}>
                  <Input
                    name="email"
                    type="email"
                    defaultValue={user.email}
                    required
                    autoComplete="email"
                  />
                </Field>
                <PasswordField
                  label="Your password"
                  name="current_password"
                  required
                />
              </div>
              <div className="modal-footer">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setCorrecting(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" busy={busy}>
                  Update and send code
                </Button>
              </div>
            </form>
          </Modal>
        )}
      </div>
    </AuthFrame>
  );
}
