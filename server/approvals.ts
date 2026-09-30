import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, now, parseJson, type Database } from "./db.js";
import { authenticated, assertActive, can, permit } from "./security.js";
import { assert } from "./errors.js";
import { audit, notifyUsers } from "./events.js";
import { accessibleRecord, isBuyer, scopeRecords } from "./record-service.js";
import { uuid } from "./validation.js";
import type { SessionUser, WorkRecord } from "../shared/domain.js";

const kinds = [
  "quotations",
  "orders",
  "contracts",
  "invoices",
  "payments",
] as const;
interface ApprovalStep {
  name: string;
  roles: string[];
}
const policySchema = z.object({
  name: z.string().trim().min(3).max(180),
  kind: z.enum(kinds),
  currency: z.enum(["INR", "USD", "EUR", "GBP"]),
  minimum: z.number().min(0).max(1e10),
  enabled: z.boolean(),
  organization_id: uuid.nullable().optional(),
  steps: z
    .array(
      z.object({
        name: z.string().trim().min(3).max(100),
        roles: z.array(z.string().min(1).max(50)).min(1).max(10),
      }),
    )
    .min(1)
    .max(5),
});
async function applicablePolicy(record: WorkRecord, k: Database) {
  const matches = await k("approval_policies")
    .where({ kind: record.kind, currency: record.currency, enabled: true })
    .where("minimum_minor", "<=", record.amount_minor)
    .where((q) =>
      q
        .whereNull("organization_id")
        .orWhere("organization_id", record.buyer_org_id),
    );
  return matches.sort(
    (a, b) =>
      Number(Boolean(b.organization_id)) - Number(Boolean(a.organization_id)) ||
      Number(b.minimum_minor) - Number(a.minimum_minor) ||
      b.created_at.localeCompare(a.created_at),
  )[0];
}
async function notifyStep(
  k: Database,
  request: any,
  record: WorkRecord,
  step: number,
) {
  const steps = parseJson<ApprovalStep[]>(request.steps, []);
  if (!steps[step]) return;
  const approvers = await k("users")
    .join("roles", "roles.id", "users.role")
    .where("users.active", true)
    .whereNot("users.id", request.requested_by)
    .whereIn("users.role", steps[step].roles)
    .where((q) =>
      q
        .where("roles.internal", true)
        .orWhere("users.organization_id", record.buyer_org_id),
    )
    .select("users.id");
  await notifyUsers(
    k,
    approvers.map((u) => u.id),
    "Approval awaiting your review",
    `${record.number} · ${steps[step].name}`,
    `/app/${record.kind}/${record.id}`,
    record.kind,
    `approval:${request.id}:${step}`,
  );
}
async function ensureRequest(k: Database, record: WorkRecord) {
  let request = await k("approval_requests")
    .where({ record_id: record.id, status: "pending" })
    .orderBy("cycle", "desc")
    .first();
  if (!request) {
    const policy = await applicablePolicy(record, k);
    if (!policy) return null;
    const previous = await k("approval_requests")
      .where({ record_id: record.id })
      .max({ cycle: "cycle" })
      .first();
    const raw = await k("records").where({ id: record.id }).first();
    request = {
      id: randomUUID(),
      record_id: record.id,
      policy_id: policy.id,
      cycle: Number(previous?.cycle || 0) + 1,
      steps: policy.steps,
      status: "pending",
      requested_by: raw.created_by,
      created_at: now(),
      updated_at: now(),
    };
    await k("approval_requests").insert(request);
    await notifyStep(k, request, record, 0);
  }
  return request;
}
export async function startApproval(k: Database, record: WorkRecord) {
  const stages: Record<string, string[]> = {
    quotations: ["submitted", "under_review"],
    orders: ["pending_approval"],
    contracts: ["review"],
    invoices: ["submitted", "under_review"],
    payments: ["pending", "processing"],
  };
  if (stages[record.kind]?.includes(record.status))
    await ensureRequest(k, record);
}

