# Verification evidence

Verified on **30 September 2026 (IST)** using Node.js 22.21, local Chrome, SQLite and an isolated PostgreSQL cluster. Tests used disposable databases and explicitly labelled QA files. The working database and uploads remain separate at `http://localhost:5173`.

| Check                                       | Result                                                                                                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript, production build and formatting | Passed                                                                                                                                                     |
| SQLite automated suite                      | 151 / 151 passed                                                                                                                                           |
| PostgreSQL automated suite                  | 151 / 151 passed                                                                                                                                           |
| Browser acceptance                          | 32 / 32 passed; no retries or skipped tests                                                                                                                |
| Live VS AI acceptance                       | 32 / 32 passed across all six capabilities                                                                                                                 |
| PDF and CSV acceptance                      | 7 / 7 passed                                                                                                                                               |
| Real-mode SMTP authentication               | 7 / 7 passed using an authenticated loopback receiver; 12 messages received                                                                                |
| Workspace navigation                        | All 34 routes loaded without browser runtime errors                                                                                                        |
| Accessibility                               | 61 / 61 views passed automated WCAG A/AA checks, including all 16 role dashboards                                                                          |
| Responsive layout                           | Phone and tablet browser scenarios passed; the 390px navigation audit found no horizontal overflow                                                         |
| Production Node runtime                     | Compiled assets, configuration guards, security headers, secure cookies, demo suppression and restart persistence passed                                   |
| SQLite recovery                             | Application restarted from the generated backup and read the saved record with the persisted session                                                       |
| Encrypted recovery regression               | 19 / 19 passed: consistent WAL snapshot, document/logo bytes, key/file permissions, corruption, missing files, traversal, duplicates and overwrite refusal |
| Live PostgreSQL/private Blob recovery       | 7 / 7 passed: live read-only snapshot restored locally, 42 table counts matched, existing login/permissions and private download hash verified             |
| PostgreSQL fixture recovery                 | 24 / 24 passed with 64 private documents and module record/history APIs in isolated databases                                                              |
| Dependency audit                            | Zero reported vulnerabilities                                                                                                                              |
| Configured secret scan                      | No configured secret values found in versionable files; local environment file permissions are `0600`                                                      |

The browser suite completes registration with document/email review, procurement through payment, recruitment through joining, team invitations and email sign-in verification, staffing timesheets, service milestones, technology demos, contract renewal, performance reviews and support conversations. AI scenarios check actual uploads and downloads, real server progress events, cancellation, retry, reduced motion, saved conversations, named actions, human review, editable drafts, comparison, discovery and operational evidence on desktop and mobile.

The latest analytics audit verifies eight SQL-backed reports, KPI definitions, current verification stages, response denominators, invoice aging, document-policy coverage, currency isolation and scoped BI token expiry/revocation. The generated dictionary covers 42 tables, 192 payload fields and 71 per-view KPI definitions. Four reporting browser scenarios were rerun after improving PDF print layout; all passed. The generated PDF was opened and its text/figures checked, including complete dataset rows and calculation notes. See [ANALYTICS.md](ANALYTICS.md).

The homepage tour now has eleven browser checks covering all nine workspaces, forward/reverse progression, direct/keyboard tabs, native touch gestures, five portrait phone sizes (including 320 × 568 and 375 × 550), rotation, selected-tab visibility, final release and reduced motion. Desktop heading and card stay pinned as one group, then release together after the final workspace. Four laptop viewports verify that the heading, card and footer fit together. Section padding is 48px on desktop and 36px on phones; shorter laptops use compact content without adding a blank card height.

The heading/spacing regression passed 11 Chromium checks and 10 WebKit checks in separate local runs. The Chromium run includes native touch input; the WebKit run covers the other layout, navigation, rotation and accessibility scenarios. Reports and screenshots are under `artifacts/workspace-heading-fix/`. The earlier complete application suite above retains its original evidence rather than being counted as rerun by this targeted check.

