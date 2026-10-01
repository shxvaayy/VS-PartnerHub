# Enterprise partner and procurement controls

These additions extend the shared organization, permissions, records and audit foundations. They do not create separate vendor, buyer or supplier applications.

## Review the requested modules

| Requested capability            | Workspace / entry point                                   | Behavior                                                                                                                              |
| ------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Vendor / Partner 360°           | Partner profile → **Partner 360°**                        | Authorized commercial activity, currency-separated balances, current compliance, published performance reviews and scoped drill-downs |
| KYC and document verification   | `/app/verification`, `/app/documents`                     | Existing document review, versioning, expiry, clarification and organization verification                                             |
| RFQ / RFP and quotations        | `/app/rfqs`, `/app/quotations`                            | RFQs plus structured RFP scope, criteria, weights and technical/commercial responses                                                  |
| Bid comparison                  | RFQ / RFP → **Compare quotations**                        | Factual terms and line-item comparison; RFP proposal content and current buyer assessment                                             |
| Procurement and POs             | `/app/requirements`, `/app/orders`, `/app/deliveries`     | Existing controlled lifecycle, with quantity-based goods and service acceptance                                                       |
| Invoices and three-way matching | Invoice → **Three-way match**                             | Independent PO-backed invoice lines compared against PO prices/quantities and buyer-accepted receipts                                 |
| Payments and reconciliation     | `/app/payments`, `/app/reconciliation`                    | Recorded payments, statement validation/import, split matching, exceptions, reversals and review history                              |
| Contracts                       | `/app/contracts`                                          | Existing agreement, approval, amendment, renewal, expiry and signature workflows                                                      |
| Recruitment partners            | `/app/candidates`, `/app/interviews`, hiring requirements | Existing recruitment and staffing lifecycle, offers, BGV and joining                                                                  |
| AI matching and analytics       | `/app/ai`, `/app/reports`, `/app/insights`                | Existing authorized discovery, requirement/quotation/document assistance and eight analytics views                                    |

## Receiving and three-way matching

Confirming a delivered shipment requires a receipt reference, actual acceptance date and accepted/rejected quantities for explicit PO lines. Approving a service milestone linked to a PO uses the same acceptance controls. Rejected quantities do not fulfill the order. Partial receipts keep the PO open; only full accepted quantities fulfill it. Receipt and PO updates run in one transaction with the PO locked to prevent concurrent over-receiving.

PO-backed invoice lines are entered independently. The UI starts from the PO for convenience; the supplier must verify the actual quantities, unit prices, tax, discount and delivery charges. The API requires each invoice line's `source_item_id` to belong to that PO and preserves the entered values. Equal grand totals cannot hide differing quantities or unit prices. Invoice approval requires an exact match; there is no supplier-controlled bypass or tolerance setting.

The existing one-final-invoice-per-order/contract constraint remains in place. Contract-only invoices use their contractual review workflow and are explicitly labelled outside PO three-way matching.

Historical approved/paid records retain their statuses. A fulfilled status alone is never receipt evidence. Authorized buyer order reviewers can record missing historical acceptance details, with an actual reference, date, quantities and reason. Legacy invoice lines without explicit PO mappings are reported as exceptions. A pending/rejected invoice can be corrected through the existing supplier draft/review flow.

## RFP evaluation

RFPs use the existing `rfqs` domain and workflow, with `solicitation_type: "RFP"` and an RFP number for new requests. Publication requires a scope of work and evaluation criteria. Technical weight is between 1 and 99; commercial weight is its complement to 100.

A response must include a technical proposal, implementation plan and compliance response before submission. Buyer reviewers enter technical/commercial scores and a rationale. Scores assist comparison; they never award a contract automatically. Changed proposal content invalidates the previous assessment. Ordinary status changes do not. The authorized buyer must assess the current proposal before award. Buyer-only assessments are also redacted from supplier-facing record history.

## Bank reconciliation

Access requires payment view permission and an internal or client/buyer account. Mutations additionally require payment review permission and an active, verified user. External suppliers cannot read buyer bank accounts, statement rows or reconciliation history.

1. Add the buyer organization, bank/account label, last four digits and currency. No banking password is collected.
2. Import a CSV with `date,transaction_id,reference,description,debit,credit,currency`. Use ISO dates and decimal amounts without thousands separators. Exactly one of debit/credit must be positive. Limits are 500 KB and 1,000 rows per import.
3. Preview validation errors and duplicates. Re-importing the same bank transaction cannot duplicate it. Conflicting details for an existing ID block the import. Imports are atomic.
4. Match open debits to completed payments from the same buyer and currency. Split a debit across payments or a payment across debits. Exact references are ranked before candidate limits; suggestions always require human confirmation.
5. Record a rationale. Database locks and version checks prevent stale updates, over-allocation and concurrent double matching.
6. Classify fees, refunds or internal transfers separately. Exceptions are never included in the reconciled-payment total. Reverse an incorrect match with a reason; the original allocation remains in history and both balances become available again.

This workspace reconciles statement evidence with recorded payments. It does not initiate bank transfers or subscribe to a bank feed. Live payment execution, automatic external bank feeds, company email and cloud BI publication still depend on the company's selected providers/accounts.

## Security and verification

- Partner 360 combines only records permitted by the viewer's current role and organization scope. Discovery cannot expose another client's purchases or private KYC. Document compliance is a current snapshot; commercial activity follows the selected creation-date range. Currency amounts are never combined.
- Existing read-only ERP/BI bearer-token routes remain isolated from session-only procurement and reconciliation routes.
- Migration `010_advanced_procurement` is additive and does not fabricate historical receipts or alter finalized invoices/payments.
- API coverage includes partial/rejected receipts, concurrent over-receiving, invoice mismatch approval blocks, service and historical evidence, RFP reassessment, cross-tenant/currency reconciliation, duplicate CSV imports, split allocations, reversals and source permissions.
- Browser coverage exercises RFP creation/evaluation, receipt confirmation, invoice corrections, statement import/matching/reversal/classification, mobile overflow checks and accessibility checks.

Run `npm run check`, `npm test`, `npm run test:postgres`, `npm run test:e2e`, and `npm run build`. New workflow screenshots are written to `artifacts/advanced-procurement/` using disposable test data.
