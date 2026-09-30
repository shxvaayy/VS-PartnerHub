# Local review and handover

## Open the real workspace

Run `npm run dev`, then open **http://localhost:5173**. The normal configuration uses `DEMO_MODE=false`, `data/workspace.sqlite` and `uploads/workspace/`. It starts with no invented organizations, user accounts, transactions or metrics. Existing data persists across restarts.

1. Open **http://localhost:5173/setup** and create your actual first administrator. Setup does not invent credentials. Once completed, the route is closed to further bootstrap attempts.
2. Open **Integrations → Email delivery**. Enter the authorized sender, SMTP host/port, username and provider app password/SMTP credential. Port 587 uses STARTTLS; port 465 uses implicit TLS. Save, verify the connection, and send a test to a mailbox you control.
3. Confirm that test arrived. The delivery log distinguishes provider acceptance from a confirmed delivery event; SMTP acceptance alone cannot establish inbox placement.
4. Gemini can be configured in the same screen or the server’s ignored `.env`. A configured key stays on the server. Use the assistant with actual workspace records after onboarding.
5. Invite your internal VS team through **People & access**, using the appropriate roles.

Keep passwords/API keys out of chat, screenshots and Git. They can be saved in the local integration form; stored provider secrets are encrypted and never returned by that API.

## Review registration and authentication

Select an organization type, then enter the contact role, account information, company identity and relevant business details. The company email field is recommended; the contact/login email is required and must be a complete address. The source does not prohibit Gmail. Upload the required documents and accept the terms.

The six-digit code is delivered through the configured provider. There is no code displayed in real mode. Incorrect, expired and used codes are rejected, and resending has a visible/server-enforced cooldown. A mistyped unverified email can be corrected with the account password, which invalidates earlier codes and sessions.

After verification, the VS team reviews the company documents and profile. Approval activates transactions. A pending organization can complete its onboarding and access support but cannot bypass approval.

Use **Settings → Password & security** to change the password, enable email sign-in verification and inspect/revoke sessions. Sign out in one browser tab to verify that the other tab also leaves the workspace. Forgot-password emails contain a one-time, 30-minute reset link; resetting signs out previous sessions.

## Review a complete procurement chain

Use real buyer and supplier/vendor organizations and their authorized accounts, preferably in separate browser profiles:

1. Buyer creates/opens a requirement and issues an RFQ with items, dates, delivery details and invited partners.
2. Invited partners review it and submit quotations. Revise or discuss clarification in the same record.
3. Buyer compares the submitted commercials and approves a selected response. Configured sequential approvals require separate reviewers; no award happens before the final step.
4. Create the PO from the approved quote, complete approval and send it. The vendor/supplier acknowledges.
5. Supplier records delivery; buyer confirms receipt. The source order becomes fulfilled.
6. Supplier creates/submits its invoice. Finance reviews/approves it and records actual payment references/amounts. Partial payments leave an outstanding balance; completed settlement records close it.
7. Inspect attachments, discussions, versions and audit history at each stage.

Payment tracking does not initiate bank settlement. The application validates references, totals and reserved balances without inventing bank activity.

## Review the specialized operations

