import { useEffect, useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff, Check } from "lucide-react";
import { Field, Input } from "./ui";
import { passwordHint } from "../../shared/auth";

export function useCountdown(target?: string) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!target) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [target]);
  return target ? Math.max(0, Math.ceil((Date.parse(target) - now) / 1000)) : 0;
}

export function PasswordField({
  label,
  newPassword = false,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  newPassword?: boolean;
}) {
  const [visible, setVisible] = useState(false),
    [capsLock, setCapsLock] = useState(false),
    [typed, setTyped] = useState(
      String(props.value ?? props.defaultValue ?? ""),
    );
  return (
    <Field
      label={label}
      required={props.required}
      hint={newPassword ? passwordHint : undefined}
    >
      <div className="password-input">
        <Input
          {...(newPassword
            ? {
                minLength: 12,
                maxLength: 128,
                autoComplete: "new-password",
                pattern: "(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{12,}",
              }
            : { maxLength: 128, autoComplete: "current-password" })}
          {...props}
          type={visible ? "text" : "password"}
          onChange={(event) => {
            setTyped(event.target.value);
            props.onChange?.(event);
          }}
          onKeyUp={(event) => {
            setCapsLock(event.getModifierState("CapsLock"));
            props.onKeyUp?.(event);
          }}
          onBlur={(event) => {
            setCapsLock(false);
            props.onBlur?.(event);
          }}
        />
        <button
          type="button"
          onClick={() => setVisible((value) => !value)}
          aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
          aria-pressed={visible}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {capsLock && (
        <small className="caps-lock-note" role="status">
          Caps Lock is on.
        </small>
      )}
      {newPassword && typed && (
        <span className="password-rules" aria-label="Password requirements">
          {[
            ["12 characters", typed.length >= 12],
            ["Uppercase", /[A-Z]/.test(typed)],
            ["Lowercase", /[a-z]/.test(typed)],
            ["Number", /\d/.test(typed)],
          ].map(([text, valid]) => (
            <span className={valid ? "met" : ""} key={String(text)}>
              <Check size={12} aria-hidden="true" />
              <span className="sr-only">{valid ? "Met: " : "Needed: "}</span>
              {text}
            </span>
          ))}
        </span>
      )}
    </Field>
  );
}
