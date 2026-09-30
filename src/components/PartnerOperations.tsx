import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  CheckCircle2,
  Download,
  Pencil,
  Plus,
  Upload,
  UsersRound,
} from "lucide-react";
import { api, queryString, useApi } from "../lib/api";
import { useAuth } from "../lib/auth";
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
} from "./ui";
import { formatDate, money } from "../lib/format";

export function ContactsPanel({
  organizationId,
  canEdit,
}: {
  organizationId: string;
  canEdit: boolean;
}) {
  const contacts = useApi<any[]>(`/organizations/${organizationId}/contacts`),
    client = useQueryClient(),
    toast = useToast();
  const [editing, setEditing] = useState<any>(),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      await api(
        `/organizations/${organizationId}/contacts${editing.id ? `/${editing.id}` : ""}`,
        {
          method: editing.id ? "PATCH" : "POST",
          body: JSON.stringify({
            ...Object.fromEntries(form),
            active: form.has("active"),
            is_primary: form.has("is_primary"),
          }),
        },
      );
      await client.invalidateQueries();
      setEditing(undefined);
      toast("Contact saved.");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="operations-panel">
      <div className="operations-heading">
        <div>
          <h2>Authorized contacts</h2>
          <p>
            Keep the right people connected to procurement, finance and partner
            operations.
          </p>
        </div>
        {canEdit && (
          <Button
            variant="secondary"
            onClick={() => {
              setEditing({});
              setError(undefined);
            }}
          >
            <Plus size={15} />
            Add contact
          </Button>
        )}
      </div>
      {contacts.error ? (
        <ErrorState error={contacts.error} retry={contacts.refetch} />
      ) : contacts.isPending ? (
        <Loading />
      ) : contacts.data?.length ? (
        <div className="contact-grid">
          {contacts.data.map((c) => (
            <article className="contact-card" key={c.id}>
              <span className="contact-icon">
                <UsersRound size={20} />
              </span>
              <div>
                <h3>{c.name}</h3>
                <p>{c.role}</p>
                <a href={`mailto:${c.email}`}>{c.email}</a>
                {c.phone && <a href={`tel:${c.phone}`}>{c.phone}</a>}
                <div className="contact-tags">
                  {c.is_primary && (
                    <Badge status="active">Primary contact</Badge>
                  )}
                  {!c.active && <Badge status="archived">Inactive</Badge>}
                </div>
              </div>
              {canEdit && (
                <button
                  className="icon-button"
                  aria-label={`Edit ${c.name}`}
                  onClick={() => {
                    setEditing(c);
                    setError(undefined);
                  }}
                >
                  <Pencil size={16} />
                </button>
              )}
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="Add your partner contacts"
          description="Contacts organize your company representatives. Invite a person from People & access when they also need a login."
        />
      )}
      {editing && (
        <Modal
          title={editing.id ? "Update contact" : "Add authorized contact"}
          onClose={() => !busy && setEditing(undefined)}
        >
          <form onSubmit={save}>
            <div className="modal-body form-grid">
              <div className="span-2">
                <FormError error={error} />
              </div>
              <Field label="Full name" required>
                <Input
                  name="name"
                  required
                  minLength={2}
                  maxLength={180}
                  defaultValue={editing.name}
                />
              </Field>
              <Field label="Business role" required>
                <Input
                  name="role"
                  required
                  minLength={2}
                  maxLength={120}
                  defaultValue={editing.role}
                  placeholder="e.g. Finance contact"
                />
              </Field>
              <Field label="Work email" required>
                <Input
                  type="email"
                  name="email"
                  required
                  defaultValue={editing.email}
                />
              </Field>
              <Field label="Phone">
                <Input
                  name="phone"
                  type="tel"
                  maxLength={50}
                  defaultValue={editing.phone}
                />
              </Field>
              <label className="checkbox-row">
                <input
                  name="is_primary"
                  type="checkbox"
                  defaultChecked={editing.is_primary}
                />
                Primary company contact
              </label>
              <label className="checkbox-row">
                <input
                  name="active"
                  type="checkbox"
                  defaultChecked={editing.active ?? true}
                />
                Active contact
              </label>
            </div>
            <div className="modal-footer">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setEditing(undefined)}
              >
                Cancel
              </Button>
              <Button busy={busy} type="submit">
                Save contact
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
export function ResourcePools() {
  const { user } = useAuth(),
    client = useQueryClient(),
    toast = useToast();
  const [q, setQ] = useState(""),
    [status, setStatus] = useState(""),
    [page, setPage] = useState(1),
    [editing, setEditing] = useState<any>(),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  const data = useApi<any>(`/resources?${queryString({ q, status, page })}`);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    const form: any = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api(`/resources${editing.id ? `/${editing.id}` : ""}`, {
        method: editing.id ? "PATCH" : "POST",
        body: JSON.stringify({
          ...form,
          experience: Number(form.experience),
          count: Number(form.count),
          rate: Number(form.rate),
          ...(editing.id ? { version: editing.version } : {}),
        }),
      });
      await client.invalidateQueries();
      setEditing(undefined);
      toast("Resource availability saved.");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="CAPACITY & AVAILABILITY"
        title="Resources & bench"
        description="Track skills, capacity, commercial rates and when your team can start."
      >
        {user?.permissions.resources?.includes("create") && (
          <Button
            onClick={() => {
              setEditing({});
              setError(undefined);
            }}
          >
            <Plus size={16} />
            Add resource pool
          </Button>
        )}
      </PageHeader>
      <div className="card">
        <div className="table-filters">
          <SearchInput
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(1);
            }}
            placeholder="Search roles, skills or locations…"
          />
          <select
            aria-label="Resource availability"
            className="compact-select"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All availability</option>
            {["available", "reserved", "deployed", "archived"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        {data.error ? (
          <ErrorState error={data.error} retry={data.refetch} />
        ) : data.isPending ? (
          <Loading />
        ) : data.data.items.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Resource pool</th>
                  <th>Capacity</th>
                  <th>Available from</th>
                  <th>Rate</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.data.items.map((r: any) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.title}</strong>
                      <small className="table-subtext">
                        {r.skills} · {r.location}
                        {user?.internal ? ` · ${r.organization_name}` : ""}
                      </small>
                    </td>
                    <td>
                      {r.count} people
                      <br />
                      <small>{r.experience} years experience</small>
                    </td>
                    <td>{formatDate(r.available_from)}</td>
                    <td>
                      {money(r.rate_minor, r.currency)} / {r.rate_unit}
                    </td>
                    <td>
                      <Badge status={r.status} />
                    </td>
                    <td>
                      {user?.permissions.resources?.includes("edit") && (
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setEditing(r);
                            setError(undefined);
                          }}
                        >
                          <Pencil size={15} />
                          Update
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="Bring your available expertise into view"
            description="Add a role or skill group, available headcount and rate. Keep personal employee data out of shared resource descriptions."
          />
        )}
        <Pagination
          page={page}
          total={data.data?.total || 0}
          onChange={setPage}
        />
      </div>
      {editing && (
        <Modal
          title={editing.id ? "Update resource pool" : "New resource pool"}
          wide
          onClose={() => !busy && setEditing(undefined)}
        >
          <form onSubmit={save}>
            <div className="modal-body form-grid">
              <div className="span-2">
                <FormError error={error} />
              </div>
              {[
                ["title", "Role / resource pool", "text"],
                ["skills", "Skills", "text"],
                ["location", "Location", "text"],
                ["experience", "Experience (years)", "number"],
                ["count", "Available headcount", "number"],
                ["available_from", "Available from", "date"],
                ["rate", "Commercial rate", "number"],
              ].map(([key, name, type]) => (
                <Field key={key} label={name} required>
                  <Input
                    name={key}
                    type={type}
                    required
                    defaultValue={
                      editing[key] ??
                      (key === "count"
                        ? 1
                        : key === "experience" || key === "rate"
                          ? 0
                          : "")
                    }
                    min={
                      key === "count" ? 1 : type === "number" ? 0 : undefined
                    }
                    step={
                      key === "rate"
                        ? "0.01"
                        : key === "experience"
                          ? "0.1"
                          : undefined
                    }
                  />
                </Field>
              ))}
              <Field label="Currency">
                <select
                  className="input"
                  name="currency"
                  defaultValue={editing.currency || "INR"}
                >
                  {["INR", "USD", "EUR", "GBP"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Field label="Rate period">
                <select
                  className="input"
                  name="rate_unit"
                  defaultValue={editing.rate_unit || "month"}
                >
                  {["hour", "day", "month"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="Availability">
                <select
                  className="input"
                  name="status"
                  defaultValue={editing.status || "available"}
                >
                  {["available", "reserved", "deployed", "archived"].map(
                    (s) => (
                      <option key={s}>{s}</option>
                    ),
                  )}
                </select>
              </Field>
              <Field label="Business notes" className="span-2">
                <textarea
                  className="input"
                  name="notes"
                  maxLength={3000}
                  defaultValue={editing.notes}
                />
              </Field>
            </div>
            <div className="modal-footer">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setEditing(undefined)}
              >
                Cancel
              </Button>
              <Button busy={busy} type="submit">
                Save availability
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
export function ImportModal({
  kind,
  onClose,
}: {
  kind: "catalog" | "requirements" | "candidates";
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [file, setFile] = useState<File>(),
    [preview, setPreview] = useState<any>(),
    [result, setResult] = useState<any>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  async function validate() {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      if (file.size > 1000000)
        throw new Error("Choose a UTF-8 CSV smaller than 1 MB.");
      setPreview(
        await api(`/imports/${kind}/preview`, {
          method: "POST",
          body: JSON.stringify({ content: await file.text() }),
        }),
      );
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    setBusy(true);
    setError(undefined);
    try {
      setResult(
        await api(`/imports/${preview.id}/commit`, {
          method: "POST",
          body: "{}",
        }),
      );
      await client.invalidateQueries();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`Import ${kind === "catalog" ? "catalog items" : kind}`}
      description="Validate every row before adding records to your organization."
      wide
      onClose={() => !busy && onClose()}
    >
      <div className="modal-body form-stack">
        <FormError error={error} />
        {result ? (
          <>
            <div className="import-success">
              <CheckCircle2 size={34} />
              <h2>{result.records.length} records imported</h2>
              <p>
                All rows were saved together. Open a record to review its
                details.
              </p>
            </div>
            <div className="import-results">
              {result.records.map((r: any) => (
                <Link key={r.id} to={r.href} onClick={onClose}>
                  {r.number} · {r.title}
                </Link>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="info-banner">
              <Upload size={22} />
              <div>
                <strong>Use the CSV template</strong>
                <p>
                  Up to 500 rows per import. Duplicate identifiers and invalid
                  relationships must be corrected before import. Existing
                  records are preserved.
                </p>
              </div>
            </div>
            <a className="text-link" href={`/api/imports/${kind}/template`}>
              <Download size={16} />
              Download blank template
            </a>
            <Field label="CSV file" required>
              <Input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  setFile(e.target.files?.[0]);
                  setPreview(undefined);
                }}
              />
            </Field>
            {preview && (
              <>
                <div className="operations-heading">
                  <strong>
                    {preview.results.filter((r: any) => r.valid).length} of{" "}
                    {preview.count} rows valid
                  </strong>
                  <Badge
                    status={
                      preview.status === "ready" ? "approved" : "rejected"
                    }
                  >
                    {preview.status === "ready"
                      ? "Ready to import"
                      : "Corrections required"}
                  </Badge>
                </div>
                <div className="table-scroll import-preview">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>CSV row</th>
                        <th>Record title</th>
                        <th>Validation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.results.map((r: any) => (
                        <tr key={r.row}>
                          <td>{r.row}</td>
                          <td>{r.title}</td>
                          <td>{r.valid ? "Valid" : r.error}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p>
                  Preview expires after 30 minutes. Relationships and
                  permissions are checked again when you import.
                </p>
              </>
            )}
          </>
        )}
      </div>
      <div className="modal-footer">
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={onClose}
        >
          {result ? "Done" : "Cancel"}
        </Button>
        {!result &&
          (preview?.status === "ready" ? (
            <Button busy={busy} onClick={commit}>
              Import {preview.count} records
            </Button>
          ) : (
            <Button busy={busy} disabled={!file} onClick={validate}>
              Validate CSV
            </Button>
          ))}
      </div>
    </Modal>
  );
}