Native verification now also runs on hosted Android/macOS toolchains. The [first complete run](https://github.com/shxvaayy/VS-PartnerHub/actions/runs/36675834773) passed Android debug APK/release AAB compilation and lint, packaged identity/HTTPS/offline inspections, and iPhone simulator compilation/install/launch. The iOS launch screenshot was visually reviewed and shows the live sign-in screen. Fourteen local checks verify copied reconnect links, acceptable/rejected server origins and returning from the bundled page to live login. Native signing/distribution and authenticated hardware/file workflows are not certified by these build/launch checks. See [MOBILE.md](MOBILE.md).

Browser acceptance uses the Playwright-managed Chromium version both locally and in CI (`npx playwright install chromium`). Set `PLAYWRIGHT_CHANNEL=chrome` to check installed Chrome separately. Touch checks send native touch-start/move/end input after the sticky layout has painted and assert both actual page movement and the selected workspace. This avoids the Linux runner's non-scrolling synthetic gesture while retaining the mobile interaction check.

Workspace branding links to the public homepage, whose signed-in header shows a visible **My workspace** action on desktop and mobile. The dashboard welcome illustration uses normal-flow rows below its copy on phone/tablet layouts. A separate local review passed 34 checks across administrator and HR dashboards at 320, 360, 390, 600, 768, 834, 1024 and 1440px, including label/text separation, unclipped labels, header layout, round-trip navigation, unchanged sessions and mobile accessibility.

The latest specification audit added required company-type/contact-role checks for all nine registration types, shared international phone validation for organization and candidate/contact records, and protection against clearing a primary contact's phone. Invalid submissions leave no account or organization behind. The browser verifies the phone error before continuing onboarding.

The recovery audit fixed a CLI ordering bug: the old backup command ran migrations and internal-account initialization before taking a snapshot. Backup now opens the existing SQLite source read-only and never imports application initialization. The coordinated recovery command captures a shared PostgreSQL snapshot and all referenced private document/logo files, records hashes and encrypts the archive. Restore authenticates before extraction and refuses existing targets. Regression evidence is in `artifacts/recovery-verification/regression.json`.

The actual production snapshot was restored into a new local PostgreSQL cluster with delivery/maintenance disabled; all 42 table counts matched and its existing account and one private document passed API checks. The source snapshot had no transactions or logos, so those are not claimed as live-record recovery tests. The independent synthetic PostgreSQL drill checks populated module records/history and 64 documents. See `live-snapshot.json`, `live-restore.json` and `fixture-restore.json` in `artifacts/recovery-verification/`, and [OPERATIONS.md](OPERATIONS.md) to reproduce. Original source data and the encrypted backup were not modified; temporary restore databases and plaintext files were removed. Off-site scheduling, destination/retention and recovery ownership are separate outstanding operational work.

The audit also found a native Node 22 zlib crash when cancelling PDF workers. Cancellable PDF workers now use PDF.js's JavaScript compression fallbacks, finish parser cleanup before sending results, and retain their concurrency slot until termination completes. Repeated cancellations at different page stages and mixed queued/cancelled reads pass; both complete database suites were rerun successfully after the fix. Production assets are checked for accidental inclusion of local demonstration credentials.

API coverage includes organization isolation, role restrictions, document access, verification prerequisites, version conflicts, commercial calculations, approval rules, duplicate references, concurrent payment reservations, recovery tokens and recruitment prerequisites. AI coverage adds changed permissions, source validation, malformed provider output, cancellation, cache invalidation, human corrections and prevention of unauthorized business mutations. See [the suite](../tests/platform.test.ts) and [browser scenarios](../e2e/platform.spec.ts).

## AI acceptance

| Capability              | Live checks | Evidence exercised                                                                                                                                                              |
| ----------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Assistant            | 9 / 9       | Authorized RFQ and invoice retrieval, current line items, natural follow-ups, varied prompts, topic changes and English replies to Hindi/Hinglish input                         |
| B. Document AI          | 10 / 10     | All eight identity fields; readable PDF, PNG, scanned and mixed PDF; 61-page PDF with identifiers on the last page; later-page questions; absent values; reuse and human review |
| C. Requirement drafting | 4 / 4       | Procurement and hiring briefs, quantity and work arrangement, missing information, reuse and explicit authorized draft creation                                                 |
| D. Quotation analysis   | 3 / 3       | Recorded commercial totals and terms, reuse, buyer-only comparison and no automatic award                                                                                       |
| E. Partner discovery    | 3 / 3       | All nine specified business filters, reuse, changed-profile invalidation and exclusion of private KYC                                                                           |
| F. Operational alerts   | 3 / 3       | All seven categories, recorded evidence, reuse and no business mutations                                                                                                        |

The API and browser suites use controlled provider responses to reproduce success and failure conditions. The **separate live suite calls the configured Google service** for language responses and OCR, and also checks reuse and human decision ownership. These results are not interchangeable. The handoff includes actual live prompts, returned narratives and full structured results.

After adding maximum notice period to hiring requirements, four requirement-drafting checks were rerun with the real provider and all passed. They verify procurement fields, explicit human save, private result reuse and an English hiring draft with a 15-day notice limit distinct from the joining date. The report is `artifacts/analytics-verification/live-requirement-refresh.json`; the full earlier provider run keeps its original timestamp.

After the parser cancellation fix, the ten Document AI checks were rerun against the real provider and all passed. Their separate evidence is `artifacts/local-verification/ai/document-parser-refresh.json`; the earlier all-capability run remains in `ai/live-complete.json` with its original timestamp.

The common pending-RFQ lookup completed in 50 ms without a provider call. Reuse cases completed in 8–18 ms; live provider tasks took approximately 2.9–16.3 seconds in the recorded run. These are observed local timings, not a production latency guarantee. The acceptance runner deliberately spaces requests to respect provider rate limits; that pacing is excluded from task timings.

The previous 40-page extraction restriction is removed. PDFs up to 500 pages and 10 MB are accepted; the parser reads every page with bounded memory, time and text retention. Long analyses use labelled excerpts, disclose coverage, and keep retained text available for authorized questions. Mixed PDFs isolate scanned pages for OCR. Extraction and validation never replace VS verification approval. See [AI.md](AI.md) for limits and workflow details.

## Review and reproduce

Follow [the local review guide](LOCAL_REVIEW.md). Generated JSON reports, QA fixtures, exports and screenshots live under the Git-ignored `artifacts/local-verification/`. `npm run report:verification` reads the completed reports and generates:

- `handoff/VS-PartnerHub-Verification-Report.pdf`
- `handoff/verification-checklist.csv`
- `handoff/live-ai-responses.html`
- The evidence, fixtures, exports and screenshots, with SHA-256 hashes in `handoff/manifest.json`
- `VS-PartnerHub-Verification.zip`

Missing or failed evidence produces a nonzero exit and a report marked for review. The report command does not run the tests itself. The full accessibility command includes all 16 role dashboards; `node scripts/accessibility-audit.mjs --dashboards` runs just those dashboards.

## Live deployment and remaining external checks

The real-mode authentication suite verifies registration, email OTP, sign-in verification, password recovery, token reuse rejection and session visibility through an authenticated **local SMTP receiver**. No external email was sent. Production SMTP sender configuration and delivery to intended external inboxes remain to be verified.

The compiled production Node runtime and local SQLite backup recovery passed. The Vercel API, direct SPA routes, real administrator login, persistent PostgreSQL sessions and private Blob storage have since been deployed. The database connection uses certificate-verified TLS 1.3. The separate cloud suite passed 14 checks with real uploads above 4.5 MB, private access, tampering/replay rejection and restart persistence; its disposable cloud files were removed. Off-site recovery, monitoring and production provider capacity still need their operational checks. Docker execution and signed Android/iOS SDK builds were not tested on this machine. Provider-specific ERP, bank settlement, statutory verification, qualified signatures and BGV integrations need their selected services; a recorded reference is not proof of an external transaction.

Automated accessibility covers the tested states and does not replace a manual assistive-technology audit. AI output remains reviewable, and provider rate limits still apply. The live URL is https://vs-partnerhub.vercel.app. Live deployment evidence is kept separately under `artifacts/live-verification/`; the earlier local AI and SMTP results are not claims of external email delivery. See [DEPLOYMENT.md](DEPLOYMENT.md) for the deployed architecture.

The positive quotation-analysis check has also passed on the actual Vercel URL: three submitted QA quotations were analyzed by the configured provider, each total/tax/discount/delivery value matched independently calculated expectations, and missing warranty/expired validity were reported. Source states stayed unchanged, anonymous access was denied, and desktop/mobile results passed automated accessibility checks. All temporary, unapproved QA organizations, source records and private conversations were removed; normal audit evidence remains. The six-check report and screenshots are in `artifacts/live-quotation-verification/`. Its deployment commit is recorded separately from subsequent fixes.
