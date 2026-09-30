# Local verification

Verified on **30 September 2026 (IST)** using Node.js 22.21, local Chrome, SQLite and an isolated PostgreSQL cluster. Tests used disposable databases and explicitly labelled QA files. The working database and uploads remain separate at `http://localhost:5173`.

| Check                                       | Result                                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| TypeScript, production build and formatting | Passed                                                                                                                   |
| SQLite automated suite                      | 109 / 109 passed                                                                                                         |
| PostgreSQL automated suite                  | 109 / 109 passed                                                                                                         |
| Browser acceptance                          | 18 / 18 passed; no retries or skipped tests                                                                              |
| Live VS AI acceptance                       | 32 / 32 passed across all six capabilities                                                                               |
| PDF and CSV acceptance                      | 7 / 7 passed                                                                                                             |
| Real-mode SMTP authentication               | 7 / 7 passed using an authenticated loopback receiver; 12 messages received                                              |
| Workspace navigation                        | All 34 routes loaded without browser runtime errors                                                                      |
| Accessibility                               | 61 / 61 views passed automated WCAG A/AA checks, including all 16 role dashboards                                        |
| Responsive layout                           | Phone and tablet browser scenarios passed; the 390px navigation audit found no horizontal overflow                       |
| Production Node runtime                     | Compiled assets, configuration guards, security headers, secure cookies, demo suppression and restart persistence passed |
| SQLite recovery                             | Application restarted from the generated backup and read the saved record with the persisted session                     |
| Dependency audit                            | Zero reported vulnerabilities                                                                                            |
| Configured secret scan                      | No configured secret values found in versionable files; local environment file permissions are `0600`                    |

The browser suite completes registration with document/email review, procurement through payment, recruitment through joining, team invitations and email sign-in verification, staffing timesheets, service milestones, technology demos, contract renewal, performance reviews and support conversations. AI scenarios check actual uploads and downloads, real server progress events, cancellation, retry, reduced motion, saved conversations, named actions, human review, editable drafts, comparison, discovery and operational evidence on desktop and mobile.

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

## Deployment verification still required

The real-mode authentication suite verifies registration, email OTP, sign-in verification, password recovery, token reuse rejection and session visibility through an authenticated **local SMTP receiver**. No external email was sent. Production SMTP sender configuration and delivery to intended external inboxes remain to be verified.

The compiled production Node runtime and local SQLite backup recovery passed. Hosting/TLS, private storage, off-site recovery, monitoring and production provider capacity need deployment-specific verification. Docker execution and signed Android/iOS SDK builds were not tested on this machine. Provider-specific ERP, bank settlement, statutory verification, qualified signatures and BGV integrations need their selected services; a recorded reference is not proof of an external transaction.

Automated accessibility covers the tested states and does not replace a manual assistive-technology audit. AI output remains reviewable, and provider rate limits still apply. No production deployment was performed.
