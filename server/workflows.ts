import { db, now, parseJson, type Database } from "./db.js";
import { assert } from "./errors.js";
import { assertActive } from "./security.js";
import { audit, notifyOrganizations } from "./events.js";
import { approvalGate, startApproval } from "./approvals.js";
import { signaturesAllowActivation } from "./signatures.js";
import {
  accessibleRecord,
  allowedTransitions,
  getItems,
  isBuyer,
  recordDetail,
  serializeRecord,
  snapshot,
} from "./record-service.js";
import {
  moduleDefinitions,
  type SessionUser,
  type WorkRecord,
} from "../shared/domain.js";

async function updateStatus(
  k: Database,
  user: SessionUser,
  record: WorkRecord,
  status: string,
  note: string,
) {
  const changed = await k("records")
    .where({ id: record.id, version: record.version })
    .update({ status, version: record.version + 1, updated_at: now() });
  assert(
    changed,
    409,
    "Someone updated this record. Refresh before continuing.",
  );
  await audit(k, user, "status_changed", record.kind, record, status, note);
}
export async function transitionRecord(
  user: SessionUser,
  id: string,
  target: string,
  version: number,
  note: string,
) {
  return db.transaction(async (k) => {
    let lock = k("records").where({ id });
    if (db.client.config.client === "pg") lock = lock.forUpdate();
    await lock.first();
    const record = await accessibleRecord(id, user, k);
    if (record.kind !== "tickets") assertActive(user);
    assert(
      record.version === version,
      409,
      "Someone updated this record. Refresh before continuing.",
    );
    assert(
      allowedTransitions(user, record).includes(target),
      403,
      "Your role cannot make this status change at this stage.",
    );
    if (
      [
        "rejected",
        "clarification",
        "terminated",
        "revision",
        "failed",
        "cancelled",
      ].includes(target)
    )
      assert(
        note.trim().length >= 5,
        422,
        "Add a short reason for this decision.",
      );
    if (record.parent_id) {
      let parentLock = k("records").where({ id: record.parent_id });
      if (db.client.config.client === "pg") parentLock = parentLock.forUpdate();
      await parentLock.first();
    }
    const parent = record.parent_id
      ? serializeRecord(
          await k("records").where({ id: record.parent_id }).first(),
        )
      : null;
    const today = now().slice(0, 10);
    if (record.kind === "contracts" && target === "active")
      await signaturesAllowActivation(record, k);
    const effects: (() => Promise<void>)[] = [];
    if (record.kind === "rfqs" && target === "published") {
      assert(
        record.payload.deadline >= today,
        422,
        "Set a response deadline that has not passed.",
      );
      assert(
        (await getItems(id, k)).length > 0,
        422,
        "Add at least one RFQ line item.",
      );
      assert(
        await k("record_invitations").where({ record_id: id }).first(),
        422,
        "Invite at least one verified partner before publishing.",
      );
    }
    if (
      record.kind === "requirements" &&
      target === "open" &&
      record.payload.requirement_type === "hiring"
    )
      assert(
        await k("record_invitations").where({ record_id: id }).first(),
        422,
        "Assign at least one recruitment or staffing partner.",
      );
    if (record.kind === "quotations") {
      assert(
        parent && ["published", "evaluation"].includes(parent.status),
        422,
        "The RFQ is no longer accepting quotation decisions.",
      );
      if (target === "submitted")
        assert(
          (record.status === "clarification" ||
            parent.payload.deadline >= today) &&
            record.payload.validity >= today,
          422,
          "The quotation or RFQ deadline has passed.",
        );
      if (target === "approved") {
        assert(
          record.payload.validity >= today,
          422,
          "This quotation has expired. Request a revision.",
        );
        assert(
          record.amount_minor > 0,
          422,
          "A quotation must have a positive total before approval.",
        );
        assert(
          !(await k("records")
            .where({
              kind: "quotations",
              parent_id: record.parent_id,
              status: "approved",
            })
            .first()),
          409,
          "This RFQ already has an approved quotation.",
        );
        effects.push(async () => {
          await updateStatus(
            k,
            user,
            parent,
            "awarded",
            `Awarded to ${record.number}. ${note}`,
          );
          const alternatives = await k("records")
            .where({ kind: "quotations", parent_id: record.parent_id })
            .whereNot("id", id)
            .whereNotIn("status", ["draft", "rejected"]);
          for (const alternative of alternatives) {
            const other = serializeRecord(alternative);
            await updateStatus(
              k,
              user,
              other,
              "rejected",
              "Another quotation was approved for this RFQ.",
            );
            await notifyOrganizations(
              k,
              [other.partner_org_id],
              "Quotation decision",
              `${other.number}: another quotation was selected.`,
              `/app/quotations/${other.id}`,
              "quotation",
            );
          }
        });
      }
    }
    if (record.kind === "orders" && target === "approved") {
      const settings = parseJson(
        (await k("settings").where({ key: "platform" }).first())?.value,
      );
      if (
        record.amount_minor >=
        Number(settings.approvalThreshold ?? 500000) * 100
      ) {
        const raw = await k("records").where({ id }).first();
        assert(
          raw.created_by !== user.id,
          422,
          `Orders at or above ${settings.approvalThreshold ?? 500000} ${record.currency} need approval from a second authorized person.`,
        );
      }
    }
    if (record.kind === "orders" && target === "fulfilled")
      assert(
        (await k("records")
          .where({ kind: "deliveries", parent_id: id, status: "confirmed" })
          .first()) ||
          (await k("records")
            .where({ kind: "milestones", parent_id: id, status: "approved" })
            .first()),
        422,
        "Confirm a delivery or approve a service milestone before fulfilling this order.",
      );
    if (record.kind === "deliveries" && target === "confirmed") {
      assert(
        parent && ["sent", "acknowledged"].includes(parent.status),
        422,
        "The purchase order must still be open.",
      );
      await updateStatus(
        k,
        user,
        parent,
        "fulfilled",
        `Delivery ${record.number} confirmed. ${note}`,
      );
    }
    if (
      record.kind === "invoices" &&
      ["submitted", "approved"].includes(target)
    )
      assert(
        parent &&
          (parent.kind === "orders"
            ? ["fulfilled", "closed"]
            : ["active", "renewed"]
          ).includes(parent.status),
        422,
        "The linked order must be fulfilled or the contract active.",
      );
    if (
      record.kind === "payments" &&
      ["pending", "processing", "completed"].includes(target)
    ) {
      assert(
        parent?.status === "approved",
        422,
        "The invoice is not open for payment.",
      );
      const sum = await k("records")
        .where({ kind: "payments", parent_id: record.parent_id })
        .whereNot("id", id)
        .whereNot("status", "failed")
        .sum({ total: "amount_minor" })
        .first();
      assert(
        record.amount_minor + Number(sum?.total || 0) <= parent.amount_minor,
        422,
        "This payment exceeds the remaining invoice balance.",
      );
      if (target === "completed") {
        const paid = await k("records")
          .where({
            kind: "payments",
            parent_id: record.parent_id,
            status: "completed",
          })
          .whereNot("id", id)
          .sum({ total: "amount_minor" })
          .first();
        if (
          record.amount_minor + Number(paid?.total || 0) ===
          parent.amount_minor
        )
          effects.push(() =>
            updateStatus(
              k,
              user,
              parent,
              "paid",
              `Balance cleared by ${record.number}.`,
            ),
          );
      }
    }
    if (record.kind === "contracts" && ["approved", "active"].includes(target))
      assert(
        record.payload.end_date >= today,
        422,
        "Update the contract end date before approval or activation.",
      );
    if (record.kind === "candidates") {
      if (target === "interview")
        assert(
          await k("records")
            .where({ kind: "interviews", parent_id: id })
            .whereNot("status", "cancelled")
            .first(),
          422,
          "Schedule an interview before moving the candidate to this stage.",
        );
      if (target === "selected")
        assert(
          await k("records")
            .where({ kind: "interviews", parent_id: id, status: "completed" })
            .first(),
          422,
          "Complete an interview and record feedback before selection.",
        );
      if (target === "offer")
        assert(
          record.payload.offer_date && record.payload.offer_compensation > 0,
          422,
          "Add the offer date and compensation before issuing the offer.",
        );
      if (target === "onboarding")
        assert(
          record.payload.bgv_status === "Clear",
          422,
          "The hiring team must clear the background check before onboarding.",
        );
      if (target === "joined")
        assert(
          record.payload.joining_date,
          422,
          "Record the joining date before marking the candidate as joined.",
        );
    }
    if (record.kind === "interviews" && target === "completed")
      assert(
        record.payload.feedback.trim().length >= 5 &&
          record.payload.recommendation !== "Pending",
        422,
        "Record interview feedback and a recommendation before completing the interview.",
      );
    if (record.kind === "demos" && target === "scheduled")
      assert(
        record.payload.scheduled_at,
        422,
        "Add the confirmed meeting date and time before scheduling.",
      );
    if (record.kind === "tickets" && target === "resolved")
      assert(
        record.payload.resolution.trim().length >= 5 || note.trim().length >= 5,
        422,
        "Add resolution notes before resolving this ticket.",
      );
    if (!(await approvalGate(k, user, record, target, note)))
      return recordDetail(id, user, k);
    for (const effect of effects) await effect();
    await snapshot(k, record, user, note || `Status changed to ${target}`);
    await updateStatus(k, user, record, target, note);
    await startApproval(k, {
      ...record,
      status: target,
      version: record.version + 1,
    });
    const invited =
      ["rfqs", "requirements"].includes(record.kind) &&
      ["published", "open"].includes(target)
        ? await k("record_invitations")
            .where({ record_id: id })
            .select("organization_id")
        : [];
    const internalRoles =
      record.kind === "invoices" && target === "submitted"
        ? ["finance"]
        : record.kind === "candidates"
          ? ["hr"]
          : record.kind === "quotations" && target === "submitted"
            ? ["procurement"]
            : record.kind === "tickets"
              ? ["support"]
              : [];
    await notifyOrganizations(
      k,
      [
        record.buyer_org_id,
        record.partner_org_id,
        record.owner_org_id,
        ...invited.map((i) => i.organization_id),
      ],
      `${moduleDefinitions[record.kind].singular} ${target.replaceAll("_", " ")}`,
      `${record.number} · ${record.title}${note ? `\n${note}` : ""}`,
      `/app/${record.kind}/${id}`,
      record.kind,
      internalRoles,
    );
    return recordDetail(id, user, k);
  });
}
export async function amendContract(
  user: SessionUser,
  id: string,
  endDate: string,
  note: string,
  version: number,
) {
  assertActive(user);
  return db.transaction(async (k) => {
    let lock = k("records").where({ id });
    if (db.client.config.client === "pg") lock = lock.forUpdate();
    await lock.first();
    const record = await accessibleRecord(id, user, k);
    assert(
      record.kind === "contracts" &&
        isBuyer(user, record) &&
        user.permissions.contracts?.includes("edit"),
      403,
      "Only an authorized buyer can amend this contract.",
    );
    assert(
      ["active", "renewed", "expired"].includes(record.status),
      422,
      "Only active or expired contracts can be renewed.",
    );
    assert(
      version === record.version,
      409,
      "Refresh this contract before saving.",
    );
    assert(
      endDate > record.payload.end_date,
      422,
      "The renewed end date must be later than the current end date.",
    );
    await snapshot(k, record, user, note);
    await k("records")
      .where({ id, version })
      .update({
        status: "review",
        payload: JSON.stringify({
          ...record.payload,
          end_date: endDate,
          amendment: note,
        }),
        version: version + 1,
        updated_at: now(),
      });
    await startApproval(
      k,
      serializeRecord(await k("records").where({ id }).first()),
    );
    await audit(
      k,
      user,
      "renewal_requested",
      "contracts",
      record,
      "review",
      note,
    );
    await notifyOrganizations(
      k,
      [record.buyer_org_id, record.partner_org_id],
      "Contract renewal requested",
      `${record.number} has a new version ready for review.`,
      `/app/contracts/${id}`,
      "contracts",
      ["procurement"],
    );
    return recordDetail(id, user, k);
  });
}
