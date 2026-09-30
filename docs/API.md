# API reference

Base path: `/api`. JSON requests use `Content-Type: application/json`; document upload uses multipart form data. The browser and API share an origin. Browser operations use session cookies and CSRF. Scoped, read-only ERP bearer tokens are restricted to `/api/integration`; see [INTEGRATIONS.md](INTEGRATIONS.md).

## Authentication and CSRF

`POST /auth/login` takes `{ "email": "...", "password": "..." }` and sets an HttpOnly session cookie. The response includes `{ user, csrfToken }`. Send the cookie on subsequent calls and `X-CSRF-Token: <csrfToken>` on authenticated mutations.

If the account enables email sign-in verification, login instead returns `{ requiresOtp: true, challengeId }` without creating a new session. Call `POST /auth/verify-login` with `{ challengeId, code }` to complete sign-in. `verificationCode` and local invitation links appear only in development demo mode.

| Method      | Path                      | Purpose                                                          |
| ----------- | ------------------------- | ---------------------------------------------------------------- |
| GET         | `/health`                 | Database-backed readiness                                        |
| GET         | `/auth/session`           | Current user, CSRF token and demo flag                           |
| POST        | `/auth/register`          | Create organization/contact; see registration payload below      |
| POST        | `/auth/login`             | Password sign-in, optional email challenge                       |
| POST        | `/auth/verify-login`      | Consume sign-in challenge                                        |
| POST        | `/auth/logout`            | Revoke current session                                           |
| POST        | `/auth/verify`            | Verify registration email with `{ code }`                        |
| POST        | `/auth/resend-code`       | Issue a new registration code, subject to resend interval        |
| POST        | `/auth/forgot-password`   | Queue recovery with `{ email }`; generic response                |
| POST        | `/auth/reset-password`    | Consume `{ token, password }` and revoke sessions                |
| POST        | `/auth/change-password`   | `{ current_password, password }`; returns replacement CSRF token |
| GET / PATCH | `/auth/preferences`       | Read preferences; update `{ email: boolean }`                    |
| POST        | `/auth/mfa`               | `{ enabled, current_password }` for email sign-in verification   |
| GET         | `/auth/invitation/:token` | Read a valid invitation's name/email/role                        |
| POST        | `/auth/accept-invitation` | `{ token, name, password }`; creates scoped user/session         |

Registration takes `name`, `email`, `password`, `accept_terms: true` and `organization` with `type`, `legal_name`, `trade_name`, `industry`, `city`, `country`, `website`, `contact_name`, `contact_email`, `contact_phone` and `details`. Business details are type-specific; [server/validation.ts](../server/validation.ts) is the authoritative schema. Upload verification files through `/documents`, then verify email and submit to VS review.

## Organizations and documents

| Method      | Path                          | Purpose                                                                                            |
| ----------- | ----------------------------- | -------------------------------------------------------------------------------------------------- |
| GET         | `/organizations`              | Scoped directory; `discovery=true` returns verified public profiles                                |
| GET / PATCH | `/organizations/:id`          | Authorized profile access/update                                                                   |
| POST        | `/organizations/:id/status`   | VS review decision `{ status, note }`                                                              |
| POST        | `/organizations/:id/resubmit` | Resubmit clarification/rejection after updates                                                     |
| GET         | `/documents`                  | Scoped documents; filter `organization_id`, `record_id`, status and query                          |
| POST        | `/documents`                  | Multipart `file`, `category`; optional `organization_id`, `record_id`, `expires_at`, `previous_id` |
| GET         | `/documents/:id/download`     | Authorized attachment download; audited                                                            |
| POST        | `/documents/:id/review`       | `{ status, note }` from permitted verification staff                                               |

Organization filters include `q`, `type`, `status`, `location`, `category`, `certification`, `page` and `limit`. Profiles include NAICS/SIC and technology/capability information in details, searchable by `q`. Non-privileged discovery responses remove private KYC/contact fields.

## Business records

Kinds: `requirements`, `rfqs`, `quotations`, `orders`, `deliveries`, `contracts`, `invoices`, `payments`, `catalog`, `candidates`, `interviews`, `engagements`, `timesheets`, `milestones`, `demos`, `performance`, `tickets`.

| Method      | Path                            | Purpose                                                    |
| ----------- | ------------------------------- | ---------------------------------------------------------- |
| GET / POST  | `/records/:kind`                | List or create records                                     |
| GET / PATCH | `/records/:kind/:id`            | Read or edit a record                                      |
| POST        | `/records/:kind/:id/transition` | `{ status, version, note }`                                |
| GET / POST  | `/records/:kind/:id/comments`   | Read conversation or add `{ body }`                        |
| GET         | `/records/:kind/:id/history`    | Audit events and version snapshots                         |
| GET         | `/records/:kind/export`         | Filtered CSV, maximum 10,000 records                       |
| GET         | `/records/rfqs/:id/compare`     | Buyer-authorized submitted quotation comparison            |
| POST        | `/records/contracts/:id/renew`  | `{ end_date, version, note }`; new version requires review |

