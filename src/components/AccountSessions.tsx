import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Laptop, Smartphone, LogOut } from "lucide-react";
import { api, useApi } from "../lib/api";
import { relativeTime, formatDate } from "../lib/format";
import { Badge, Button, ErrorState, FormError, Loading, useToast } from "./ui";
import { PasswordField } from "./AuthControls";

type Session = {
  id: string;
  current: boolean;
  userAgent: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
};
function device(agent: string) {
  if (!agent) return "Earlier session · device details unavailable";
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /Firefox\//.test(agent)
      ? "Firefox"
      : /Chrome\//.test(agent)
        ? "Chrome"
        : /Safari\//.test(agent)
          ? "Safari"
          : "Browser";
  const platform = /iPad/.test(agent)
    ? "iPad"
    : /iPhone/.test(agent)
      ? "iPhone"
      : /Android/.test(agent)
        ? "Android"
        : /Windows/.test(agent)
          ? "Windows"
          : /Macintosh/.test(agent)
            ? "Mac"
            : /Linux/.test(agent)
              ? "Linux"
              : "device";
  return `${browser} on ${platform}`;
}
export default function AccountSessions() {
  const sessions = useApi<Session[]>("/auth/sessions"),
    client = useQueryClient(),
    toast = useToast();
  const [busy, setBusy] = useState(""),
    [error, setError] = useState<unknown>(),
    [expanded, setExpanded] = useState(false),
    [manageAll, setManageAll] = useState(false);
  const others = sessions.data?.filter((session) => !session.current) || [];
  const current = sessions.data?.filter((session) => session.current) || [];
  const visible = [
    ...current,
    ...others.slice(0, expanded ? others.length : 2),
  ];
  async function revoke(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api(`/auth/sessions/${id}`, { method: "DELETE" });
      await client.invalidateQueries({ queryKey: ["/auth/sessions"] });
      toast("That session has been signed out.");
    } catch (error) {
      setError(error);
    } finally {
      setBusy("");
    }
  }
  async function revokeOthers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy("all");
    setError(null);
    try {
      await api("/auth/sessions/revoke-others", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      await client.invalidateQueries({ queryKey: ["/auth/sessions"] });
      form.reset();
      toast("Your other sessions have been signed out.");
    } catch (error) {
      setError(error);
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="settings-content security-factor account-sessions">
      <h2>Your active sessions</h2>
      <p>Review where you’re signed in. Sessions expire after 12 hours.</p>
      <FormError error={error} />
      {sessions.isPending ? (
        <Loading />
      ) : sessions.error ? (
        <ErrorState error={sessions.error} retry={sessions.refetch} />
      ) : (
        <div className="session-list">
          {visible.map((session) => {
            const Icon = /Mobile|Android|iPhone|iPad/.test(session.userAgent)
              ? Smartphone
              : Laptop;
            return (
              <article className="session-item" key={session.id}>
                <span className="session-device">
                  <Icon size={21} />
                </span>
                <div>
                  <strong>{device(session.userAgent)}</strong>
                  <p>
                    {session.current
                      ? "Active now"
                      : `Last active ${relativeTime(session.lastSeenAt)}`}{" "}
                    · Started {formatDate(session.createdAt)}
                  </p>
                </div>
                {session.current ? (
                  <Badge status="active">This device</Badge>
                ) : (
                  <Button
                    variant="ghost"
                    aria-label={`Sign out ${device(session.userAgent)} session`}
                    disabled={Boolean(busy)}
                    busy={busy === session.id}
                    onClick={() => revoke(session.id)}
                  >
                    <LogOut size={16} />
                    Sign out
                  </Button>
                )}
              </article>
            );
          })}
        </div>
      )}
      {others.length > 2 && (
        <Button
          variant="ghost"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded
            ? "Show fewer sessions"
            : `Show ${others.length - 2} older sessions`}
        </Button>
      )}
      {others.length > 0 && (
        <div className="session-management">
          <p>
            {others.length} other active{" "}
            {others.length === 1 ? "session" : "sessions"}. Each represents a
            browser sign-in.
          </p>
          {!manageAll ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setManageAll(true)}
            >
              <LogOut size={16} />
              Sign out other sessions
            </Button>
          ) : (
            <form className="form-stack" onSubmit={revokeOthers}>
              <PasswordField
                label="Password to sign out other devices"
                name="current_password"
                required
              />
              <div className="button-row">
                <Button
                  type="submit"
                  variant="secondary"
                  busy={busy === "all"}
                  disabled={Boolean(busy)}
                >
                  <LogOut size={16} />
                  Sign out all other sessions
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setManageAll(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
