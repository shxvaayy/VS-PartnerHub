import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Clock, Mail } from "lucide-react";
import { api } from "../lib/api";
import { useCountdown } from "./AuthControls";

export function useEmailDelivery(challengeId?: string, enabled = true) {
  const path = challengeId
    ? `/auth/login-delivery/${challengeId}`
    : "/auth/verification-delivery";
  return useQuery({
    queryKey: [path],
    queryFn: () =>
      api<{ status: string; expiresAt?: string; resendAt?: string }>(path),
    enabled,
    refetchInterval: (query) =>
      ["queued", "sending", "unknown", "sent"].includes(
        query.state.data?.status || "",
      )
        ? 6000
        : false,
    retry: false,
  });
}
export default function EmailDeliveryStatus({
  challengeId,
}: {
  challengeId?: string;
}) {
  const result = useEmailDelivery(challengeId);
  const remaining = useCountdown(result.data?.expiresAt);
  if (result.isPending)
    return (
      <p className="email-delivery-note">
        <Clock size={15} />
        Checking delivery status…
      </p>
    );
  if (result.error)
    return (
      <p className="email-delivery-note">
        Delivery status is temporarily unavailable. You can still enter the code
        from your email.
      </p>
    );
  const status =
    result.data?.expiresAt && remaining === 0
      ? "expired"
      : result.data?.status || "unknown";
  const messages: Record<string, string> = {
    queued: "Your code is queued for email delivery.",
    sending: "Your email provider is processing the code.",
    sent: "Your email provider accepted the code. Check your inbox and spam folder.",
    delivered:
      "The recipient’s mail server confirmed delivery. Check your inbox and spam folder.",
    local:
      "Isolated demo mode: this verification message is not sent to an inbox.",
    failed:
      "The email provider could not deliver this code. Request another code or contact VS support.",
    blocked:
      "Email delivery is currently unavailable. Please contact VS support.",
    bounced:
      "This email address could not receive the code. Contact VS support for help.",
    complained:
      "Your email provider blocked this message. Contact VS support for help.",
    expired: "This code has expired. Request a new verification code.",
    verified: "Your email is verified.",
    unknown: "The code has been requested. Check your inbox shortly.",
  };
  const Icon = ["failed", "blocked", "bounced", "expired"].includes(status)
    ? AlertCircle
    : ["sent", "delivered", "verified"].includes(status)
      ? CheckCircle2
      : Mail;
  return (
    <p
      className={`email-delivery-note ${["failed", "blocked", "bounced", "expired"].includes(status) ? "issue" : ""}`}
      role="status"
    >
      <Icon size={16} />
      {messages[status] || "Check your inbox for the verification code."}
    </p>
  );
}
