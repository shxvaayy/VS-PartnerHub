# VS PartnerHub

Enterprise partner management, procurement and recruitment for **Vijay Software Solutions Pvt. Ltd.**, implemented from the supplied enterprise product documentation and accompanying requirements.

The application connects organization onboarding, private compliance records, procurement, hiring and partner operations. Its API enforces organization boundaries, roles, workflow prerequisites, commercial totals and approval history. VS AI combines authorized data retrieval and code-based calculations with Google Gemini for language assistance, requirement drafts, quotation analysis, partner matching, document extraction and operational explanations.

## Start a real local workspace

Use Node.js **22.21 or newer**.

```sh
npm ci
cp .env.example .env
npm run dev
```

Open **http://localhost:5173** and create your administrator at **[/setup](http://localhost:5173/setup)**. Replace `SESSION_SECRET` and set an independent `INTEGRATION_ENCRYPTION_KEY` in your ignored `.env`. Connect your authorized email sender and Gemini key in **Integrations**, then invite your VS team and register organizations.

Normal installations start with no invented partners, transactions, accounts or metrics. SQLite persists in `data/workspace.sqlite`; uploaded documents persist in `uploads/workspace/`. A PostgreSQL connection can be configured with `DATABASE_URL`. Migrations run automatically. Existing local data is never reset on startup.

Email OTP uses an actual SMTP or Resend connection. Without one, registration and email-dependent account actions explain that delivery is unavailable. Real mode never returns OTPs or invitation links in API responses. Gemini features require a valid Google key and project quota; provider errors are reported without substituting canned answers. Keys remain on the server.

## Included

- Nine organization types with dynamic onboarding, contact roles, company profiles, logos, authorized contacts, verification and relevant dashboards.
- Vendor/supplier/buyer sourcing: reusable catalogs, SKU/MOQ/availability, requirements, invitations, RFQs, revisions, comparison, sequential approvals, POs, acknowledgements and confirmed deliveries.
- Contracts with renewals/amendments, private PDFs, electronic signing with email OTP and immutable source/terms digests, PDF certificates and JSON evidence.
- Invoices, review/approval, partial payments, transaction references, outstanding balances and concurrency controls.
- Recruitment requirements, consented candidate submissions, interviews, offers, BGV status, onboarding/joining, staffing engagements, resource pools and timesheets.
- Service proposals, milestones and performance; technology solutions, API/integration descriptions, documentation and demo requests.
- Compliance policies by document and organization type, versioned uploads, review, expiry and configurable renewal reminders.
- Internal teams, role permissions, email/in-app notifications, support conversations, public enquiries, reports, filters, drill-downs and CSV exports/imports.
- English-language VS AI with authorized sources, private history, real PDF/image extraction, human review, six specialist tasks, reusable analyses and animated progress. Common status queries run directly against current data.
- Opt-in public partner directory, signed ERP webhooks, expiring scoped API tokens, operational alerts and evidence-based forecasts/performance.
- Responsive web app, installable PWA and branded Android/iOS Capacitor projects.

See the [requirement-by-requirement coverage](docs/REQUIREMENTS.md), [review guide](docs/LOCAL_REVIEW.md), [API](docs/API.md), [VS AI behavior](docs/AI.md), [security model](SECURITY.md), [mobile setup](docs/MOBILE.md) and [provider setup](docs/INTEGRATIONS.md).

## Verification

```sh
npm run check
npm test
npm run test:postgres
npm run test:e2e
npm run test:files
npm run test:production
npm run test:auth-smtp
npm run format:check
npm audit --audit-level=high
```

Tests use disposable databases and provider contract fixtures. The OTP suite sends real SMTP traffic to a loopback receiver; it does not send messages to external mailboxes. The live Gemini script calls Google with a securely configured key:

```sh
GEMINI_VERIFICATION_REPORT=artifacts/local-verification/ai/live-complete.json npm run verify:gemini
```

Live checks consume Google quota and pace the acceptance requests to respect project rate limits. Use `GEMINI_VERIFY_CHECKS=chat,draft-requirement,hiring-draft,analyze-quotations,discover,pdf-ocr,image-ocr,analyze-alerts` to select checks. [Verification evidence and limits](docs/VERIFICATION.md) distinguishes local provider tests, live Google calls and infrastructure checks.

Browser tests use installed Chrome locally and Playwright Chromium in CI. `npm run test:postgres` creates and removes its own PostgreSQL cluster; set `PG_BIN` if PostgreSQL binaries are outside the default Homebrew path. Never pass an existing business database as `TEST_DATABASE_URL`.

For an explicitly fictional review environment, use a **separate** database/upload directory with `DEMO_MODE=true`; production always disables fixture seeding and code exposure. Fixtures are kept for repeatable QA, never represented as real partner data.

Generate the manager handoff with `npm run report:verification` after completing the checks. It creates a PDF, HTML report, CSV checklist, screenshots, fixture files and evidence bundle under the ignored `artifacts/local-verification/handoff/`.

## Production

[Deployment instructions](docs/DEPLOYMENT.md) cover Docker/PostgreSQL, HTTPS, provider configuration and first-administrator setup. [Operations](docs/OPERATIONS.md) covers backup/recovery and retention. The runtime should use a dedicated account, persistent private storage and an authorized email sender.

Payment records track actual bank references entered by authorized users; financial settlement is an external integration. Statutory KYC and BGV decisions are staff-reviewed. Electronic signing evidence does not issue a statutory certificate-based digital signature. Native distribution requires the platform SDKs, signing identities and a deployed HTTPS origin. These external dependencies must be configured and verified for the intended rollout.

## Stack

React 19, TypeScript, Vite, React Query, Recharts and Lucide; Express 5, Knex, SQLite/PostgreSQL, Zod, Decimal.js, Nodemailer, Google Gemini and Capacitor. Fonts and product assets are served locally.

| Directory          | Responsibility                                              |
| ------------------ | ----------------------------------------------------------- |
| `src/`             | Public portal, workspaces, forms and analytics              |
| `server/`          | Authorization, persistence, providers and workflow services |
| `shared/`          | Organization types, roles and workflow vocabulary           |
| `tests/`, `e2e/`   | Disposable API/security and browser verification            |
| `android/`, `ios/` | Native application projects                                 |
| `docs/`            | Requirements, operation and handover                        |