/** Records one approval in the frozen chain. The caller holds the record lock. */
export async function approvalGate(
  k: Database,
  user: SessionUser,
  record: WorkRecord,
  target: string,
  note: string,
) {
  if (!(
    (target === "approved" && kinds.includes(record.kind as any)) ||
    (target === "completed" && record.kind === "payments")
  )) {
    if (["draft", "rejected", "clarification", "failed"].includes(target))
      await k("approval_requests")
        .where({ record_id: record.id, status: "pending" })
        .update({ status: "cancelled", updated_at: now() });
    return true;
  }
  const request = await ensureRequest(k, record);
  if (!request) return true;
  const decisions = await k("approval_decisions")
    .where({ request_id: request.id })
    .orderBy("step");
  const steps = parseJson<ApprovalStep[]>(request.steps, []),
    step = steps[decisions.length];
  assert(
    step &&
      step.roles.includes(user.role) &&
      isBuyer(user, record) &&
      can(user, record.kind, "review"),
    403,
    `This approval is waiting for ${step?.name || "the designated approver"}.`,
  );
  assert(
    user.id !== request.requested_by &&
      !decisions.some((d) => d.user_id === user.id),
    422,
    "Each approval step requires a different authorized person, separate from the record creator.",
  );
  assert(
    note.trim().length >= 3,
    422,
    "Add your approval remarks for the decision trail.",
  );
  await k("approval_decisions").insert({
    id: randomUUID(),
    request_id: request.id,
    step: decisions.length,
    user_id: user.id,
    remarks: note,
    created_at: now(),
  });
  const complete = decisions.length + 1 === steps.length;
  await k("approval_requests")
    .where({ id: request.id })
    .update({ status: complete ? "approved" : "pending", updated_at: now() });
  await audit(
    k,
    user,
    "approval_step_completed",
    record.kind,
    record,
    record.status,
    `${step.name}: ${note}`,
  );
  if (!complete) {
    const changed = await k("records")
      .where({ id: record.id, version: record.version })
      .update({ version: record.version + 1, updated_at: now() });
    assert(
      changed,
      409,
      "Another person updated this record. Refresh before continuing.",
    );
    await notifyStep(k, request, record, decisions.length + 1);
  }
  return complete;
}
export async function approvalProgress(
  record: WorkRecord,
  user: SessionUser,
  k: Database = db,
) {
  const requests = await k("approval_requests")
    .where({ record_id: record.id })
    .orderBy("cycle", "desc");
  const cycles = [];
  for (const request of requests) {
    const decisions = await k("approval_decisions")
      .join("users", "users.id", "approval_decisions.user_id")
      .where("request_id", request.id)
      .select("approval_decisions.*", "users.name as approver_name")
      .orderBy("step");
    const steps = parseJson<ApprovalStep[]>(request.steps, []);
    const next = steps[decisions.length];
    cycles.push({
      ...request,
      steps,
      decisions,
      can_approve:
        request.status === "pending" &&
        Boolean(next?.roles.includes(user.role)) &&
        isBuyer(user, record) &&
        can(user, record.kind, "review") &&
        request.requested_by !== user.id &&
        !decisions.some((d) => d.user_id === user.id),
    });
  }
  const policy = await applicablePolicy(record, k);
  return {
    cycles,
    policy: policy
      ? {
          id: policy.id,
          name: policy.name,
          steps: parseJson(policy.steps, []),
          minimum: Number(policy.minimum_minor) / 100,
          currency: policy.currency,
        }
      : null,
  };
}
export const approvalsRouter = Router();
approvalsRouter.use(authenticated);
approvalsRouter.get("/queue", permit("approvals"), async (req, res) => {
  const records = await scopeRecords(
    db("records")
      .join("approval_requests", "approval_requests.record_id", "records.id")
      .where("approval_requests.status", "pending"),
    req.user,
  )
    .select(
      "records.*",
      "approval_requests.id as request_id",
      "approval_requests.steps",
    )
    .orderBy("approval_requests.created_at")
    .limit(100);
  const items = [];
  for (const record of records) {
    if (!can(req.user, record.kind)) continue;
    const count = await db("approval_decisions")
      .where({ request_id: record.request_id })
      .count({ n: "*" })
      .first();
    const steps = parseJson<ApprovalStep[]>(record.steps, []),
      completed = Number(count?.n || 0);
    items.push({
      id: record.id,
      kind: record.kind,
      number: record.number,
      title: record.title,
      next_step: steps[completed]?.name,
      completed_steps: completed,
      total_steps: steps.length,
    });
  }
  res.json(items);
});
approvalsRouter.get("/records/:id", async (req, res) => {
  const record = await accessibleRecord(uuid.parse(req.params.id), req.user);
  res.json(await approvalProgress(record, req.user));
});
approvalsRouter.get("/policies", permit("approvals"), async (req, res) => {
  const q = db("approval_policies");
  if (!req.user.internal)
    q.where((b) =>
      b
        .whereNull("organization_id")
        .orWhere("organization_id", req.user.organization_id),
    );
  const policies = await q.orderBy("kind").orderBy("minimum_minor", "desc");
  res.json({
    policies: policies.map((p) => ({
      ...p,
      steps: parseJson(p.steps, []),
      minimum: Number(p.minimum_minor) / 100,
      enabled: Boolean(p.enabled),
    })),
    roles: (
      await db("roles").select("id", "name", "internal", "permissions")
    ).map((role) => ({
      id: role.id,
      name: role.name,
      internal: Boolean(role.internal),
      reviewModules: Object.entries(parseJson(role.permissions))
        .filter(
          ([, actions]) => Array.isArray(actions) && actions.includes("review"),
        )
        .map(([module]) => module),
    })),
  });
});
async function savePolicy(user: SessionUser, body: unknown, id?: string) {
  assertActive(user);
  assert(
    user.role === "super_admin" ||
      (user.role === "org_admin" && user.organization?.type === "client"),
    403,
    "Only a buyer administrator or Super Admin can configure approval policies.",
  );
  const input = policySchema.parse(body),
    orgId = user.internal
      ? input.organization_id || null
      : user.organization_id;
  if (input.organization_id && !user.internal)
    assert(
      input.organization_id === user.organization_id,
      403,
      "Policies are scoped to your buying organization.",
    );
  if (orgId)
    assert(
      await db("organizations").where({ id: orgId, type: "client" }).first(),
      422,
      "Choose a buyer organization for this policy.",
    );
  const roles = await db("roles").whereIn(
    "id",
    input.steps.flatMap((s) => s.roles),
  );
  for (const step of input.steps)
    for (const role of step.roles)
      assert(
        roles.some(
          (r) =>
            r.id === role &&
            parseJson(r.permissions)[input.kind]?.includes("review"),
        ),
        422,
        `Role ${role} must have review permission for ${input.kind}.`,
      );
  const policyId = id || randomUUID();
  await db.transaction(async (k) => {
    if (id) {
      const existing = await k("approval_policies").where({ id }).first();
      assert(
        existing &&
          (user.internal || existing.organization_id === user.organization_id),
        404,
        "Approval policy not found.",
      );
    }
    const value = {
      name: input.name,
      kind: input.kind,
      currency: input.currency,
      minimum_minor: Math.round(input.minimum * 100),
      enabled: input.enabled,
      organization_id: orgId,
      steps: JSON.stringify(input.steps),
      updated_at: now(),
    };
    if (id) await k("approval_policies").where({ id }).update(value);
    else
      await k("approval_policies").insert({
        id: policyId,
        ...value,
        created_at: now(),
      });
    await audit(
      k,
      user,
      id ? "approval_policy_updated" : "approval_policy_created",
      "approvals",
      { id: policyId },
      input.enabled ? "active" : "inactive",
      input.name,
    );
  });
  return { id: policyId };
}
approvalsRouter.post(
  "/policies",
  permit("approvals", "manage"),
  async (req, res) =>
    res.status(201).json(await savePolicy(req.user, req.body)),
);
approvalsRouter.patch(
  "/policies/:id",
  permit("approvals", "manage"),
  async (req, res) =>
    res.json(await savePolicy(req.user, req.body, uuid.parse(req.params.id))),
);
