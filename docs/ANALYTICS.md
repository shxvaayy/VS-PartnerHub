# Analytics and BI

The Reports workspace reads authorized operational data from the shared database. All eight views use the same server calculations for KPI cards, charts, tables, CSV downloads and external BI queries. Empty datasets remain empty; missing evidence produces a blank rate or average.

## Report catalogue

| View                | Content                                                                                                 | Main sources                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Executive overview  | Organization counts, verification, business activity and commercial module counts                       | Organizations, records, documents                 |
| Partner analytics   | Nine organization types, registration trend, current verification stages and suspended accounts         | Organizations                                     |
| Procurement         | Procurement requirements, RFQs, invitations, response rate, quotations and approved PO value            | Records, record invitations                       |
| Partner performance | Partner responses, approved orders, confirmed deliveries, on-time evidence and published ratings        | Records, invitations, organizations, audit events |
| Recruitment         | Hiring requirements and positions, candidate stages, interviews, offers, BGV, joining and closed demand | Requirements, candidates, interviews              |
| Finance             | Invoice volume/value, completed/failed payments, current outstanding balances and aging                 | Invoices, payments                                |
| Compliance          | Latest document versions, reviews, required-document gaps, renewals and expiry windows                  | Documents, organizations, document policies       |
| Support             | Ticket volume, priority/category/team, waiting workload and recorded resolution time                    | Tickets, audit events                             |

Views and individual measures appear only when the user's current role allows their source modules. An external organization sees its permitted business relationships and its own organization/documents. An internal role sees only its permitted modules. Candidate names, compensation, resumes, private document contents, password hashes and integration secrets are excluded from report datasets.

## Measurement rules

- **Selected period:** records created between the inclusive UTC start and end dates. The default is the last 180 days, including today. Boundary months contain only the selected dates. Statuses describe those records now; these are not historical end-of-month snapshots.
- **Current snapshot:** organization states, latest document versions, required-document gaps, open support workload and invoice balances use current data across creation dates. The UI labels these measures separately. Every export carries its generation timestamp and measurement scope.
- **Currency:** monetary KPIs use the selected INR, USD, EUR or GBP. Values are integer minor units; divide by 100 for display in major units. There is no exchange-rate conversion. Volume datasets retain a currency column, so currencies can be grouped separately. Count metrics cover all visible currencies unless their definition states otherwise.
- **RFQ response rate:** invitation pairs with a non-draft quotation divided by visible invitations to non-draft RFQs created in the period. A revision does not add another response. Suppliers see their own invitations; buyers see their authorized RFQ invitations. No invitations means no rate.
- **Quotation average:** non-draft quotation totals in the selected currency, including tax, discount and delivery, divided by their record count. Revisions remain one quotation.
- **PO/invoice values:** approved or later POs, and approved/paid invoices, respectively. Draft and pending approval values are excluded from these committed-value KPIs.
- **Delivery performance:** confirmed deliveries with both a first audited delivered date and a promised PO date. On-time deliveries have a delivered date on or before the promise. Missing dates are excluded and the sample count remains visible. Ratings use published performance reviews.
- **Outstanding:** positive approved/paid invoice balances after completed payments of the same currency. Pending, processing and failed payments do not reduce the balance. Older invoices remain included. Aging uses due dates: not overdue, 1–30, 31–60, 61–90, over 90 days, or no due date.
- **Compliance:** only the latest version of an organization document; transaction attachments and superseded versions are excluded. Expiry windows are disjoint: expired, today through 30 days, 31–60, 61–90, beyond 90 days and no expiry. Required-document gaps use the same organization-specific policies as verification.
- **Recruitment:** hiring requirements are separate from procurement requirements. Position totals use the recorded number of positions; candidate stage counts are current statuses of submissions created in the period.
- **Support:** resolution duration uses the first audited resolved event after creation. Tickets without that evidence do not contribute to the average.

Select a KPI's information button to read its exact calculation. Charts link to permitted source modules or narrow the period. The dataset selector exposes the underlying values and definitions independently of a chart.

## API and dataset contract

| Method | Browser session route         | Purpose                                                |
| ------ | ----------------------------- | ------------------------------------------------------ |
| GET    | `/api/reports/analytics`      | All permitted report views and definitions             |
| GET    | `/api/reports/datasets/:view` | One CSV dataset                                        |
| GET    | `/api/reports/power-query`    | A Power Query function with the chosen report settings |