| Area                  | Review path                                                                                                                                                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supplier catalog      | Create a SKU with MOQ/price/availability/lead time, attach documentation and reuse it in a quotation.                                                                                                                                                                                                         |
| Contracts             | Create/upload, approve, amend/renew and inspect history. Request signatures on an approved PDF, sign as each authorized party with an email code, download PDF/JSON evidence.                                                                                                                                 |
| Recruitment           | Assign a requirement, submit a consented candidate/resume, screen/shortlist, schedule/review interview, enter offer/BGV clearance, onboarding and joining data.                                                                                                                                               |
| Staffing/resources    | Add a resource pool and deployment engagement, submit a timesheet, have the authorized buyer/HR reviewer approve it.                                                                                                                                                                                          |
| Services              | Catalog/proposals, contract milestones, completion, invoicing and performance review.                                                                                                                                                                                                                         |
| Technology partners   | Solutions/capabilities, API/documentation information and scheduled demo requests.                                                                                                                                                                                                                            |
| Compliance            | Change a document policy, upload/review documents and renew a current version. Expiry reminders use configured windows.                                                                                                                                                                                       |
| Team/roles            | Invite scoped users, inspect permission differences, revoke an invitation or suspend a user and verify access ends.                                                                                                                                                                                           |
| Discovery/marketplace | Filter the verified directory; explicitly opt a company into public listing and verify that private contacts/KYC remain private.                                                                                                                                                                              |
| CSV                   | Download a blank template, preview row validation, correct errors and commit an atomic import.                                                                                                                                                                                                                |
| Approvals             | Define a module/currency/threshold and eligible reviewer roles, start a review and complete each distinct step.                                                                                                                                                                                               |
| AI                    | Use named actions and English replies, query current records, review a drafted requirement, compare submitted quotations, match partners, inspect operational alerts and upload/extract a permitted PDF/image through the animated human-review workflow. An empty workspace produces empty-context guidance. |
| Integrations          | Create scoped read-only API credentials and signed webhook endpoints for an actual target adapter. Test delivery with an authorized endpoint.                                                                                                                                                                 |
| Support               | Submit a ticket/conversation or public enquiry, review it from the support role and record resolution.                                                                                                                                                                                                        |
| Reports               | Select date/currency filters, follow KPI/chart drill-downs, inspect operational alerts and export scoped data. Forecasts require sufficient real history.                                                                                                                                                     |

## Mobile and keyboard review

At 390px/360px widths, open the public menu and the authenticated navigation drawer. Verify the active route, account information, workspace links, independent scrolling and fixed footer actions. Escape/backdrop closes the drawer and restores focus. The underlying page is not interactive while the drawer is open. The header remains stationary when the page scrolls.

The public workspace and lifecycle tabs support arrow/Home/End keys. Forms have explicit labels, password visibility controls and accessible error/status messages. Dialogs trap keyboard focus; search is available with Cmd/Ctrl+K.

See [MOBILE.md](MOBILE.md) for PWA installation and native prerequisites.

## Independent QA without mixing business data

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

`test:auth-smtp` uses the compiled frontend, a new empty database and an authenticated SMTP receiver on loopback. It performs signup, OTP verification, sign-in MFA and recovery through the browser without exposing codes in the application. It does not send to public mailboxes.

Browser workflow tests own disposable fixtures on ports **5183/4103**. The PostgreSQL helper starts its own temporary cluster; production smoke uses **4105** and temporary storage. Do not pass any business database to the test runner.

For a separate, clearly fictional manual QA walkthrough, run `node scripts/e2e-server.mjs` and open **http://127.0.0.1:5183**. This server seeds QA personas in a temporary database and displays a demo badge. It must not replace the real workspace on 5173. Stop it before `npm run test:e2e`, whose runner owns the same QA ports.

With that explicit QA server running, accessibility and screenshot audits can use:

```sh
PREVIEW_URL=http://127.0.0.1:5183 npm run audit:accessibility
PREVIEW_URL=http://127.0.0.1:5183 npm run preview:audit
```

Generated reports/screenshots are in the Git-ignored `artifacts/local-verification/`; failed browser traces are in `test-results/`. [VERIFICATION.md](VERIFICATION.md) records the observed checks and environment limits.

For real-provider AI acceptance, run `GEMINI_VERIFICATION_REPORT=artifacts/local-verification/ai/live-complete.json npm run verify:gemini`. It generates PDF/image fixtures, exercises all six tasks and saves actual outputs. After all checks, `npm run report:verification` creates the manager PDF/HTML report, CSV checklist and evidence ZIP. See [AI.md](AI.md) for the exact behavior and limits.