Lists return `{ items, total, page, limit, can_create }`. Use `q`, `status`, `parent_id`, `category`, `from`, `to`, `currency`, `requirement_type`, `page` and `limit` as applicable. Currency and requirement-type filters also apply to CSV exports and report drill-downs. Detail responses include `allowed_transitions` and `can_edit`; calculate available actions from these values.

Record writes take:

```json
{
  "title": "Office monitor procurement",
  "currency": "INR",
  "parent_id": null,
  "buyer_org_id": null,
  "partner_org_id": null,
  "payload": {
    "deadline": "2027-01-15",
    "required_date": "2027-01-30",
    "delivery_address": "Buyer campus, Bengaluru",
    "category": "Information Technology"
  },
  "items": [
    {
      "name": "27 inch monitor",
      "specification": "IPS panel, enterprise warranty",
      "quantity": 2,
      "unit": "units",
      "unit_price": 0,
      "tax": 18,
      "discount": 0
    }
  ],
  "invitations": ["<verified-partner-uuid>"],
  "note": ""
}
```

This is an RFQ example; use current future dates and actual authorized UUIDs. Module payload schemas live in [server/record-service.ts](../server/record-service.ts); field labels are in [src/lib/form-definitions.ts](../src/lib/form-definitions.ts). Unknown payload keys are rejected. For an edit, supply the current `version` and editable fields. Server-managed values such as candidate consent/retention metadata are not editable.

Input monetary values are major currency units. Returned `amount_minor`/`outstanding_minor` use integer minor units (paise/cents). The server calculates totals and copies approved commercial values into dependent orders/invoices. Never treat browser totals as authoritative. Currency is inherited from commercial parents.

`GET /lookups?kind=orders` (or another kind) returns scoped eligible parents, partners and catalog choices. Preceding stages must be completed before a record appears as an eligible parent. A foreign UUID, mismatched organization, uninvited partner or invalid stage is rejected.

## Administration, reporting and notifications

| Method      | Path                            | Purpose                                                   |
| ----------- | ------------------------------- | --------------------------------------------------------- |
| GET         | `/dashboard`                    | Scoped KPIs, charts and activity; date/currency filters   |
| GET         | `/search?q=...`                 | Scoped global search                                      |
| GET         | `/reports/export`               | Management summary CSV                                    |
| GET         | `/reports/analytics`            | Eight report views, scoped KPI definitions and datasets   |
| GET         | `/reports/datasets/:view`       | Audited aggregate CSV; `table`, date and currency filters |
| GET         | `/reports/power-query`          | Power Query function with no embedded credentials         |
| GET         | `/notifications`                | Current user's notifications                              |
| POST        | `/notifications/:id/read`       | Mark user's notification read                             |
| POST        | `/notifications/read-all`       | Mark all user's notifications read                        |
| GET         | `/admin/team`                   | Authorized users and pending invitations                  |
| POST        | `/admin/team/invite`            | `{ name, email, role, organization_id? }`                 |
| PATCH       | `/admin/team/:id`               | Authorized name/role/active-state updates                 |
| DELETE      | `/admin/team/invitations/:id`   | Revoke pending invitation                                 |
| GET         | `/admin/roles`                  | Role permission definitions                               |
| PATCH       | `/admin/roles/:id`              | Change a permitted role's permission matrix               |
| GET / PATCH | `/admin/settings`               | Read settings / Super Admin updates                       |
| GET         | `/admin/audit`                  | Paginated, filtered audit history                         |
| GET         | `/admin/organizations-export`   | Authorized organization directory CSV                     |
| GET         | `/admin/email-status`           | Delivery metadata; no message bodies or secrets           |
| POST        | `/admin/email-status/:id/retry` | Queue a failed email again                                |

All routes enforce server-side role and tenant scope. Administrative settings/roles/users cannot grant an external organization internal VS privileges.

See [ANALYTICS.md](ANALYTICS.md) for report/table IDs, UTC period versus current-snapshot rules, integer minor units, BI setup and source permissions. Read-only bearer counterparts are `/integration/reports/analytics` and `/integration/reports/datasets/:view`; tokens require `reports` plus their source scopes.

## VS AI

AI routes require an active organization, current session and AI permission. Module permissions further restrict every selected record, document and task. Responses contain private conversation messages with readable `content`, authorized `sources` and task-specific `structured` evidence. `structured.actions` provides named navigation controls; raw routes are not rendered in prose.

