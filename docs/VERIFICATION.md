# Local verification

Verified on **29 September 2026** using Node.js 22.21, local Chrome, SQLite and an isolated PostgreSQL 18.3 cluster. Tests used disposable databases; the review workspace remains available separately at `http://localhost:5173`.

| Check                            | Result                                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| TypeScript client and server     | Passed                                                                                                                        |
| SQLite API integration suite     | 42 / 42 passed                                                                                                                |
| PostgreSQL API integration suite | 42 / 42 passed                                                                                                                |
| Browser acceptance suite         | 9 / 9 passed; no retries or skipped tests                                                                                     |
| Workspace navigation             | All 27 routes and all 16 demo personas loaded without browser errors                                                          |
| Accessibility                    | 38 public/workspace/detail/form views and all 16 role dashboards passed automated WCAG A/AA checks                            |
| Responsive layout                | 390px phone and 768px tablet checked; no horizontal page overflow                                                             |
| Production Node runtime          | Compiled assets, configuration guards, security headers, secure cookies, demo suppression and restart persistence passed      |
| SQLite recovery                  | Backup integrity passed; application restarted from the generated backup and read the saved record with the persisted session |
| Dependency audit                 | Zero reported vulnerabilities                                                                                                 |

The browser suite completes registration with document/email review, procurement through payment, recruitment through joining, team invitations and email sign-in verification, staffing timesheets, service milestones, technology demos, contract renewal, performance reviews and support conversations. It also checks keyboard focus, search, charts and responsive navigation.

API coverage includes organization isolation, role restrictions, document access, verification prerequisites, version conflicts, commercial calculations, approval rules, duplicate references, concurrent payment reservations, recovery tokens and recruitment prerequisites. See [the suite](../tests/platform.test.ts) and [browser scenarios](../e2e/platform.spec.ts).

To reproduce, follow [the local review guide](LOCAL_REVIEW.md). Generated JSON reports and screenshots live under the Git-ignored `artifacts/local-verification/`. Representative screenshots are committed in [images/](images/). The dashboard-only accessibility check is `node scripts/accessibility-audit.mjs --dashboards`; the full audit includes these role checks too.

Automated accessibility results cover the tested states and do not replace a complete manual assistive-technology audit. Docker templates were supplied, but the Docker runtime was not tested because no daemon was running. The compiled production Node runtime was tested locally. Hosting/TLS, real SMTP delivery, provider integrations and production infrastructure still require deployment-specific verification. No production deployment or external email delivery was performed.
