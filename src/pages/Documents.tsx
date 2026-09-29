import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  CalendarClock,
  Check,
  CheckCircle2,
  Download,
  FileCheck2,
  FileText,
  FolderOpen,
  Plus,
  RefreshCw,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { api, queryString, useApi } from "../lib/api";
import {
  Badge,
  Button,
  CardHeader,
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
import { formatDate } from "../lib/format";
import { documentCategories } from "../../shared/domain";
export default function Documents({
  organizationId,
  embedded = false,
}: {
  organizationId?: string;
  embedded?: boolean;
}) {
  const { user } = useAuth(),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [page, setPage] = useState(1),
    [upload, setUpload] = useState(false),
    [previous, setPrevious] = useState<any>(null),
    [review, setReview] = useState<any>(null);
  const result = useApi<any>(
      `/documents?${queryString({ q: query, status, page, organization_id: organizationId })}`,
    ),
    settings = useApi<any>("/admin/settings");
  const canReview =
      user!.internal && user!.permissions.verification?.includes("review"),
    canUpload = user!.permissions.documents?.includes("create");
  const documents = result.data?.items || [];
  const body = (
    <>
      <div className="table-filters">
        <SearchInput
          value={query}
          onChange={(v) => {
            setQuery(v);
            setPage(1);
          }}
          placeholder="Find a document…"
        />
        <div className="filter-right">
          <select
            className="compact-select"
            aria-label="Document status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {[
              "uploaded",
              "under_review",
              "approved",
              "rejected",
              "expired",
            ].map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
          {embedded && canUpload && (
            <Button variant="secondary" onClick={() => setUpload(true)}>
              <Plus size={15} />
              Upload
            </Button>
          )}
        </div>
      </div>
      {result.isPending ? (
        <Loading />
      ) : result.error ? (
        <ErrorState error={result.error} retry={() => result.refetch()} />
      ) : !documents.length ? (
        <EmptyState
          icon={<FolderOpen size={28} />}
          title="A home for your business documents"
          description="Add company identity, certifications and supporting business documents."
        >
          {canUpload && (
            <Button onClick={() => setUpload(true)}>
              <Plus size={16} />
              Upload document
            </Button>
          )}
        </EmptyState>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Document</th>
                {user!.internal && !organizationId && <th>Organization</th>}
                <th>Status</th>
                <th>Expiry</th>
                <th>Uploaded</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d: any) => (
                <tr key={d.id}>
                  <td>
                    <div className="identity-cell">
                      <span className="file-icon">
                        <FileText size={22} />
                      </span>
                      <div>
                        <strong>{d.name}</strong>
                        <small>
                          {d.category} · v{d.version} ·{" "}
                          {(d.size / 1024).toFixed(0)} KB
                        </small>
                      </div>
                    </div>
                  </td>
                  {user!.internal && !organizationId && (
                    <td>
                      <Link
                        className="subtle"
                        to={`/app/organizations/${d.organization_id}`}
                      >
                        {d.organization_name}
                      </Link>
                    </td>
                  )}
                  <td>
                    <Badge status={d.status} />
                  </td>
                  <td
                    className={
                      d.expires_at &&
                      Date.parse(d.expires_at) < Date.now() + 30 * 86400000
                        ? "text-amber"
                        : "subtle"
                    }
                  >
                    {formatDate(d.expires_at)}
                  </td>
                  <td className="subtle">{formatDate(d.created_at)}</td>
                  <td>
                    <div className="table-actions">
                      <a
                        className="icon-button"
                        href={`/api/documents/${d.id}/download`}
                        aria-label={`Download ${d.name}`}
                      >
                        <Download size={16} />
                      </a>
                      {canUpload && (
                        <button
                          className="icon-button"
                          aria-label={`Renew ${d.name}`}
                          onClick={() => {
                            setPrevious(d);
                            setUpload(true);
                          }}
                        >
                          <RefreshCw size={16} />
                        </button>
                      )}
                      {canReview && (
                        <Button variant="ghost" onClick={() => setReview(d)}>
                          Review
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result.data && (
        <Pagination total={result.data.total} page={page} onChange={setPage} />
      )}
    </>
  );
  return (
    <div>
      {!embedded && (
        <>
          <PageHeader
            eyebrow="TRUST, KEPT UP TO DATE"
            title="Documents & compliance"
            description="Your company identity, certifications and business documents. Organized and secure."
          >
            {canUpload && (
              <Button
                onClick={() => {
                  setPrevious(null);
                  setUpload(true);
                }}
              >
                <Plus size={17} />
                Upload document
              </Button>
            )}
          </PageHeader>
          <div className="document-intro-grid">
            <div className="document-intro">
              <span className="stat-icon sage">
                <ShieldCheck size={22} />
              </span>
              <div>
                <h3>One verified business identity</h3>
                <p>
                  Required for company verification:{" "}
                  {(
                    settings.data?.requiredDocuments || ["PAN", "Incorporation"]
                  ).join(", ")}
                  .
                </p>
              </div>
            </div>
            <div className="document-intro">
              <span className="stat-icon peach">
                <CalendarClock size={22} />
              </span>
              <div>
                <h3>Stay one step ahead</h3>
                <p>
                  Expiry reminders at{" "}
                  {(settings.data?.documentExpiryDays || [90, 60, 30]).join(
                    ", ",
                  )}{" "}
                  days help you keep your documents current.
                </p>
              </div>
            </div>
          </div>
        </>
      )}
      {embedded ? body : <div className="card">{body}</div>}
      {upload && (
        <DocumentUpload
          organizationId={organizationId}
          previous={previous}
          onClose={() => {
            setUpload(false);
            setPrevious(null);
          }}
        />
      )}
      {review && (
        <DocumentReview document={review} onClose={() => setReview(null)} />
      )}
    </div>
  );
}
export function DocumentUpload({
  recordId,
  organizationId,
  previous,
  onClose,
}: {
  recordId?: string;
  organizationId?: string;
  previous?: any;
  onClose: () => void;
}) {
  const { user } = useAuth(),
    toast = useToast(),
    client = useQueryClient(),
    [file, setFile] = useState<File | null>(null),
    [category, setCategory] = useState(
      previous?.category || (recordId ? "Other" : "PAN"),
    ),
    [org, setOrg] = useState(
      previous?.organization_id ||
        organizationId ||
        user!.organization_id ||
        "",
    ),
    [expiry, setExpiry] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const organizations = useApi<any>(
    "/organizations?limit=100",
    user!.internal && !recordId,
  );
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError(new Error("Choose a document to upload."));
      return;
    }
    setBusy(true);
    setError(null);
    const data = new FormData();
    data.set("file", file);
    data.set("category", category);
    if (org) data.set("organization_id", org);
    if (recordId) data.set("record_id", recordId);
    if (expiry) data.set("expires_at", expiry);
    if (previous) data.set("previous_id", previous.id);
    try {
      await api("/documents", { method: "POST", body: data });
      await client.invalidateQueries();
      toast(
        previous
          ? "New document version uploaded for review."
          : "Document uploaded securely.",
      );
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={previous ? "Renew a document" : "Upload a document"}
      description={
        previous
          ? `A new version of ${previous.name} will be created. The previous file stays in history.`
          : "PDF, PNG or JPEG · Up to 10 MB. Access is restricted to authorized users."
      }
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="modal-body form-stack">
          <FormError error={error} />
          {user!.internal && !recordId && (
            <Field label="Organization" required>
              <select
                name="organization_id"
                className="input"
                value={org}
                onChange={(e) => setOrg(e.target.value)}
                required
                disabled={Boolean(previous || organizationId)}
              >
                <option value="">Choose an organization</option>
                {organizations.data?.items.map((o: any) => (
                  <option key={o.id} value={o.id}>
                    {o.legal_name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Document category" required>
            <select
              name="category"
              className="input"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={Boolean(previous)}
            >
              {documentCategories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field
            label="Expiry date"
            hint="Leave blank for documents that do not expire."
          >
            <Input
              type="date"
              name="expires_at"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
          </Field>
          <div className={`upload-zone ${file ? "has-file" : ""}`}>
            <UploadCloud size={32} />
            <strong>{file?.name || "Choose your document"}</strong>
            <span>
              {file
                ? `${(file.size / 1024).toFixed(0)} KB · Click to change`
                : "Click to browse · PDF, PNG or JPEG"}
            </span>
            <input
              type="file"
              name="file"
              aria-label="Choose document file"
              required
              accept="application/pdf,image/png,image/jpeg"
              onChange={(e) => {
                const selected = e.target.files?.[0];
                if (selected && selected.size > 10 * 1024 * 1024) {
                  setError(new Error("Choose a file smaller than 10 MB."));
                  setFile(null);
                } else setFile(selected || null);
              }}
            />
          </div>
        </div>
        <div className="modal-footer">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={busy} type="submit">
            <UploadCloud size={16} />
            Upload securely
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function DocumentReview({
  document: doc,
  onClose,
}: {
  document: any;
  onClose: () => void;
}) {
  const [status, setStatus] = useState("approved"),
    [note, setNote] = useState(""),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    client = useQueryClient(),
    toast = useToast();
  return (
    <Modal
      title="Review company document"
      description={`${doc.organization_name || ""} · ${doc.category} · Version ${doc.version}`}
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api(`/documents/${doc.id}/review`, {
              method: "POST",
              body: JSON.stringify({ status, note }),
            });
            await client.invalidateQueries();
            toast("Document review saved.");
            onClose();
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body form-stack">
          <FormError error={error} />
          <a
            href={`/api/documents/${doc.id}/download`}
            className="document-review-link"
          >
            <FileText size={30} />
            <div>
              <strong>{doc.name}</strong>
              <small>Download and inspect this document before deciding</small>
            </div>
            <Download size={18} />
          </a>
          <Field label="Decision">
            <select
              className="input"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="under_review">Under review</option>
              <option value="approved">Approve document</option>
              <option value="rejected">Reject document</option>
            </select>
          </Field>
          <Field label="Review notes" required={status === "rejected"}>
            <textarea
              className="input"
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              required={status === "rejected"}
              minLength={status === "rejected" ? 5 : undefined}
            />
          </Field>
          {doc.review_note && (
            <p className="muted">Previous note: {doc.review_note}</p>
          )}
        </div>
        <div className="modal-footer">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={busy} type="submit">
            <Check size={16} />
            Save decision
          </Button>
        </div>
      </form>
    </Modal>
  );
}
