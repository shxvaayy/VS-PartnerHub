# Requirements and coverage

Source: **VS PartnerHub Enterprise Product Documentation v1.0**, supplied as `VS_PartnerHub_Enterprise_Product_Documentation (1).docx`, plus the expanded workspace/module requirements in the project request.

## Functional coverage

| Requirement                   | Implemented behavior                                                                                                                                               | Main implementation                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Nine organization types       | Vendor, supplier, buyer, recruitment, staffing, services, technology, business partner and other; type-specific onboarding and module visibility                   | `shared/domain.ts`, `src/pages/Onboarding.tsx`      |
| Contact role and registration | Authorized contact role, company/business fields, mandatory terms, document uploads, email verification and VS review                                              | `server/auth.ts`, `server/validation.ts`            |
| Verification team             | Document approval/rejection, company approval, clarification, suspension/reactivation and audit                                                                    | `server/organizations.ts`, `server/documents.ts`    |
| Vendor workspace              | Profile, capabilities, locations, catalog, company deck/rate-card documents, RFQ responses and commercial lifecycle                                                | Profile, catalog and record workspaces              |
| Supplier workspace            | SKU, specifications, MOQ, availability, lead time, prices, warranty, delivery locations and PO acknowledgment                                                      | Catalog, orders and deliveries                      |
| Buyer workspace               | Requirements, discovery, invitations, RFQs, comparison, approval, PO, contracts, invoices, payments and reports                                                    | `server/record-service.ts`, `server/workflows.ts`   |
| Procurement lifecycle         | Linked requirement → RFQ → quote → approval → PO → delivery → invoice → payment → performance                                                                      | Record parent relationships and guarded transitions |
| RFQ contents                  | Number, title, category, description, quantities/specifications, dates, address, invitations, terms, record attachments                                            | RFQ form and document tab                           |
| Quotation contents            | Price, quantity, discount, tax, delivery charge/date, payment terms, warranty, validity, remarks and attachments                                                   | Decimal calculations, quotation form and comparison |
| Purchase order                | Approved commercial source, parties, line items, taxes, total, delivery/payment terms, attachments and approval history                                            | PO form, workflow and history tab                   |
| High-value approval           | Configurable threshold and second authorized person for PO approval                                                                                                | Workflow checks and platform settings               |
| Contracts                     | Uploads, type, dates, terms, versions, review/approval, amendments/renewals and expiry reminders                                                                   | Contracts and maintenance                           |
| Invoices                      | Number, date, PO/contract reference, items, tax, total, due date and supporting files; draft/review/approval/paid                                                  | Invoice workspace                                   |
| Payment tracking              | References, transaction ID, date, amount, method, status and outstanding amount; partial payments                                                                  | Payment workspace and invoice reservations          |
| Recruitment                   | Domains/hiring types/locations/recruiter contacts; assigned requirements, candidate consent, screening, shortlist, interviews, offers, BGV, onboarding and joining | Recruitment forms, HR workflow and dashboard        |
| Staffing                      | Engagements, deployed resources, periods, rates, timesheets and approvals                                                                                          | Engagement and timesheet modules                    |
| Service providers             | Service catalog, capabilities, rates, RFQ proposals, contracts, milestones, invoicing and performance                                                              | Catalog, quotations and milestones                  |
| Technology partners           | Products, technologies, certifications, APIs/integration descriptions, documentation links and scheduled demo requests                                             | Technology catalog and demos                        |
| KYC/compliance                | PAN, GST, registration, MSME, banking, certificates, agreements, company decks and other files; review/version renewal/expiry                                      | Private document workspace                          |
| Internal roles                | Super Admin, Verification, Procurement, Finance, HR, Management, Support                                                                                           | Role defaults and editable permission matrix        |
| Team access                   | Scoped invitations, invitation acceptance, external/internal role constraints, active/suspended accounts                                                           | Team management                                     |
| Notifications                 | Registration, verification, decisions, commercial/candidate transitions, support and expiry; in-app plus SMTP outbox                                               | Transactional events and notification preferences   |
| Discovery                     | Company/capability text search and type, location, category, certification, verification filters; NAICS/SIC profile information searchable as text                 | Organizations API and discovery UI                  |
| Reports                       | Currency-aware KPIs, registration/activity charts, distribution, recruitment pipeline, status breakdowns, date filters, drill-down links and CSV export            | Dashboard/reports APIs                              |
| Audit                         | Actor, role, action, module, record, timestamp, previous/new status and remarks                                                                                    | `audit_logs` and history/audit screens              |
| Security                      | Server-side RBAC and tenant scope, hashed credentials/tokens, CSRF, rate limiting, optional email sign-in codes, private uploads, production configuration checks  | [Security details](../SECURITY.md)                  |

## Operating decisions

- A quotation covers an RFQ's requested items and quantities. A partner revises its existing quotation rather than creating duplicates. One quotation is awarded per RFQ; there is no split-award allocation.
- An order is created from an approved quotation. An invoice covers the complete fulfilled order or active contract. There is one invoice per source; installment invoicing, credit/debit notes, partial line-item fulfillment and accounting reconciliation are not modeled. Payments can be partial.
- Delivery is tracked through carrier/reference/status and buyer confirmation. Catalog availability is maintained by the partner; there is no warehouse stock ledger, stock reservation or shipping-provider feed.
- Services use quotations as commercial proposals. Rate cards, company decks, capability statements and full agreements are secure documents. Milestones track delivery, while billing follows the linked contract/order.
- BGV, statutory documents and bank transactions are reviewed/recorded by authorized users. They do not imply an automated check with a government registry, background-check provider or bank.
- Contract auto-renewal is captured as an agreed term. Applying a renewal creates a reviewable version; it does not silently approve legal terms or execute an e-signature.
- Search filters are backed by the application database. NAICS/SIC and technology keywords are searchable profile content, not an external classification registry. There is no search-engine cluster.
- Organization counts, activity and money charts come from persisted records. CSV exports are capped at 10,000 records; narrow filters for larger datasets. Dashboard insights are descriptive, with no AI scoring.

## Provider and rollout work

SMTP credentials enable real email delivery. SMS, enterprise SSO, bank settlement, accounting/ERP sync, statutory verification, e-signature, video meeting creation and BGV vendor APIs need selected providers and credentials. Technology API/integration fields describe a partner's offerings; they do not activate external integrations.

Infrastructure encryption, TLS termination, off-site backups, malware scanning, monitoring and retention governance belong to the production deployment. The supplied security/operations instructions describe how to configure them. Use a clean production database: demo mode is disabled by the production environment, but setting that flag cannot remove demo data previously copied into a database.

Candidate retention anonymizes closed/joined candidates and related interview data after the configured period. Active hiring records are retained. Audit retention is a minimum organizational policy, with administrator-managed archival; the application does not automatically delete audit logs. Backup retention needs a corresponding operational policy.

AI recommendations, public marketplace monetization, native mobile apps, advanced ERP integrations and automated risk scoring remain the roadmap items described in the source documentation.
