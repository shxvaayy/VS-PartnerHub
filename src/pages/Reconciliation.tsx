import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CheckCheck,
  CircleDollarSign,
  Download,
  FileSpreadsheet,
  GitCompareArrows,
  Landmark,
  Plus,
  RotateCcw,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { api, queryString, useApi } from "../lib/api";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { formatDate, formatTime, money } from "../lib/format";
import { label } from "../../shared/domain";
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
  PageHeader,
  Pagination,
  SearchInput,
  useToast,
} from "../components/ui";
import ScrollRegion from "../components/ScrollRegion";

function BankBadge({ transaction }: { transaction: any }) {
  const labels: Record<string, string> = {
    matched: "Reconciled",
    partial: "Partially matched",
    unmatched: "Unmatched",
    credit: "Credit to review",
    exception: "Classified exception",
  };
  return (
    <Badge
      status={
        transaction.status === "matched"
          ? "approved"
          : transaction.status === "credit"
            ? "review"
            : "pending"
      }
    >
      {labels[transaction.status]}
    </Badge>
  );
}
export default function Reconciliation() {
  const [params, setParams] = useSearchParams(),
    accounts = useApi<any>("/reconciliation/accounts");
  const [adding, setAdding] = useState(false),
    [importing, setImporting] = useState(false);
  const accountId = params.get("account") || accounts.data?.items[0]?.id || "";
  const search = useDebouncedValue(params.get("q") || "", accountId);
  const filterValues = {
    q: search,
    status: params.get("status") || "all",
    page: params.get("page") || 1,
    from: params.get("from"),
    to: params.get("to"),
  };
  const result = useApi<any>(
    `/reconciliation/accounts/${accountId}/transactions?${queryString(filterValues)}`,
    Boolean(accountId),
  );
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    if (key !== "page") next.delete("page");
    if (key === "account") next.delete("transaction");
    setParams(next, { replace: key === "q" });
  };
  if (accounts.isPending) return <Loading />;
  if (accounts.error)
    return (
      <ErrorState error={accounts.error} retry={() => accounts.refetch()} />
    );
  const current = result.data?.account,
    summary = result.data?.summary;
  return (
    <div className="proc-workspace">
      <PageHeader
        eyebrow="FINANCIAL CONTROL"
        title="Bank reconciliation"
        description="Connect recorded payments to bank statement evidence. Investigate the differences and keep a clear audit trail."
      >
        {accounts.data.can_manage && (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            <Plus size={16} /> Add bank account
          </Button>
        )}
        {accountId && accounts.data.can_manage && (
          <Button onClick={() => setImporting(true)}>
            <Upload size={16} /> Import statement
          </Button>
        )}
      </PageHeader>
      {!accounts.data.items.length ? (
        <div className="card proc-recon-start">
          <div className="proc-start-icon">
            <Landmark size={34} />
          </div>
          <h2>Bring your payment evidence together.</h2>
          <p>
            Add a buyer bank account, import its statement and match debits to
            completed payment records.
          </p>
          <div className="proc-onboarding-steps">
            <span>
              <b>01</b> Choose the buyer & currency
            </span>
            <span>
              <b>02</b> Validate a statement
            </span>
            <span>
              <b>03</b> Match, review & reconcile
            </span>
          </div>
          {accounts.data.can_manage && (
            <Button onClick={() => setAdding(true)}>
              Add your first bank account <ArrowRight size={16} />
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="proc-bank-strip">
            <span className="proc-bank-icon">
              <Landmark size={25} />
            </span>
            <Field label="Bank account">
              <select
                className="input"
                value={accountId}
                onChange={(e) => set("account", e.target.value)}
              >
                {accounts.data.items.map((account: any) => (
                  <option value={account.id} key={account.id}>
                    {account.name} · •••• {account.last4} · {account.currency} ·{" "}
                    {account.organization_name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="proc-bank-context">
              <ShieldCheck size={16} />
              <span>
                Matches completed payment records.
                <br />
                Payment execution stays with your bank.
              </span>
            </div>
          </div>
          {result.isPending ? (
            <Loading />
          ) : result.error ? (
            <ErrorState error={result.error} retry={() => result.refetch()} />
          ) : (
            <>
              <div className="proc-kpi-grid">
                {[
                  {
                    title: "Statement debits",
                    value: summary.debit_minor,
                    note: `${summary.transaction_count} statement entries`,
                    Icon: Landmark,
                  },
                  {
                    title: "Bank matched",
                    value: summary.matched_minor,
                    note: "Active payment allocations",
                    Icon: CheckCheck,
                  },
                  {
                    title: "Unmatched debits",
                    value: summary.unmatched_minor,
                    note: "Open amounts needing a match",
                    Icon: GitCompareArrows,
                    attention: summary.unmatched_minor > 0,
                  },
                  {
                    title: "Statement credits",
                    value: summary.credit_minor,
                    note: "Review refunds and incoming transfers",
                    Icon: ArrowDownLeft,
                  },
                ].map((metric) => (
                  <div
                    key={metric.title}
                    className={`proc-kpi ${metric.attention ? "is-attention" : ""}`}
                  >
                    <div>
                      <span>{metric.title}</span>
                      <metric.Icon size={20} />
                    </div>
                    <strong>{money(metric.value, current.currency)}</strong>
                    <span>{metric.note}</span>
                  </div>
                ))}
              </div>
              <section className="card proc-statement-card">
                <div className="proc-card-heading">
                  <div>
                    <h3>Statement workbench</h3>
                    <p>
                      Review exact references, split allocations and unresolved
                      entries.
                    </p>
                  </div>
                  <a
                    className="button button-secondary"
                    href={`/api/reconciliation/accounts/${accountId}/export?${queryString(filterValues)}`}
                  >
                    <Download size={15} /> Export ledger
                  </a>
                </div>
                <div className="status-tabs proc-status-tabs">
                  {[
                    ["all", "All entries"],
                    ["unmatched", "Unmatched"],
                    ["partial", "Partially matched"],
                    ["matched", "Reconciled"],
                    ["credit", "Credits"],
                    ["exception", "Exceptions"],
                  ].map(([key, title]) => (
                    <button
                      key={key}
                      className={filterValues.status === key ? "active" : ""}
                      onClick={() => set("status", key)}
                    >
                      {title}
                    </button>
                  ))}
                </div>
                <div className="proc-statement-filters">
                  <SearchInput
                    value={params.get("q") || ""}
                    onChange={(value) => set("q", value)}
                    placeholder="Search bank reference, ID or description…"
                  />
                  <div>
                    <Field label="From">
                      <Input
                        type="date"
                        value={params.get("from") || ""}
                        onChange={(e) => set("from", e.target.value)}
                      />
                    </Field>
                    <Field label="To">
                      <Input
                        type="date"
                        value={params.get("to") || ""}
                        onChange={(e) => set("to", e.target.value)}
                      />
                    </Field>
                  </div>
                </div>
                {result.data.items.length ? (
                  <ScrollRegion
                    className="table-scroll"
                    label="Bank statement transactions"
                  >
                    <table className="data-table proc-bank-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Bank entry</th>
                          <th>Statement amount</th>
                          <th>Matched</th>
                          <th>Status</th>
                          <th>
                            <span className="sr-only">Review</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.data.items.map((transaction: any) => (
                          <tr key={transaction.id}>
                            <td className="nowrap">
                              {formatDate(transaction.posted_date)}
                            </td>
                            <td>
                              <strong>
                                {transaction.reference ||
                                  transaction.transaction_id}
                              </strong>
                              <small className="proc-subtext">
                                {transaction.description ||
                                  transaction.transaction_id}
                              </small>
                            </td>
                            <td className="amount-cell">
                              <span
                                className={
                                  transaction.direction === "credit"
                                    ? "proc-positive"
                                    : ""
                                }
                              >
                                {transaction.direction === "credit"
                                  ? "+ "
                                  : "− "}
                                {money(
                                  transaction.amount_minor,
                                  current.currency,
                                )}
                              </span>
                              <small className="proc-subtext">
                                {label(transaction.direction)}
                              </small>
                            </td>
                            <td>
                              <strong>
                                {money(
                                  transaction.matched_minor,
                                  current.currency,
                                )}
                              </strong>
                              <div className="proc-meter">
                                <span
                                  style={{
                                    width: `${(transaction.matched_minor / transaction.amount_minor) * 100}%`,
                                  }}
                                />
                              </div>
                            </td>
                            <td>
                              <BankBadge transaction={transaction} />
                              {transaction.disposition !== "open" && (
                                <small className="proc-subtext">
                                  {label(transaction.disposition)}
                                </small>
                              )}
                            </td>
                            <td>
                              <Button
                                variant="secondary"
                                onClick={() =>
                                  set("transaction", transaction.id)
                                }
                              >
                                Review <ArrowUpRight size={14} />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ScrollRegion>
                ) : (
                  <EmptyState
                    title={
                      summary.transaction_count
                        ? "No entries match these filters"
                        : "Your statement workbench is ready"
                    }
                    description={
                      summary.transaction_count
                        ? "Adjust the search, date range or reconciliation status."
                        : "Import a statement CSV to begin reviewing payments."
                    }
                  />
                )}
                <Pagination
                  page={result.data.page}
                  limit={result.data.limit}
                  total={result.data.total}
                  onChange={(page) => set("page", String(page))}
                />
              </section>
              <p className="proc-footnote">
                Amounts reflect the selected date and search filters. Classified
                exceptions ({money(summary.exception_minor, current.currency)})
                remain separate from reconciled payments.
              </p>
            </>
          )}
        </>
      )}
      {adding && (
        <BankAccountForm
          organizations={accounts.data.organizations}
          onClose={() => setAdding(false)}
          onCreated={(id) => {
            setAdding(false);
            set("account", id);
          }}
        />
      )}
      {importing && accountId && (
        <StatementImport
          accountId={accountId}
          onClose={() => setImporting(false)}
        />
      )}
      {params.get("transaction") && (
        <TransactionReview
          id={params.get("transaction")!}
          onClose={() => set("transaction", "")}
        />
      )}
    </div>
  );
}

function BankAccountForm({
  organizations,
  onClose,
  onCreated,
}: {
  organizations: any[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [form, setForm] = useState({
      organization_id: organizations[0]?.id || "",
      name: "",
      bank_name: "",
      last4: "",
      currency: "INR",
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const client = useQueryClient(),
    toast = useToast();
  return (
    <Modal
      title="Add a bank account"
      description="Identify the buyer's account used for payment reconciliation."
      onClose={onClose}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const account = await api<any>("/reconciliation/accounts", {
              method: "POST",
              body: JSON.stringify(form),
            });
            await client.invalidateQueries();
            toast("Bank account added.");
            onCreated(account.id);
          } catch (error) {
            setError(error);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body form-stack">
          <FormError error={error} />
          <Field label="Buyer organization" required>
            <select
              className="input"
              value={form.organization_id}
              required
              onChange={(e) =>
                setForm({ ...form, organization_id: e.target.value })
              }
            >
              {organizations.map((org) => (
                <option value={org.id} key={org.id}>
                  {org.legal_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Account label" required>
            <Input
              required
              minLength={3}
              maxLength={120}
              placeholder="Operations current account"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="Bank name" required>
            <Input
              required
              minLength={2}
              maxLength={120}
              value={form.bank_name}
              onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
            />
          </Field>
          <div className="form-grid">
            <Field label="Account last four digits" required>
              <Input
                required
                inputMode="numeric"
                pattern="[0-9]{4}"
                maxLength={4}
                value={form.last4}
                onChange={(e) => setForm({ ...form, last4: e.target.value })}
              />
            </Field>
            <Field label="Account currency" required>
              <select
                className="input"
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
              >
                {["INR", "USD", "EUR", "GBP"].map((currency) => (
                  <option key={currency}>{currency}</option>
                ))}
              </select>
            </Field>
          </div>
          <p className="subtle">
            Use one account entry per bank account and currency. Full account
            numbers and banking credentials are not needed here.
          </p>
        </div>
        <div className="modal-footer">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={busy}>
            Add bank account
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function StatementImport({
  accountId,
  onClose,
}: {
  accountId: string;
  onClose: () => void;
}) {
  const [file, setFile] = useState<{ file_name: string; csv: string }>(),
    [preview, setPreview] = useState<any>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const client = useQueryClient(),
    toast = useToast();
  const template =
    "date,transaction_id,reference,description,debit,credit,currency\r\n";
  return (
    <Modal
      title="Import a bank statement"
      description="Preview every row before adding it to the reconciliation ledger."
      onClose={onClose}
      wide
    >
      <div className="modal-body form-stack">
        <FormError error={error} />
        <div className="proc-import-guide">
          <span className="proc-icon">
            <FileSpreadsheet size={24} />
          </span>
          <div>
            <h3>A clear format for reliable matching</h3>
            <p>
              CSV · Up to 1,000 rows · Dates as YYYY-MM-DD · Separate debit and
              credit amounts. Each bank transaction needs a unique ID.
            </p>
            <a
              className="text-link"
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(template)}`}
              download="bank-statement-template.csv"
            >
              <Download size={14} /> Download CSV template
            </a>
          </div>
        </div>
        <label className="proc-upload-zone">
          <Upload size={26} />
          <strong>{file?.file_name || "Choose a statement CSV"}</strong>
          <span>
            Keep the bank's transaction IDs unchanged to detect duplicate
            entries.
          </span>
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label="Statement CSV"
            disabled={busy}
            onChange={async (event) => {
              const chosen = event.target.files?.[0];
              setError(null);
              setPreview(undefined);
              setFile(undefined);
              if (!chosen) return;
              if (chosen.size > 500000) {
                setError(new Error("Choose a CSV smaller than 500 KB."));
                return;
              }
              setBusy(true);
              try {
                const input = {
                  file_name: chosen.name,
                  csv: await chosen.text(),
                };
                setFile(input);
                setPreview(
                  await api(
                    `/reconciliation/accounts/${accountId}/import-preview`,
                    { method: "POST", body: JSON.stringify(input) },
                  ),
                );
              } catch (error) {
                setError(error);
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        {busy && !preview && <Loading />}
        {preview && (
          <>
            <div className="proc-import-counts">
              <span>
                <b>{preview.new_rows}</b> new rows
              </span>
              <span>
                <b>{preview.duplicate_rows}</b> already imported
              </span>
              <span>
                <b>{preview.errors.length}</b> errors to resolve
              </span>
              <Badge status={preview.valid ? "approved" : "pending"}>
                {preview.valid ? "Validation passed" : "Changes needed"}
              </Badge>
            </div>
            {preview.errors.length > 0 && (
              <div className="proc-validation-errors" role="alert">
                <h4>Fix these rows, then choose the corrected file</h4>
                <ul>
                  {preview.errors.map((error: any, index: number) => (
                    <li key={index}>
                      Row {error.row}: {error.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <ScrollRegion
              className="table-scroll proc-import-preview"
              label="Statement import preview"
            >
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Date</th>
                    <th>Bank transaction ID</th>
                    <th>Reference</th>
                    <th>Direction</th>
                    <th>Amount</th>
                    <th>Validation</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row: any) => (
                    <tr key={row.row}>
                      <td>{row.row}</td>
                      <td className="nowrap">{row.posted_date}</td>
                      <td>{row.transaction_id}</td>
                      <td>{row.reference || "—"}</td>
                      <td>{label(row.direction)}</td>
                      <td className="amount-cell">
                        {(row.amount_minor / 100).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td>
                        <Badge
                          status={
                            row.state === "new"
                              ? "approved"
                              : row.state === "conflict"
                                ? "rejected"
                                : "pending"
                          }
                        >
                          {label(row.state)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          </>
        )}
      </div>
      <div className="modal-footer">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!preview?.valid || !preview.new_rows}
          busy={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const result = await api<any>(
                `/reconciliation/accounts/${accountId}/import`,
                { method: "POST", body: JSON.stringify(file) },
              );
              await client.invalidateQueries();
              toast(
                result.repeated
                  ? "This statement has already been imported."
                  : `${result.imported_rows} statement rows imported; ${result.duplicate_rows} duplicates skipped.`,
              );
              onClose();
            } catch (error) {
              setError(error);
            } finally {
              setBusy(false);
            }
          }}
        >
          <CheckCheck size={16} />{" "}
          {preview?.new_rows === 0 && preview?.valid
            ? "Already imported"
            : "Confirm import"}
        </Button>
      </div>
    </Modal>
  );
}

function TransactionReview({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const [search, setSearch] = useState(""),
    searchValue = useDebouncedValue(search, id);
  const query = useApi<any>(
    `/reconciliation/transactions/${id}?${queryString({ q: searchValue })}`,
  );
  const [selected, setSelected] = useState<
    Record<string, { payment: any; amount: string }>
  >({});
  const [note, setNote] = useState(""),
    [category, setCategory] = useState("other"),
    [exceptionNote, setExceptionNote] = useState("");
  const [reversing, setReversing] = useState(""),
    [reversalNote, setReversalNote] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const [tab, setTab] = useState("match"),
    client = useQueryClient(),
    toast = useToast();
  useEffect(() => {
    setSelected({});
    setNote("");
    setReversing("");
    setReversalNote("");
    setCategory(
      query.data?.transaction.disposition === "open"
        ? "other"
        : query.data?.transaction.disposition || "other",
    );
    setExceptionNote(query.data?.transaction.exception_note || "");
  }, [query.data?.transaction.version, id]);
  const data = query.data,
    transaction = data?.transaction,
    account = data?.account;
  const remaining = transaction?.remaining_minor || 0;
  const allocated = Object.values(selected).reduce(
    (sum, item) => sum + Math.round(Number(item.amount || 0) * 100),
    0,
  );
  const mutate = async (route: string, body: unknown, success: string) => {
    setBusy(true);
    setError(null);
    try {
      await api(route, { method: "POST", body: JSON.stringify(body) });
      await client.invalidateQueries();
      toast(success);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  };
  const canMatch =
    data?.can_manage &&
    transaction?.direction === "debit" &&
    transaction?.disposition === "open" &&
    remaining > 0;
  return (
    <Modal
      title="Review bank entry"
      description={
        account
          ? `${account.name} · •••• ${account.last4} · ${account.currency}`
          : "Loading statement evidence…"
      }
      onClose={onClose}
      wide
    >
      <div className="modal-body proc-review-body">
        {query.isPending ? (
          <Loading />
        ) : query.error ? (
          <ErrorState error={query.error} retry={() => query.refetch()} />
        ) : (
          <>
            <div className="proc-entry-heading">
              <span className="proc-icon">
                <Landmark size={25} />
              </span>
              <div>
                <span className="eyebrow">
                  {transaction.posted_date} · {transaction.transaction_id}
                </span>
                <h3>{transaction.reference || "Statement transaction"}</h3>
                <p>{transaction.description}</p>
              </div>
              <BankBadge transaction={transaction} />
            </div>
            <div className="proc-value-grid">
              <div>
                <span>Bank {transaction.direction}</span>
                <strong>
                  {money(transaction.amount_minor, account.currency)}
                </strong>
              </div>
              <div>
                <span>Matched to payments</span>
                <strong>
                  {money(transaction.matched_minor, account.currency)}
                </strong>
              </div>
              <div>
                <span>Unmatched amount</span>
                <strong>{money(remaining, account.currency)}</strong>
              </div>
            </div>
            <div className="detail-tabs proc-review-tabs">
              {[
                ["match", "Match payments"],
                ["exception", "Classify exception"],
                ["history", "Matches & history"],
              ].map(([key, title]) => (
                <button
                  type="button"
                  key={key}
                  className={tab === key ? "active" : ""}
                  onClick={() => {
                    setTab(key);
                    setError(null);
                  }}
                >
                  {title}
                  {key === "history" && data.allocations.length > 0
                    ? ` (${data.allocations.length})`
                    : ""}
                </button>
              ))}
            </div>
            <FormError error={error} />
            {tab === "match" &&
              (canMatch ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    mutate(
                      `/reconciliation/transactions/${id}/allocations`,
                      {
                        version: transaction.version,
                        note,
                        allocations: Object.entries(selected).map(
                          ([payment_id, item]) => ({
                            payment_id,
                            amount: Number(item.amount),
                          }),
                        ),
                      },
                      "Bank statement matched to the selected payments.",
                    );
                  }}
                >
                  <div className="proc-match-intro">
                    <div>
                      <h3>Choose completed payments</h3>
                      <p>
                        Suggestions use references and remaining amounts. Review
                        the evidence before confirming.
                      </p>
                    </div>
                    <SearchInput
                      value={search}
                      onChange={setSearch}
                      placeholder="Search payment, reference or partner…"
                    />
                  </div>
                  {data.candidates.length ? (
                    <div className="proc-candidate-list">
                      {data.candidates.map((payment: any) => (
                        <label
                          className={`proc-payment-option ${selected[payment.id] ? "is-selected" : ""}`}
                          key={payment.id}
                        >
                          <input
                            type="checkbox"
                            aria-label={`Select ${payment.number}`}
                            checked={Boolean(selected[payment.id])}
                            onChange={(event) => {
                              const next = { ...selected };
                              if (event.target.checked)
                                next[payment.id] = {
                                  payment,
                                  amount: (
                                    Math.max(
                                      0,
                                      Math.min(
                                        payment.remaining_minor,
                                        remaining - allocated,
                                      ),
                                    ) / 100
                                  ).toFixed(2),
                                };
                              else delete next[payment.id];
                              setSelected(next);
                            }}
                          />
                          <div>
                            <strong>
                              {payment.number} ·{" "}
                              {payment.partner_name || payment.title}
                            </strong>
                            <span>
                              {payment.reference} ·{" "}
                              {formatDate(payment.payment_date)}
                            </span>
                            <small
                              className={
                                payment.rank >= 2 ? "proc-positive" : ""
                              }
                            >
                              {payment.suggestion}
                            </small>
                          </div>
                          <strong>
                            {money(payment.remaining_minor, account.currency)}
                            <small>available to match</small>
                          </strong>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      title="No eligible payments found"
                      description="Record and complete the relevant payment, or adjust your search. Only this buyer's payments in the account currency are eligible."
                    />
                  )}
                  {data.candidate_total > data.candidates.length && (
                    <p className="proc-footnote">
                      Showing {data.candidates.length} of {data.candidate_total}{" "}
                      eligible payments. Search to narrow the list.
                    </p>
                  )}
                  {Object.keys(selected).length > 0 && (
                    <div className="proc-selected-payments">
                      <h4>Allocation plan</h4>
                      {Object.entries(selected).map(([paymentId, item]) => (
                        <div key={paymentId}>
                          <div>
                            <strong>{item.payment.number}</strong>
                            <span>
                              {item.payment.partner_name || item.payment.title}
                            </span>
                          </div>
                          <Field label={`Allocate to ${item.payment.number}`}>
                            <Input
                              type="number"
                              step="0.01"
                              min="0.01"
                              max={item.payment.remaining_minor / 100}
                              required
                              value={item.amount}
                              onChange={(event) =>
                                setSelected({
                                  ...selected,
                                  [paymentId]: {
                                    ...item,
                                    amount: event.target.value,
                                  },
                                })
                              }
                            />
                          </Field>
                          <button
                            className="icon-button"
                            type="button"
                            aria-label={`Remove ${item.payment.number}`}
                            onClick={() => {
                              const next = { ...selected };
                              delete next[paymentId];
                              setSelected(next);
                            }}
                          >
                            <X size={15} />
                          </button>
                        </div>
                      ))}
                      <div className="proc-allocation-total">
                        <span>
                          Selected {money(allocated, account.currency)}
                        </span>
                        <strong
                          className={
                            allocated > remaining ? "proc-negative" : ""
                          }
                        >
                          {money(remaining - allocated, account.currency)}{" "}
                          remains
                        </strong>
                      </div>
                    </div>
                  )}
                  <Field label="Matching evidence / note" required>
                    <textarea
                      className="input"
                      rows={3}
                      minLength={5}
                      maxLength={2000}
                      required
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Record the reference or evidence used to match these payments."
                    />
                  </Field>
                  <div className="proc-table-actions">
                    <p>
                      Allocations update reconciliation only; payment and
                      invoice statuses stay unchanged.
                    </p>
                    <Button
                      type="submit"
                      busy={busy}
                      disabled={
                        !Object.keys(selected).length ||
                        allocated <= 0 ||
                        allocated > remaining
                      }
                    >
                      <CheckCheck size={16} /> Confirm match
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="proc-static-message">
                  <CircleDollarSign size={26} />
                  <h3>
                    {transaction.status === "matched"
                      ? "This bank debit is fully reconciled"
                      : transaction.direction === "credit"
                        ? "Review this incoming credit"
                        : transaction.disposition !== "open"
                          ? "This entry is classified as an exception"
                          : "Reconciliation is read-only for your role"}
                  </h3>
                  <p>
                    {transaction.direction === "credit"
                      ? "Record the reason under Classify exception. Incoming credits are kept separate from outgoing payment matches."
                      : transaction.status === "matched"
                        ? "Review linked payments and any corrections in Matches & history."
                        : "Review the classification or contact an authorized finance reviewer to continue."}
                  </p>
                </div>
              ))}
            {tab === "exception" && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  mutate(
                    `/reconciliation/transactions/${id}/exception`,
                    {
                      version: transaction.version,
                      category,
                      note: exceptionNote,
                    },
                    category === "open"
                      ? "Statement entry reopened for reconciliation."
                      : "Statement exception recorded.",
                  );
                }}
              >
                <div className="proc-match-intro">
                  <div>
                    <h3>Explain an entry outside outgoing payments</h3>
                    <p>
                      Classified exceptions remain visible in the ledger and are
                      excluded from the reconciled payment total.
                    </p>
                  </div>
                </div>
                {transaction.matched_minor > 0 && (
                  <div className="notice-banner">
                    Reverse active matches in Matches & history before
                    classifying this entry.
                  </div>
                )}
                <div className="form-stack">
                  <Field label="Exception category" required>
                    <select
                      className="input"
                      disabled={
                        !data.can_manage || transaction.matched_minor > 0
                      }
                      value={category}
                      onChange={(event) => setCategory(event.target.value)}
                    >
                      {[
                        ["bank_fee", "Bank fee / charge"],
                        ["refund", "Refund"],
                        ["internal_transfer", "Internal transfer"],
                        ["other", "Other explained entry"],
                        ["open", "Reopen for matching"],
                      ].map(([value, title]) => (
                        <option value={value} key={value}>
                          {title}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Classification reason" required>
                    <textarea
                      className="input"
                      minLength={5}
                      maxLength={2000}
                      rows={4}
                      value={exceptionNote}
                      required
                      readOnly={!data.can_manage}
                      onChange={(event) => setExceptionNote(event.target.value)}
                      placeholder="Explain the entry and record supporting evidence."
                    />
                  </Field>
                </div>
                {data.can_manage && (
                  <div className="proc-table-actions">
                    <p>Every classification and reopening is audited.</p>
                    <Button
                      type="submit"
                      busy={busy}
                      disabled={transaction.matched_minor > 0}
                    >
                      Save classification
                    </Button>
                  </div>
                )}
              </form>
            )}
            {tab === "history" && (
              <section className="proc-allocation-history">
                <h3>Payment matches & reversals</h3>
                {data.allocations.length ? (
                  data.allocations.map((allocation: any) => (
                    <div
                      className={`proc-allocation-record ${allocation.reversed_at ? "is-reversed" : ""}`}
                      key={allocation.id}
                    >
                      <div className="proc-table-actions">
                        <div>
                          <Link
                            className="text-link"
                            to={`/app/payments/${allocation.payment_id}`}
                          >
                            {allocation.payment_number}{" "}
                            <ArrowUpRight size={14} />
                          </Link>
                          <strong>
                            {money(allocation.amount_minor, account.currency)}
                          </strong>
                        </div>
                        <Badge
                          status={
                            allocation.reversed_at ? "rejected" : "approved"
                          }
                        >
                          {allocation.reversed_at ? "Reversed" : "Active match"}
                        </Badge>
                      </div>
                      <p>{allocation.note}</p>
                      <small>
                        {allocation.created_by_name} ·{" "}
                        {formatTime(allocation.created_at)}
                      </small>
                      {allocation.reversed_at ? (
                        <div className="proc-reversal-note">
                          <RotateCcw size={15} />
                          <span>
                            {allocation.reversal_reason}
                            <small>
                              {allocation.reversed_by_name} ·{" "}
                              {formatTime(allocation.reversed_at)}
                            </small>
                          </span>
                        </div>
                      ) : (
                        data.can_manage &&
                        (reversing === allocation.id ? (
                          <form
                            className="proc-reversal-form"
                            onSubmit={(event) => {
                              event.preventDefault();
                              mutate(
                                `/reconciliation/allocations/${allocation.id}/reverse`,
                                {
                                  version: transaction.version,
                                  note: reversalNote,
                                },
                                "Match reversed. Both balances are available for reconciliation again.",
                              );
                            }}
                          >
                            <Field
                              label="Reason for reversing this match"
                              required
                            >
                              <textarea
                                className="input"
                                required
                                minLength={5}
                                maxLength={2000}
                                value={reversalNote}
                                onChange={(event) =>
                                  setReversalNote(event.target.value)
                                }
                              />
                            </Field>
                            <div className="proc-table-actions">
                              <Button
                                type="button"
                                variant="ghost"
                                onClick={() => setReversing("")}
                              >
                                Cancel
                              </Button>
                              <Button
                                type="submit"
                                variant="danger"
                                busy={busy}
                              >
                                Confirm reversal
                              </Button>
                            </div>
                          </form>
                        ) : (
                          <Button
                            variant="ghost"
                            type="button"
                            onClick={() => {
                              setReversing(allocation.id);
                              setReversalNote("");
                            }}
                          >
                            <RotateCcw size={14} /> Reverse match
                          </Button>
                        ))
                      )}
                    </div>
                  ))
                ) : (
                  <EmptyState
                    title="No matches recorded yet"
                    description="Confirmed allocations and their reversal history will appear here."
                  />
                )}
                {data.events.length > 0 && (
                  <div className="proc-review-events">
                    <h4>Review activity</h4>
                    {data.events.map((event: any) => (
                      <div key={event.id}>
                        <span className="proc-event-dot" />
                        <div>
                          <strong>
                            {label(event.action.replace(/^bank_/, ""))}
                          </strong>
                          <small>
                            {event.actor_name} · {formatTime(event.created_at)}
                          </small>
                          {event.new_status && (
                            <Badge
                              status={
                                event.new_status === "open" ? "open" : "pending"
                              }
                            >
                              {label(event.new_status)}
                            </Badge>
                          )}
                          <p>{event.note}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
      <div className="modal-footer">
        <Button variant="secondary" onClick={onClose}>
          Close review
        </Button>
      </div>
    </Modal>
  );
}
