# Providers and business integrations

## Email and OTP

A Super Admin configures **Integrations → Email delivery**, or supplies environment variables. SMTP requires host, port, authorized sender and credentials; Resend requires a sending key and verified sender domain. Leave passwords/keys blank when updating other settings to preserve an existing encrypted secret.

1. Save the provider settings. Secrets are encrypted with AES-256-GCM; only presence flags are returned to the browser.
2. Verify the provider connection. Resend sending-only keys may not list domains; use the delivery test in that case.
3. Enter an approved test recipient and select **Send test email**.
4. Inspect delivery status and confirm receipt in that mailbox before onboarding partners.

`queued` means the message is waiting, `sending` means claimed by a worker, and `sent` means the provider accepted it. `delivered` is used only after a verified Resend delivery event. Acceptance does not prove inbox placement. Failed delivery, retries and expiry are visible. Message content is removed after successful provider acceptance. Security messages have short lifetimes and superseded codes cannot be used.

Registration/sign-in/signature codes expire after ten minutes with five attempts. Reset links expire after thirty minutes; invitations after seventy-two hours. Real mode never displays codes. Email-dependent operations fail clearly when no provider is configured. Business email preferences do not suppress necessary security mail.

Resend delivery events: configure `POST /api/integrations/email/webhook` and save its `whsec_...` signing secret. The handler verifies the raw Svix HMAC and five-minute timestamp window. Delivery events update the existing provider reference; they do not authenticate users or modify transactions.

## Gemini

Set `GEMINI_API_KEY` securely or save it in **Integrations → Google Gemini**. `GEMINI_MODEL` defaults to `gemini-3.5-flash-lite`; choose a model available to your Google project. The live connection test contacts Google. The key is never put in a `VITE_` variable or the frontend bundle.

Available at `/app/ai`:

- English answers against current authorized SQL queries, detailed record follow-ups and optional explicitly selected records.
- Requirement drafting into the standard form for human review.
- Commercial analysis of submitted quotations, restricted to authorized buyers.
- Matching against the verified directory.
- PDF, PNG and JPEG extraction with eight identity fields, code validation, human review, source digest and private history.
- Evidence-based explanations of operational alerts, including expiry, delivery delay, aging, procurement signals and response trends.

General context omits personal candidate, interview and staffing detail unless explicitly selected. Gemini receives the selected authorized context/document; apply your company's Google project/data-processing policy. Treat extracted text and confidence as review aids. The assistant cannot approve KYC, publish drafts, execute payments or make procurement decisions.

Conversations belong to their creator. Source and role access are checked before requests, again after the response, and when history is opened. Follow-up answers retain the source dependencies of earlier messages. Candidate retention removes linked extraction and conversation content. Requests have a 60-second overall deadline (90 seconds for extraction), limited transient retries, one concurrent request per user and configurable daily limits. Google project quota can impose further limits. Repeated unchanged analyses and document reads can reuse private results; ordinary status lookups can avoid a provider call. See [AI.md](AI.md) for limits, caching, progress events and verification.

`GEMINI_TEST_URL` is honored only in `NODE_ENV=test`. It is used by the isolated authorization suite. Production always contacts Google. Live verification calls real Google and uses explicitly labeled QA documents in a disposable database.

## ERP, accounting and automation

The integration contract consists of signed outbound events and a scoped read-only API. It is suitable for connecting an ERP/accounting adapter; no external ERP connection is silently created.

Organization administrators create endpoints and tokens in **Integrations → ERP & accounting connections**. Tokens are shown once, stored hashed, expire within 1–365 days and can be revoked. Every request checks the creator's current role and organization status. Token scopes can only narrow the creator's access.

```http
GET /api/integration/records/orders?page=1&limit=50
Authorization: Bearer <your securely stored token>
```

Available module names follow `/api/records/:kind`. Detail is `GET /api/integration/records/:kind/:id`. Only authorized records are returned; draft quotations/invoices are hidden from buyers. The API does not perform writes.

Webhook configuration accepts permitted record modules. Events include an ID, type (`module.action`), UTC creation time, recipient organization and record reference/status. Endpoints must use public HTTPS; an operator can explicitly allow private HTTPS hostnames with `WEBHOOK_ALLOWED_PRIVATE_HOSTS`. DNS results are checked and pinned for each delivery; redirects are not followed.

Verify the HMAC over the exact bytes:

```text
signed bytes = X-PartnerHub-Timestamp + "." + raw request body
expected = HMAC-SHA256(signing secret, signed bytes)
X-PartnerHub-Signature = "sha256=" + hex(expected)
```

Reject stale timestamps and de-duplicate `X-PartnerHub-Id`. Deliveries are at-least-once, use exponential retry and can be retried from the delivery log. Record/role access is checked when an event is enqueued and immediately before dispatch; revoked access cancels the delivery. Pause/disable an endpoint to stop dispatch.

Provider-specific ERP mapping, bank settlement, qualified digital signatures and government/BGV APIs require the target provider contract and credentials. These operations are not simulated.
