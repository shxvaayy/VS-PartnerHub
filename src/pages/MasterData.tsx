import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, ShieldCheck } from "lucide-react";
import { api, useApi } from "../lib/api";
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
  useToast,
} from "../components/ui";
import {
  organizationLabels,
  organizationTypes,
  type OrganizationType,
} from "../../shared/domain";

const names: Record<string, string> = {
  category: "Business categories",
  industry: "Industries",
  unit: "Units of measure",
  document: "Document categories",
  certification: "Certifications",
  policies: "Document policies",
};
export default function MasterData() {
  const { user } = useAuth(),
    client = useQueryClient(),
    toast = useToast();
  const [kind, setKind] = useState("category"),
    [editing, setEditing] = useState<any>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const data = useApi<any>("/master-data?all=true"),
    policies = useApi<any[]>("/master-data/document-policies"),
    settings = useApi<any>("/admin/settings");
  if (!user?.permissions["master-data"]?.includes("view"))
    return (
      <EmptyState
        title="Configuration access required"
        description="Your administrator manages shared values and compliance policies."
      />
    );
  if (data.isPending) return <Loading />;
  if (data.error) return <ErrorState error={data.error} retry={data.refetch} />;
  const entries =
    kind === "policies" ? policies.data || [] : data.data[kind] || [];
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    const form = new FormData(event.currentTarget),
      values = Object.fromEntries(form);
    try {
      if (kind === "policies")
        await api("/master-data/document-policies", {
          method: "PUT",
          body: JSON.stringify({
            category: values.category,
            organization_type: values.organization_type,
            required: form.has("required"),
            expiry_required: form.has("expiry_required"),
            reminder_days: String(values.reminder_days)
              .split(",")
              .map((v) => Number(v.trim())),
          }),
        });
      else
        await api(`/master-data${editing?.id ? `/${editing.id}` : ""}`, {
          method: editing?.id ? "PATCH" : "POST",
          body: JSON.stringify({
            kind,
            label: values.label,
            active: form.has("active"),
            position: Number(values.position),
          }),
        });
      await client.invalidateQueries();
      setEditing(undefined);
      toast("Configuration saved.");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="PLATFORM CONFIGURATION"
        title="Shared business definitions"
        description="Keep onboarding, catalogs, discovery and compliance consistent across your network."
      >
        <Button
          onClick={() => {
            setEditing({});
            setError(undefined);
          }}
        >
          <Plus size={16} />
          {kind === "policies" ? "Add document policy" : "Add value"}
        </Button>
      </PageHeader>
      <div className="card">
        <div className="detail-tabs">
          {Object.entries(names).map(([key, name]) => (
            <button
              key={key}
              className={key === kind ? "active" : ""}
              onClick={() => setKind(key)}
            >
              {name}
            </button>
          ))}
        </div>
        {kind === "policies" && (
          <div className="info-banner">
            <ShieldCheck size={22} />
            <div>
              <strong>Rules follow organization type</strong>
              <p>
                Default required documents:{" "}
                {(settings.data?.requiredDocuments || []).join(", ")}.
                Type-specific policies override the matching default. Expiry
                dates and reminders are enforced when documents are uploaded and
                reviewed.
              </p>
            </div>
          </div>
        )}
        {entries.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{kind === "policies" ? "Document" : "Value"}</th>
                  <th>{kind === "policies" ? "Organization type" : "Order"}</th>
                  <th>
                    {kind === "policies" ? "Required / expiry" : "Status"}
                  </th>
                  {kind === "policies" && <th>Reminders before expiry</th>}
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry: any) => (
                  <tr key={entry.id}>
                    <td>
                      <strong>{entry.label || entry.category}</strong>
                    </td>
                    <td>
                      {kind === "policies"
                        ? entry.organization_type === "all"
                          ? "All organization types"
                          : organizationLabels[
                              entry.organization_type as OrganizationType
                            ]
                        : entry.position}
                    </td>
                    <td>
                      {kind === "policies" ? (
                        `${entry.required ? "Required" : "Optional"} · ${entry.expiry_required ? "Expiry mandatory" : "Expiry optional"}`
                      ) : (
                        <Badge status={entry.active ? "active" : "archived"} />
                      )}
                    </td>
                    {kind === "policies" && (
                      <td>{entry.reminder_days.join(", ")} days</td>
                    )}
                    <td>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setEditing(entry);
                          setError(undefined);
                        }}
                        aria-label={`Edit ${entry.label || entry.category}`}
                      >
                        <Pencil size={15} />
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={
              kind === "policies"
                ? "Default compliance rules are in use"
                : "No values in this list"
            }
            description={
              kind === "policies"
                ? "Add a policy to tailor requirements and expiry reminders by document and organization type."
                : "Add a value to make it available in your workspace forms."
            }
          />
        )}
      </div>
      {editing && (
        <Modal
          title={
            kind === "policies"
              ? "Document policy"
              : `${editing.id ? "Edit" : "Add"} ${names[kind].toLowerCase()}`
          }
          onClose={() => !busy && setEditing(undefined)}
        >
          <form onSubmit={save}>
            <div className="modal-body form-stack">
              <FormError error={error} />
              {kind === "policies" ? (
                <>
                  <Field label="Document category" required>
                    <select
                      className="input"
                      name="category"
                      defaultValue={editing.category || "PAN"}
                      required
                    >
                      {data.data.document
                        ?.filter((d: any) => d.active)
                        .map((d: any) => (
                          <option key={d.id}>{d.label}</option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Organization type" required>
                    <select
                      className="input"
                      name="organization_type"
                      defaultValue={editing.organization_type || "all"}
                    >
                      <option value="all">All organization types</option>
                      {organizationTypes.map((t) => (
                        <option key={t} value={t}>
                          {organizationLabels[t]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <label className="checkbox-row">
                    <input
                      name="required"
                      type="checkbox"
                      defaultChecked={editing.required}
                    />
                    Required before company approval
                  </label>
                  <label className="checkbox-row">
                    <input
                      name="expiry_required"
                      type="checkbox"
                      defaultChecked={editing.expiry_required}
                    />
                    An expiry date must be provided
                  </label>
                  <Field
                    label="Reminder days before expiry"
                    required
                    hint="Comma-separated days, for example 90, 60, 30, 7."
                  >
                    <Input
                      name="reminder_days"
                      defaultValue={(
                        editing.reminder_days || [90, 60, 30]
                      ).join(", ")}
                      required
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="Value" required>
                    <Input
                      name="label"
                      defaultValue={editing.label}
                      required
                      maxLength={100}
                      readOnly={kind === "document" && Boolean(editing.id)}
                    />
                  </Field>
                  <Field label="Display order">
                    <Input
                      name="position"
                      type="number"
                      min={0}
                      max={10000}
                      defaultValue={editing.position || 0}
                    />
                  </Field>
                  <label className="checkbox-row">
                    <input
                      name="active"
                      type="checkbox"
                      defaultChecked={editing.active ?? true}
                    />
                    Available for new records
                  </label>
                </>
              )}
            </div>
            <div className="modal-footer">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEditing(undefined)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button type="submit" busy={busy}>
                Save configuration
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
