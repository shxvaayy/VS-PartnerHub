import {
  createContext,
  Children,
  cloneElement,
  isValidElement,
  useContext,
  useEffect,
  useRef,
  useId,
  useState,
  type ReactNode,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ChangeEvent,
} from "react";
import { emailError } from "../../shared/auth";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Inbox,
  LoaderCircle,
  Plus,
  Search,
  X,
} from "lucide-react";
import { ApiError } from "../lib/api";
import { initials } from "../lib/format";
import { label } from "../../shared/domain";
import { brandPaths } from "../../shared/brand";
import { normalizeWebAddress, webAddressError } from "../../shared/urls";
export function Logo({
  light = false,
  compact = false,
}: {
  light?: boolean;
  compact?: boolean;
}) {
  return (
    <span
      className={`brand ${light ? "brand-light" : ""}`}
      role={compact ? "img" : undefined}
      aria-label={compact ? "VS PartnerHub" : undefined}
    >
      <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
        <rect width="64" height="64" rx="18" fill="currentColor" />
        <rect
          x="1"
          y="1"
          width="62"
          height="62"
          rx="17"
          fill="none"
          stroke={light ? "#173e32" : "#d2efa1"}
          strokeOpacity=".22"
        />
        <path d={brandPaths.v} fill={light ? "#173e32" : "#d2efa1"} />
        <path d={brandPaths.s} fill={light ? "#2d5945" : "#f7faf3"} />
      </svg>
      {!compact && (
        <span>
          VS <b>PartnerHub</b>
          <small>BUSINESS, BETTER CONNECTED</small>
        </span>
      )}
    </span>
  );
}
export function Button({
  children,
  variant = "primary",
  busy,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      className={`button button-${variant} ${className}`}
      disabled={busy || props.disabled}
      aria-busy={busy || undefined}
    >
      {busy && <LoaderCircle size={16} className="spin" />}
      {children}
    </button>
  );
}
export function Badge({
  status,
  children,
}: {
  status: string;
  children?: ReactNode;
}) {
  const color = [
    "active",
    "approved",
    "completed",
    "verified",
    "paid",
    "joined",
    "confirmed",
    "fulfilled",
    "published",
    "clear",
    "sent",
  ].includes(status)
    ? "green"
    : [
          "pending",
          "under_review",
          "submitted",
          "registered",
          "uploaded",
          "pending_approval",
          "expiring",
          "processing",
          "requested",
          "clarification",
          "waiting_for_user",
          "offer",
        ].includes(status)
      ? "amber"
      : [
            "rejected",
            "suspended",
            "expired",
            "failed",
            "terminated",
            "urgent",
          ].includes(status)
        ? "red"
        : [
              "shortlisted",
              "interview",
              "selected",
              "bgv",
              "onboarding",
              "in_progress",
              "scheduled",
              "in_transit",
              "evaluation",
              "acknowledged",
              "review",
              "open",
            ].includes(status)
          ? "blue"
          : "neutral";
  return (
    <span className={`badge badge-${color}`}>
      <i />
      {children || label(status)}
    </span>
  );
}
export function Avatar({
  name,
  size = "md",
  color,
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  color?: string;
}) {
  const tones = ["lavender", "sage", "peach", "blue", "rose"];
  const tone = tones[(name.charCodeAt(0) || 0) % tones.length];
  return (
    <span
      className={`avatar avatar-${size} avatar-${tone}`}
      style={color ? { background: color } : {}}
    >
      {initials(name)}
    </span>
  );
}
export function PageHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}
export function Loading({
  label: text = "Loading your workspace…",
}: {
  label?: string;
}) {
  return (
    <div className="loading-state" role="status">
      <LoaderCircle size={24} className="spin" />
      <span>{text}</span>
    </div>
  );
}
export function ErrorState({
  error,
  retry,
}: {
  error: Error;
  retry?: () => void;
}) {
  return (
    <div className="error-state">
      <AlertCircle size={28} />
      <h3>We couldn’t load this page</h3>
      <p>{error.message}</p>
      {retry && (
        <Button variant="secondary" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  );
}
export function EmptyState({
  title = "A fresh start",
  description = "Your records will appear here.",
  children,
  icon,
}: {
  title?: string;
  description?: string;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon || <Inbox size={26} />}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="form-error" role="alert">
      <AlertCircle size={17} />
      <div>
        {error instanceof Error ? error.message : String(error)}
        {error instanceof ApiError && error.details?.length ? (
          <ul>
            {error.details.map((e, i) => (
              <li key={i}>
                {label(e.field.replaceAll(".", " "))}: {e.message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
export function Field({
  label: text,
  required,
  hint,
  children,
  className = "",
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  const generatedId = useId();
  let controlId = "";
  const hintId = `${generatedId}-hint`;
  // An explicit label keeps hints, select options and password-toggle buttons
  // out of the control's accessible name. Nested checkbox labels remain intact.
  const labelControl = (nodes: ReactNode): ReactNode =>
    Children.map(nodes, (child) => {
      if (!isValidElement<Record<string, any>>(child) || child.type === "label")
        return child;
      if (
        !controlId &&
        (child.type === Input ||
          ["input", "select", "textarea"].includes(child.type as string))
      ) {
        controlId = child.props.id || generatedId;
        return cloneElement(child, {
          id: controlId,
          "aria-describedby":
            [child.props["aria-describedby"], hint ? hintId : undefined]
              .filter(Boolean)
              .join(" ") || undefined,
        });
      }
      return child.props.children
        ? cloneElement(child, { children: labelControl(child.props.children) })
        : child;
    });
  const content = labelControl(children);
  return (
    <div
      className={`field ${className}`}
      role={controlId ? undefined : "group"}
      aria-labelledby={controlId ? undefined : generatedId}
    >
      <div className="field-heading">
        {controlId ? (
          <label className="field-label" htmlFor={controlId}>
            {text}
          </label>
        ) : (
          <span className="field-label" id={generatedId}>
            {text}
          </span>
        )}
        {required && (
          <span className="required" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </div>
      {content}
      {hint && <small id={hintId}>{hint}</small>}
    </div>
  );
}
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const { onChange, onInvalid, onBlur, ...rest } = props;
  const validate = (input: HTMLInputElement) => {
    if (props.type === "email")
      input.setCustomValidity(
        input.value.trim() || props.required ? emailError(input.value) : "",
      );
    if (props.type === "url")
      input.setCustomValidity(webAddressError(input.value));
  };
  return (
    <input
      className="input"
      {...(["email", "url"].includes(props.type || "")
        ? {
            autoCapitalize: "none",
            spellCheck: false,
            maxLength: props.type === "email" ? 254 : 2000,
          }
        : {})}
      {...rest}
      type={props.type === "url" ? "text" : props.type}
      inputMode={props.type === "url" ? "url" : props.inputMode}
      onChange={(event) => {
        validate(event.currentTarget);
        onChange?.(event);
      }}
      onInvalid={(event) => {
        validate(event.currentTarget);
        onInvalid?.(event);
      }}
      onBlur={(event) => {
        if (
          props.type === "url" &&
          !webAddressError(event.currentTarget.value)
        ) {
          const normalized = normalizeWebAddress(event.currentTarget.value);
          if (normalized !== event.currentTarget.value) {
            event.currentTarget.value = normalized;
            onChange?.(event as unknown as ChangeEvent<HTMLInputElement>);
          }
        }
        validate(event.currentTarget);
        onBlur?.(event);
      }}
    />
  );
}
export function SearchInput({
  value,
  onChange,
  placeholder = "Search records…",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="search-input">
      <Search size={17} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button aria-label="Clear search" onClick={() => onChange("")}>
          <X size={15} />
        </button>
      )}
    </div>
  );
}
export function Modal({
  title,
  description,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const active = document.activeElement as HTMLElement;
    const dialog = ref.current;
    const overflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = overflow;
      active?.focus?.();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "modal-wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) {
          const rect = ref.current.getBoundingClientRect();
          if (
            e.clientX < rect.left ||
            e.clientX > rect.right ||
            e.clientY < rect.top ||
            e.clientY > rect.bottom
          )
            onClose();
        }
      }}
      aria-label={title}
    >
      <div className="modal-heading">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Pagination({
  total,
  page,
  limit = 20,
  onChange,
}: {
  total: number;
  page: number;
  limit?: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="pagination">
      <span>
        {total
          ? `${(page - 1) * limit + 1}–${Math.min(page * limit, total)} of ${total}`
          : "0 records"}
      </span>
      <div>
        <button
          aria-label="Previous page"
          className="icon-button"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft size={17} />
        </button>
        <span>
          Page {page} of {pages}
        </span>
        <button
          aria-label="Next page"
          className="icon-button"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight size={17} />
        </button>
      </div>
    </div>
  );
}
export function BackLink({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) {
  return (
    <Link className="back-link" to={to}>
      <ArrowLeft size={16} />
      {children}
    </Link>
  );
}
export function CardHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="card-heading">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {children}
    </div>
  );
}
export function TextLink({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) {
  return (
    <Link className="text-link" to={to}>
      {children}
      <ArrowRight size={15} />
    </Link>
  );
}
export function Checklist({
  items,
}: {
  items: { text: string; done: boolean }[];
}) {
  return (
    <div className="checklist">
      {items.map((i) => (
        <div key={i.text} className={i.done ? "complete" : ""}>
          <span>{i.done ? <Check size={13} /> : <span />}</span>
          {i.text}
        </div>
      ))}
    </div>
  );
}
const ToastContext = createContext<
  (message: string, tone?: "success" | "error") => void
>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<
    { id: number; message: string; tone: string }[]
  >([]);
  const toast = (message: string, tone = "success") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5500);
  };
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-container" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.tone === "success" ? (
              <CheckCircle2 size={20} />
            ) : (
              <AlertCircle size={20} />
            )}
            <span>{t.message}</span>
            <button
              aria-label="Dismiss notification"
              onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);
