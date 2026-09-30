import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Plus, ShieldCheck, Trash2 } from "lucide-react";
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
import { formatDate, money } from "../lib/format";
import {
  moduleDefinitions,
  roleLabels,
  type Module,
  type WorkRecord,
} from "../../shared/domain";

export function ApprovalTrail({ record }: { record: WorkRecord }) {
  const result = useApi<any>(`/approvals/records/${record.id}`);
  if (result.error) return <FormError error={result.error} />;
  if (!result.data?.policy && !result.data?.cycles.length) return null;
  const request = result.data.cycles[0],
    steps = request?.steps || result.data.policy.steps;
  return (
    <div className="card approval-trail">
      <div className="operations-heading">
        <h3>
          <ShieldCheck size={17} /> Approval path
        </h3>
        {request && <Badge status={request.status} />}
      </div>
      <p>{result.data.policy?.name || "Configured approval chain"}</p>
      <ol>
        {steps.map((step: any, index: number) => {
          const decision = request?.decisions.find(
            (d: any) => d.step === index,
          );
          return (
            <li key={index} className={decision ? "complete" : ""}>
              <span>{decision ? <Check size={14} /> : index + 1}</span>
              <div>
                <strong>{step.name}</strong>
                <small>
                  {decision
                    ? `${decision.approver_name} · ${formatDate(decision.created_at)}`
                    : step.roles
                        .map((r: string) => roleLabels[r] || r)
                        .join(" / ")}
                </small>
                {decision && <p>{decision.remarks}</p>}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="small-note">
        Each step requires a different reviewer. The record creator cannot
        approve their own request.
      </p>
      {result.data.cycles.length > 1 && (
        <details>
          <summary>Previous approval cycles</summary>
          {result.data.cycles.slice(1).map((c: any) => (
            <p key={c.id}>
              Cycle {c.cycle} · {c.status} · {c.decisions.length} decisions
            </p>
          ))}
        </details>
      )}
    </div>
  );
}
export default function Approvals() {
  const { user } = useAuth(),
    client = useQueryClient(),
    toast = useToast();
  const result = useApi<any>("/approvals/policies"),
    queue = useApi<any[]>("/approvals/queue");
  const [editing, setEditing] = useState<any>(),
    [steps, setSteps] = useState<{ name: string; roles: string[] }[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const manage =
    user?.permissions.approvals?.includes("manage") &&
    (user.internal || user.organization?.type === "client");
  function edit(value: any) {
    setEditing({ ...value, kind: value.kind || "orders" });
    setSteps(
      value.steps || [
        {
          name: "Commercial review",
          roles: [user?.internal ? "procurement" : "org_procurement"],
        },
      ],
    );
    setError(undefined);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(undefined);
    try {
      await api(`/approvals/policies${editing.id ? `/${editing.id}` : ""}`, {
        method: editing.id ? "PATCH" : "POST",
        body: JSON.stringify({
          name: form.get("name"),
          kind: form.get("kind"),
          currency: form.get("currency"),
          minimum: Number(form.get("minimum")),
          enabled: form.has("enabled"),
          organization_id: editing.organization_id || undefined,
          steps,
        }),
      });
      await client.invalidateQueries();
      setEditing(undefined);
      toast("Approval policy saved. Open requests keep their original steps.");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  if (result.isPending) return <Loading />;
  if (result.error)
    return <ErrorState error={result.error} retry={result.refetch} />;
  return (
    <>
      <PageHeader
        eyebrow="DECISIONS & ACCOUNTABILITY"
        title="Approvals"
        description="Route commercial decisions through the right people, with a complete decision trail."
      >
        {manage && (
          <Button onClick={() => edit({})}>
            <Plus size={16} />
            Create approval policy
          </Button>
        )}
      </PageHeader>
      <div className="card operations-panel">
        <div className="operations-heading">
          <div>
            <h2>Pending approval chains</h2>
            <p>Open records awaiting one or more configured reviewers.</p>
          </div>
        </div>
        {queue.error ? (
          <FormError error={queue.error} />
        ) : queue.data?.length ? (
          <div className="approval-queue">
            {queue.data.map((r) => (
              <Link key={r.id} to={`/app/${r.kind}/${r.id}`}>
                <div>
                  <strong>
                    {r.number} · {r.title}
                  </strong>
                  <p>
                    {r.next_step} · {r.completed_steps}/{r.total_steps}{" "}
                    completed
                  </p>
                </div>
                <Badge status="pending" />
                <ArrowRight size={17} />
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No open approval chains"
            description="Records appear here when a configured approval path is started."
          />
        )}
      </div>
      <div className="card space-top">
        <div className="operations-heading operations-panel">
          <div>
            <h2>Approval policies</h2>
            <p>
              A buyer-specific policy takes precedence over platform defaults.
              The highest matching amount threshold applies.
            </p>
          </div>
        </div>
        {result.data.policies.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Policy</th>
                  <th>Module</th>
                  <th>Minimum value</th>
                  <th>Steps</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.data.policies.map((p: any) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.name}</strong>
                      <small className="table-subtext">
                        {p.organization_id
                          ? "Buyer organization policy"
                          : "Platform default"}
                      </small>
                    </td>
                    <td>{moduleDefinitions[p.kind as Module].label}</td>
                    <td>{money(p.minimum_minor, p.currency)}</td>
                    <td>{p.steps.map((s: any) => s.name).join(" → ")}</td>
                    <td>
                      <Badge status={p.enabled ? "active" : "archived"} />
                    </td>
                    <td>
                      {manage &&
                        (user?.internal ||
                          p.organization_id === user?.organization_id) && (
                          <Button variant="ghost" onClick={() => edit(p)}>
                            Edit
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
            title="Define your approval path"
            description="Set sequential reviewers for quotation, order, contract, invoice or payment approvals. The existing high-value order review rule remains in effect."
          />
        )}
      </div>
      {editing && (
        <Modal
          title={editing.id ? "Edit approval policy" : "New approval policy"}
          wide
          onClose={() => !busy && setEditing(undefined)}
        >
          <form onSubmit={save}>
            <div className="modal-body form-stack">
              <FormError error={error} />
              <div className="form-grid">
                <Field label="Policy name" required>
                  <Input
                    name="name"
                    minLength={3}
                    required
                    defaultValue={editing.name}
                  />
                </Field>
                <Field label="Transaction module">
                  <select
                    name="kind"
                    className="input"
                    value={editing.kind}
                    onChange={(event) => {
                      const kind = event.target.value;
                      setEditing({ ...editing, kind });
                      setSteps((items) =>
                        items.map((step) => ({
                          ...step,
                          roles: step.roles.filter((role) =>
                            result.data.roles.some(
                              (candidate: any) =>
                                candidate.id === role &&
                                candidate.reviewModules.includes(kind),
                            ),
                          ),
                        })),
                      );
                    }}
                  >
                    {[
                      "quotations",
                      "orders",
                      "contracts",
                      "invoices",
                      "payments",
                    ].map((k) => (
                      <option key={k} value={k}>
                        {moduleDefinitions[k as Module].label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Minimum transaction value">
                  <Input
                    name="minimum"
                    type="number"
                    min={0}
                    step="0.01"
                    required
                    defaultValue={editing.minimum || 0}
                  />
                </Field>
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
              </div>
              <h3>Sequential review steps</h3>
              {steps.map((step, index) => (
                <div className="approval-step-form" key={index}>
                  <Field label={`Step ${index + 1} name`} required>
                    <Input
                      value={step.name}
                      required
                      minLength={3}
                      onChange={(e) =>
                        setSteps((items) =>
                          items.map((s, i) =>
                            i === index ? { ...s, name: e.target.value } : s,
                          ),
                        )
                      }
                    />
                  </Field>
                  <fieldset className="role-checks">
                    <legend>Authorized reviewer roles</legend>
                    {result.data.roles
                      .filter(
                        (r: any) =>
                          (user?.internal || !r.internal) &&
                          r.reviewModules.includes(editing.kind),
                      )
                      .map((role: any) => (
                        <label key={role.id}>
                          <input
                            type="checkbox"
                            checked={step.roles.includes(role.id)}
                            onChange={(e) =>
                              setSteps((items) =>
                                items.map((s, i) =>
                                  i === index
                                    ? {
                                        ...s,
                                        roles: e.target.checked
                                          ? [...s.roles, role.id]
                                          : s.roles.filter(
                                              (r) => r !== role.id,
                                            ),
                                      }
                                    : s,
                                ),
                              )
                            }
                          />
                          {roleLabels[role.id] || role.name}
                        </label>
                      ))}
                  </fieldset>
                  {steps.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        setSteps((items) => items.filter((_, i) => i !== index))
                      }
                    >
                      <Trash2 size={15} />
                      Remove step {index + 1}
                    </Button>
                  )}
                </div>
              ))}
              {steps.length < 5 && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    setSteps((items) => [...items, { name: "", roles: [] }])
                  }
                >
                  <Plus size={15} />
                  Add approval step
                </Button>
              )}
              <label className="checkbox-row">
                <input
                  name="enabled"
                  type="checkbox"
                  defaultChecked={editing.enabled ?? true}
                />
                Apply this policy to new approval chains
              </label>
              <p>
                Reviewers need review permission for the selected module. Each
                step must be completed by a different person, separate from the
                record creator.
              </p>
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
              <Button type="submit" busy={busy}>
                Save policy
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