| Method       | Path                         | Purpose                                                                                                |
| ------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| GET          | `/ai/status`                 | Connection availability and permitted task flags; no provider name or usage counter                    |
| POST         | `/ai/chat`                   | `{ message, conversationId?, recordIds?, documentId? }`; current scoped lookups and contextual answers |
| POST         | `/ai/draft-requirement`      | `{ brief }`; editable draft, missing information and suggestions, without saving a business record     |
| POST         | `/ai/analyze-quotations`     | `{ rfqId, question? }`; buyer-only comparison with server-calculated commercials                       |
| POST         | `/ai/discover`               | `{ brief, criteria? }`; authorized profile search and supported matches                                |
| POST         | `/ai/analyze-alerts`         | `{ question? }`; evidence-based operational explanation, without taking action                         |
| POST         | `/ai/extract-document`       | `{ documentId }`; authorized PDF/image extraction, identity fields and validation                      |
| GET          | `/ai/documents/:id`          | Authorized metadata for a selected document                                                            |
| GET          | `/ai/conversations`          | The creator's conversations                                                                            |
| GET / DELETE | `/ai/conversations/:id`      | Read with fresh source checks, or delete private history and saved analysis                            |
| GET          | `/ai/extractions`            | The creator's extraction history                                                                       |
| GET / DELETE | `/ai/extractions/:id`        | Read extraction/review evidence, or delete an unreviewed extraction                                    |
| GET          | `/documents/:id/extractions` | Verification team's extraction/review history                                                          |

Extraction returns JSON by default. With `Accept: text/event-stream`, the POST returns `progress` events carrying `stage` (`uploaded`, `reading`, `extracting`, `validating`, `ready`), followed by `result` or `error`. Reading events can also carry `pagesRead` and `totalPages`. These are measured processing stages; `ready` means ready for human review, not approved. The browser abort signal cancels outstanding work. File limits are 10 MB and 500 PDF pages. `result.preparation` records page counts, analysis coverage and whether the retained transcript is full, excerpted or an OCR reading. Source access and current document status are checked again when saved results are opened.

The verification endpoint accepts an optional `extraction` object with `extractionId`, all eight `fields` and `sourceConfirmed: true`, alongside the permitted `status` and `note`. Corrections are persisted separately from the original extraction and bound to its source SHA-256. A foreign extraction, changed source or unauthorized reviewer is rejected.

## Additional enterprise operations

| Surface                                                                    | Behavior                                                                              |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `/auth/correct-email`, `/auth/resend-login`                                | Password-confirmed correction of an unverified email and controlled login-code resend |
| `/auth/sessions`, `/auth/sessions/:id`, `/auth/sessions/revoke-others`     | List, revoke one or revoke other authenticated sessions                               |
| `/imports/:kind/template`, `/imports/:kind/preview`, `/imports/:id/commit` | Catalog/requirement/candidate templates, row validation, atomic idempotent commit     |
| `/approvals/queue`, `/approvals/records/:id`, `/approvals/policies`        | Scoped approval evidence and configurable sequential review policies                  |
| `/signatures/contracts/:id`, `/signatures/:id/otp`, `/signatures/:id/sign` | Contract consent envelopes, emailed code and authorized signing                       |
| `/signatures/:id/certificate`, `/signatures/:id/evidence`                  | PDF and JSON evidence bound to signed contract/document hashes                        |
| `/insights`, `/insights/performance`                                       | Scoped date/statistical signals and recorded partner performance                      |
| `/integrations/providers`, `/integrations/email`, `/integrations/gemini`   | Administrator-only encrypted provider settings and connection tests                   |
| `/public/partners`, `/public/contact`, `/public/setup`                     | Opt-in public profiles, persisted enquiry and restricted first-admin bootstrap        |

## Errors and concurrency

Errors have `{ "error": "Readable explanation", "details": [{ "field": "payload.deadline", "message": "..." }] }` where field details are available.

| Status    | Meaning                                                  |
| --------- | -------------------------------------------------------- |
| 400       | Malformed request                                        |
| 401       | Authentication required or credentials invalid           |
| 403       | Permission, verification or CSRF failure                 |
| 404       | Record missing or outside authorized visibility          |
| 409       | Stale version, duplicate reference or consumed operation |
| 413       | File/request too large                                   |
| 422       | Invalid fields or business workflow prerequisites        |
| 429       | Rate limit; wait before retrying                         |
| 500 / 503 | Unexpected server failure / unavailable database         |

After a 409, fetch the latest record and let the user review changes before retrying. Do not blindly replay financial mutations. The application uses business uniqueness and versions; it does not expose a generic idempotency-key header.
