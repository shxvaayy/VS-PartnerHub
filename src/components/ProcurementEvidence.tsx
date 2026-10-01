import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  CheckCheck,
  ClipboardCheck,
  FileCheck2,
  GitCompareArrows,
  Landmark,
  ShieldCheck,
} from "lucide-react";
import { api, useApi } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dateInput, formatDate, formatTime, money } from "../lib/format";
import type { LineItem, WorkRecord } from "../../shared/domain";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  Input,
  Loading,
  Modal,
  useToast,
} from "./ui";
import ScrollRegion from "./ScrollRegion";

export type ReceiptDraft = {
  reference: string;
  received_date: string;
  lines: {
    order_item_id: string;
    accepted_quantity: number;
    rejected_quantity: number;
  }[];
};
export function ReceiptFields({
  record,
  value,
  onChange,
}: {
  record: WorkRecord;
  value?: ReceiptDraft;
  onChange: (value: ReceiptDraft) => void;
}) {
  const query = useApi<any>(`/records/${record.kind}/${record.id}/receiving`);
  useEffect(() => {
    if (query.data?.lines && !value)
      onChange({
        reference: "",
        received_date: dateInput(0),
        lines: query.data.lines.map((line: LineItem) => ({
          order_item_id: line.id!,
          accepted_quantity: 0,
          rejected_quantity: 0,
        })),
      });
  }, [query.data, value, onChange]);
  if (query.isPending || !value)
    return query.error ? <FormError error={query.error} /> : <Loading />;
  if (query.error) return <FormError error={query.error} />;
  return (
    <section className="proc-receipt-form">
      <div className="proc-panel-heading">
        <span className="proc-icon">
          <ClipboardCheck size={21} />
        </span>
        <div>
          <h3>Confirm what was accepted</h3>
          <p>
            {query.data.order.number} · Quantities below become the buyer's
            receipt evidence.
          </p>
        </div>
      </div>
      <div className="form-grid">
        <Field label="Receipt / acceptance reference" required>
          <Input
            required
            minLength={3}
            maxLength={200}
            value={value.reference}
            placeholder="Goods receipt or service acceptance reference"
            onChange={(e) => onChange({ ...value, reference: e.target.value })}
          />
        </Field>
        <Field label="Received / accepted on" required>
          <Input
            type="date"
            required
            max={dateInput(0)}
            value={value.received_date}
            onChange={(e) =>
              onChange({ ...value, received_date: e.target.value })
            }
          />
        </Field>
      </div>
      <div className="proc-table-actions">
        <p>
          Only accepted quantities count towards fulfillment and invoice
          matching.
        </p>
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            onChange({
              ...value,
              lines: query.data.lines.map((line: any) => ({
                order_item_id: line.id,
                accepted_quantity: line.remaining_quantity,
                rejected_quantity: 0,
              })),
            })
          }
        >
          <CheckCheck size={15} /> Accept remaining quantities
        </Button>
      </div>
      <ScrollRegion className="table-scroll" label="Record received quantities">
        <table className="data-table proc-receipt-table">
          <thead>
            <tr>
              <th>PO item</th>
              <th>Ordered</th>
              <th>Previously accepted</th>
              <th>Accept now</th>
              <th>Reject now</th>
            </tr>
          </thead>
          <tbody>
            {query.data.lines.map((line: any, index: number) => (
              <tr key={line.id}>
                <td>
                  <strong>{line.name}</strong>
                  <small className="proc-subtext">{line.unit}</small>
                </td>
                <td>{line.quantity}</td>
                <td>{line.accepted_quantity}</td>
                {(["accepted_quantity", "rejected_quantity"] as const).map(
                  (key) => (
                    <td key={key}>
                      <Input
                        type="number"
                        min={0}
                        max={
                          key === "accepted_quantity"
                            ? line.remaining_quantity
                            : 1000000
                        }
                        step="0.001"
                        required
                        aria-label={`${key === "accepted_quantity" ? "Accept" : "Reject"} ${line.name}`}
                        value={value.lines[index]?.[key] ?? 0}
                        onChange={(e) =>
                          onChange({
                            ...value,
                            lines: value.lines.map((item, n) =>
                              n === index
                                ? { ...item, [key]: Number(e.target.value) }
                                : item,
                            ),
                          })
                        }
                      />
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
    </section>
  );
}

export function ReceivingPanel({ record }: { record: WorkRecord }) {
  const query = useApi<any>(`/records/${record.kind}/${record.id}/receiving`);
  const [recording, setRecording] = useState(false),
    [draft, setDraft] = useState<ReceiptDraft>(),
    [type, setType] = useState("goods"),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const client = useQueryClient(),
    toast = useToast();
  if (query.isPending) return <Loading />;
  if (query.error)
    return <ErrorState error={query.error} retry={() => query.refetch()} />;
  const data = query.data;
  if (!data.applicable)
    return (
      <EmptyState
        title="Contract service milestone"
        description="Review acceptance against the contract and its supporting documents."
      />
    );
  return (
    <section className="proc-evidence">
      <div className="proc-panel-heading">
        <span className="proc-icon">
          <ClipboardCheck size={23} />
        </span>
        <div>
          <h3>Goods & service acceptance</h3>
          <p>
            {data.order.number} ·{" "}
            {
              data.lines.filter((line: any) => line.remaining_quantity === 0)
                .length
            }{" "}
            of {data.lines.length} order lines fully accepted
          </p>
        </div>
        <Badge status={data.complete ? "approved" : "pending"}>
          {data.complete ? "Fully received" : "Awaiting acceptance"}
        </Badge>
      </div>
      <ScrollRegion
        className="table-scroll"
        label="Purchase order receipt quantities"
      >
        <table className="data-table">
          <thead>
            <tr>
              <th>PO item</th>
              <th>Ordered</th>
              <th>Accepted</th>
              <th>Rejected</th>
              <th>Remaining</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((line: any) => (
              <tr key={line.id}>
                <td>
                  <strong>{line.name}</strong>
                  <small className="proc-subtext">{line.unit}</small>
                </td>
                <td>{line.quantity}</td>
                <td className="proc-positive">{line.accepted_quantity}</td>
                <td>{line.rejected_quantity}</td>
                <td>
                  <Badge
                    status={
                      line.remaining_quantity === 0 ? "approved" : "pending"
                    }
                  >
                    {line.remaining_quantity}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
      <ReceiptHistory receipts={data.receipts} />
      {data.can_record_evidence && (
        <div className="proc-table-actions">
          <p>
            This fulfilled order has incomplete receipt evidence. An authorized
            buyer can record the actual acceptance details.
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              setRecording(true);
              setDraft(undefined);
              setNote("");
              setError(null);
            }}
          >
            Record receipt evidence
          </Button>
        </div>
      )}
      {recording && (
        <Modal
          title="Record acceptance evidence"
          description="Enter actual quantities, the acceptance date and a supporting reference for this fulfilled order."
          onClose={() => setRecording(false)}
          wide
        >
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError(null);
              try {
                await api(`/records/orders/${record.id}/receiving`, {
                  method: "POST",
                  body: JSON.stringify({
                    version: record.version,
                    receipt: draft,
                    type,
                    note,
                  }),
                });
                await client.invalidateQueries();
                toast("Acceptance evidence recorded.");
                setRecording(false);
              } catch (error) {
                setError(error);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="modal-body form-stack">
              <FormError error={error} />
              <Field label="Acceptance type">
                <select
                  className="input"
                  value={type}
                  onChange={(event) => setType(event.target.value)}
                >
                  <option value="goods">Goods receipt</option>
                  <option value="service">Service acceptance</option>
                </select>
              </Field>
              <ReceiptFields
                record={record}
                value={draft}
                onChange={setDraft}
              />
              <Field label="Evidence and reason for recording it now" required>
                <textarea
                  className="input"
                  required
                  minLength={10}
                  maxLength={2000}
                  rows={3}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </Field>
            </div>
            <div className="modal-footer">
              <Button
                variant="secondary"
                type="button"
                onClick={() => setRecording(false)}
              >
                Cancel
              </Button>
              <Button type="submit" busy={busy} disabled={!draft}>
                Record acceptance
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
function ReceiptHistory({ receipts }: { receipts: any[] }) {
  return (
    <div className="proc-receipt-history">
      <h4>Acceptance evidence</h4>
      {receipts.length ? (
        receipts.map((receipt) => (
          <div className="proc-evidence-row" key={receipt.id}>
            <FileCheck2 size={19} />
            <div>
              <strong>
                {receipt.number} · {receipt.reference}
              </strong>
              <span>
                {receipt.source_number || "Historical PO receipt"} ·{" "}
                {formatDate(receipt.received_date)} · Accepted by{" "}
                {receipt.accepted_by_name}
              </span>
              {receipt.note && <p>{receipt.note}</p>}
            </div>
            <Badge status="confirmed">
              {receipt.type === "service" ? "Service" : "Goods"}
            </Badge>
          </div>
        ))
      ) : (
        <p className="subtle">
          No buyer-confirmed receipts have been recorded.
        </p>
      )}
    </div>
  );
}

export function InvoiceMatchPanel({ record }: { record: WorkRecord }) {
  const query = useApi<any>(`/records/invoices/${record.id}/matching`);
  if (query.isPending) return <Loading />;
  if (query.error)
    return <ErrorState error={query.error} retry={() => query.refetch()} />;
  const data = query.data,
    matched = data.status === "matched";
  if (data.status === "not_applicable")
    return (
      <div className="proc-evidence">
        <div className="proc-panel-heading">
          <span className="proc-icon">
            <FileCheck2 size={23} />
          </span>
          <div>
            <h3>Contract-backed invoice</h3>
            <p>{data.reason}</p>
          </div>
        </div>
        <Link className="text-link" to={`/app/contracts/${data.order.id}`}>
          Review {data.order.number} <ArrowUpRight size={15} />
        </Link>
      </div>
    );
  return (
    <section className="proc-evidence">
      <div
        className={`proc-match-result ${matched ? "is-matched" : "has-exceptions"}`}
      >
        {matched ? <ShieldCheck size={29} /> : <AlertCircle size={29} />}
        <div>
          <span className="eyebrow">PO · RECEIPT · INVOICE</span>
          <h3>
            {matched
              ? "Three-way match complete"
              : data.status === "missing_receipt"
                ? "Receipt evidence is incomplete"
                : "Invoice exceptions need review"}
          </h3>
          <p>{data.reason}</p>
        </div>
        <Badge status={matched ? "approved" : "pending"}>
          {matched ? "Matched" : "Review required"}
        </Badge>
      </div>
      <div className="proc-value-grid">
        <div>
          <span>Agreed PO total</span>
          <strong>{money(data.order.amount_minor, record.currency)}</strong>
          <Link to={`/app/orders/${data.order.id}`}>
            {data.order.number} <ArrowUpRight size={13} />
          </Link>
        </div>
        <div>
          <span>Actual invoice total</span>
          <strong>{money(record.amount_minor, record.currency)}</strong>
          <small>{record.payload.invoice_number}</small>
        </div>
        <div>
          <span>Value variance</span>
          <strong
            className={data.variance_minor ? "proc-negative" : "proc-positive"}
          >
            {money(data.variance_minor, record.currency)}
          </strong>
          <small>Exact quantity, price, tax and discount checks</small>
        </div>
      </div>
      {data.issues.length > 0 && (
        <ul className="proc-issues">
          {data.issues.map((issue: string) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
      <ScrollRegion
        className="table-scroll"
        label="Three-way invoice comparison"
      >
        <table className="data-table proc-match-table">
          <thead>
            <tr>
              <th>Line item</th>
              <th>PO qty</th>
              <th>Accepted qty</th>
              <th>Invoice qty</th>
              <th>PO unit price</th>
              <th>Invoice unit price</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((line: any) => (
              <tr key={line.ordered.id}>
                <td>
                  <strong>{line.ordered.name}</strong>
                  <small className="proc-subtext">{line.ordered.unit}</small>
                  {line.issues.length > 0 && (
                    <ul className="proc-line-issues">
                      {line.issues.map((issue: string) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  )}
                </td>
                <td>{line.ordered.quantity}</td>
                <td>{line.ordered.accepted_quantity}</td>
                <td>{line.invoiced?.quantity ?? "—"}</td>
                <td>{money(line.ordered.unit_price * 100, record.currency)}</td>
                <td>
                  {line.invoiced
                    ? money(line.invoiced.unit_price * 100, record.currency)
                    : "—"}
                </td>
                <td>
                  <Badge status={line.matched ? "approved" : "pending"}>
                    {line.matched ? "Matched" : "Exception"}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
      <ReceiptHistory receipts={data.receipts} />
    </section>
  );
}

export function ProposalEvaluationPanel({ record }: { record: WorkRecord }) {
  const query = useApi<any>(`/records/quotations/${record.id}/evaluation`),
    { user } = useAuth(),
    client = useQueryClient(),
    toast = useToast();
  const [technical, setTechnical] = useState(""),
    [commercial, setCommercial] = useState(""),
    [notes, setNotes] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  useEffect(() => {
    if (query.data) {
      const value = query.data.evaluation;
      setTechnical(value ? String(value.technical_score) : "");
      setCommercial(value ? String(value.commercial_score) : "");
      setNotes(value?.notes || "");
    }
  }, [query.data]);
  if (query.isPending) return <Loading />;
  if (query.error)
    return <ErrorState error={query.error} retry={() => query.refetch()} />;
  const data = query.data;
  if (!data.applicable) return null;
  const editable =
    user!.permissions.quotations?.includes("review") &&
    ["submitted", "under_review", "clarification"].includes(record.status) &&
    ["published", "evaluation"].includes(data.rfq.status);
  const weighted =
    technical !== "" && commercial !== ""
      ? (Number(technical) * data.technical_weight +
          Number(commercial) * data.commercial_weight) /
        100
      : null;
  return (
    <section className="proc-evidence">
      <div className="proc-panel-heading">
        <span className="proc-icon">
          <GitCompareArrows size={23} />
        </span>
        <div>
          <h3>Proposal evaluation</h3>
          <p>
            Score against the published criteria. The authorized buyer makes the
            award decision.
          </p>
        </div>
        <Badge status={data.evaluation?.current ? "approved" : "pending"}>
          {data.evaluation
            ? data.evaluation.current
              ? "Current assessment"
              : "Revision needs assessment"
            : "Not assessed"}
        </Badge>
      </div>
      <div className="proc-criteria">
        <span className="eyebrow">PUBLISHED EVALUATION CRITERIA</span>
        <p>{data.criteria}</p>
      </div>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api(`/records/quotations/${record.id}/evaluation`, {
              method: "POST",
              body: JSON.stringify({
                quotation_version: record.version,
                version: data.evaluation?.version || 0,
                technical_score: Number(technical),
                commercial_score: Number(commercial),
                notes,
              }),
            });
            await client.invalidateQueries();
            toast("Proposal evaluation saved.");
          } catch (error) {
            setError(error);
          } finally {
            setBusy(false);
          }
        }}
      >
        <FormError error={error} />
        <div className="proc-scoring-grid">
          <Field
            label={`Technical score · ${data.technical_weight}% weight`}
            required
          >
            <Input
              type="number"
              min={0}
              max={100}
              step={1}
              required
              disabled={!editable}
              value={technical}
              onChange={(e) => setTechnical(e.target.value)}
              placeholder="0–100"
            />
          </Field>
          <Field
            label={`Commercial score · ${data.commercial_weight}% weight`}
            required
          >
            <Input
              type="number"
              min={0}
              max={100}
              step={1}
              required
              disabled={!editable}
              value={commercial}
              onChange={(e) => setCommercial(e.target.value)}
              placeholder="0–100"
            />
          </Field>
          <div className="proc-weighted-score">
            <span>Weighted score</span>
            <strong>
              {weighted === null ? "—" : weighted.toFixed(1)}
              <small> / 100</small>
            </strong>
          </div>
        </div>
        <Field label="Assessment & supporting rationale" required>
          <textarea
            className="input"
            rows={4}
            minLength={10}
            maxLength={5000}
            required
            readOnly={!editable}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Explain strengths, gaps and how these scores follow the published criteria."
          />
        </Field>
        <div className="proc-table-actions">
          <p>
            {data.evaluation
              ? `${data.evaluation.reviewer_name} · ${formatTime(data.evaluation.updated_at)}`
              : "Assessments are recorded in the audit trail."}
          </p>
          {editable && (
            <Button type="submit" busy={busy}>
              <Check size={16} /> Save evaluation
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}

export function PaymentReconciliationPanel({ record }: { record: WorkRecord }) {
  const query = useApi<any>(`/reconciliation/payments/${record.id}`);
  if (query.isPending) return <Loading />;
  if (query.error)
    return <ErrorState error={query.error} retry={() => query.refetch()} />;
  const data = query.data;
  return (
    <section className="proc-evidence">
      <div className="proc-panel-heading">
        <span className="proc-icon">
          <Landmark size={23} />
        </span>
        <div>
          <h3>Bank reconciliation</h3>
          <p>Trace this recorded payment to imported bank statement debits.</p>
        </div>
        <Badge status={data.remaining_minor === 0 ? "approved" : "pending"}>
          {data.remaining_minor === 0
            ? "Reconciled"
            : "Awaiting reconciliation"}
        </Badge>
      </div>
      <div className="proc-value-grid">
        <div>
          <span>Recorded payment</span>
          <strong>{money(data.amount_minor, data.currency)}</strong>
        </div>
        <div>
          <span>Bank matched</span>
          <strong>{money(data.matched_minor, data.currency)}</strong>
        </div>
        <div>
          <span>Remaining</span>
          <strong>{money(data.remaining_minor, data.currency)}</strong>
        </div>
      </div>
      {data.entries.map((entry: any) => (
        <Link
          className="proc-evidence-row"
          key={entry.id}
          to={`/app/reconciliation?account=${entry.account_id}&transaction=${entry.transaction_id}`}
        >
          <Landmark size={18} />
          <div>
            <strong>
              {entry.account_name} · •••• {entry.last4}
            </strong>
            <span>
              {entry.reference || "Bank statement"} ·{" "}
              {formatDate(entry.posted_date)}
            </span>
          </div>
          <strong>{money(entry.amount_minor, data.currency)}</strong>
          <ArrowUpRight size={16} />
        </Link>
      ))}
      {!data.entries.length && (
        <p className="subtle">
          No bank statement matches have been recorded for this payment.
        </p>
      )}
      <Link className="button button-secondary" to="/app/reconciliation">
        Open reconciliation workspace <ArrowUpRight size={15} />
      </Link>
    </section>
  );
}