Filters are `from=YYYY-MM-DD`, `to=YYYY-MM-DD` and `currency=INR|USD|EUR|GBP`. The maximum period is ten years. View IDs are `executive`, `partners`, `procurement`, `performance`, `recruitment`, `finance`, `compliance` and `support`. Table IDs are `summary`, `metrics`, `trend`, `distribution`, plus `aging` for Finance and `verification` for Partners where authorized.

The JSON response has `version`, `generatedAt`, `from`, `to`, `currency` and `views`. Each view includes metrics with definitions/scopes, a trend, a distribution and typed tables. CSV files add `period_start`, `period_end`, `snapshot_at` and `measurement_scope`. The metrics table also carries the scope and currency of each metric. CSV cells are escaped against spreadsheet formula interpretation. Dataset exports and BI query downloads are audited.

Bearer clients use the separate read-only routes:

```http
GET /api/integration/reports/analytics?from=2026-09-01&to=2026-09-30&currency=INR
Authorization: Bearer <your stored integration token>

GET /api/integration/reports/datasets/finance?table=aging&currency=INR
Authorization: Bearer <your stored integration token>
```

Create a token under **Integrations → Business systems & reporting**. Select `reports` and only the necessary source scopes. For example, Finance requires `reports`, `invoices` and `payments`; Compliance uses `reports`, `documents` and `organizations` for policy coverage. Sources are intersected with the creator's current permissions on every request. Expired/revoked tokens and inactive owners are rejected. A reports-only token cannot obtain data. Unpermitted metrics/columns are omitted rather than returned as misleading zeroes.

## Power BI and Excel Power Query

1. In Reports, choose a view, reporting period, currency and export dataset. Select **Export & connect → Connect Power BI / Power Query**.
2. Create an appropriately scoped, expiring integration token. Keep its one-time value in the approved BI credential configuration.
3. Open a blank query's Advanced Editor in Power BI Desktop or Excel Power Query and paste the downloaded `.m` function. Invoke it with the token; optional date arguments can supply a rolling refresh window.
4. Configure the PartnerHub HTTPS source as Anonymous for this query; authentication is carried by the explicit bearer header. This does not make the API public. The function checks that the token can access the chosen view and table, applies the exported column types, and includes period/snapshot metadata.
5. Format minor currency values in major units as needed. Publish and schedule refresh using the organization's Power BI workspace and credential management. Rotate or revoke the source token under Integrations.

The downloaded function contains no token or password. Saving provider credentials in PartnerHub does not create an external Power BI tenant, publish a workbook or configure its refresh schedule. The local acceptance suite verifies the API data, authorization, downloaded query text and CSV/PDF artifacts; execution and publication inside a customer Power BI tenant require that tenant's access.

## Tableau, CSV and PDF

Use **Download CSV** for a Tableau Text File connection or an approved ingestion job that fetches the bearer CSV endpoint. Keep currency and snapshot/period fields when modelling data. Configure Tableau refresh and publication in the organization's environment; there is no preconfigured external Tableau account or embedded credential.

**Print / save PDF** produces the selected report with print-specific layout. The browser acceptance suite generates an actual PDF, reloads it and checks the report export. CSVs include all rows of the selected aggregate dataset, irrespective of the table's local search/pagination.

## Data dictionary and maintenance

Generated documentation is tracked in [dictionaries](dictionaries/):

- [Database dictionary](dictionaries/database-dictionary.csv): relational tables, columns, keys, types, logical entities and access notes.
- [Payload field dictionary](dictionaries/payload-field-dictionary.csv): validated module payload fields, labels, types and schema constraints, including hiring notice period, technology and delivery requirements.
- [KPI dictionary](dictionaries/kpi-dictionary.csv): per-view definitions, units, period/current scope and source tables.
- [Report datasets](dictionaries/report-datasets.csv): dataset columns, types and source tables.

Run `npm run docs:analytics` after changing schemas or KPI definitions. The generator migrates a fresh temporary SQLite database, reads schema metadata and produces definitions against an empty authorized context. It does not read operational rows, seed the workspace or expose configured credentials. The current schema documents 42 tables, 192 payload fields and 71 per-view KPI definitions across eight views.

Calculations live in `server/analytics.ts`, response types in `shared/analytics.ts`, and presentation in `src/pages/Reports.tsx`. Analytics queries aggregate in SQL rather than loading candidate profiles or document files into the browser. Both SQLite and PostgreSQL suites cover tenant/source restrictions, currency isolation, revisions, partial payments, expiry boundaries, missing evidence and token expiry/revocation.
