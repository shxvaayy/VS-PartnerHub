import { db, now, parseJson } from "./db.js";
import { audit, notifyOrganizations } from "./events.js";
import { deleteStoredFile } from "./storage.js";
import {
  documentPolicyCatalogue,
  resolveDocumentPolicies,
} from "./master-data.js";
let running = false;
export async function maintenance() {
  if (running) return;
  running = true;
  try {
    const catalogue = await documentPolicyCatalogue();
    const policies = new Map<
      string,
      ReturnType<typeof resolveDocumentPolicies>
    >();
    const today = now().slice(0, 10),
      horizon = new Date(Date.now() + 365 * 86400000)
        .toISOString()
        .slice(0, 10);
    const documents = await db("documents")
      .join("organizations", "documents.organization_id", "organizations.id")
      .select("documents.id", "organizations.type as organization_type")
      .whereNull("documents.record_id")
      .whereNotNull("documents.expires_at")
      .where("documents.expires_at", "<=", horizon)
      .whereNotExists(
        db("documents as next").whereRaw("next.previous_id = documents.id"),
      );
    for (const candidate of documents) {
      // The batch identifies work; a human decision or a newer upload may have
      // committed since it was read. Lock and recheck before changing anything.
      await db.transaction(async (k) => {
        const query = k("documents")
          .where({ id: candidate.id })
          .whereNull("record_id")
          .first();
        if (k.client.config.client === "pg") query.forUpdate();
        const doc = await query;
        if (
          !doc?.expires_at ||
          (await k("documents").where({ previous_id: doc.id }).first("id"))
        )
          return;
        const type = candidate.organization_type;
        if (!policies.has(type))
          policies.set(type, resolveDocumentPolicies(type, catalogue));
        const policy = policies
          .get(type)!
          .find((p) => p.category === doc.category);
        const windows = [
          ...(policy?.reminder_days ||
            catalogue.settings.documentExpiryDays || [90, 60, 30]),
          0,
        ].sort((a: number, b: number) => a - b);
        const days = Math.ceil(
            (Date.parse(doc.expires_at) - Date.parse(today)) / 86400000,
          ),
          window = windows.find((w: number) => days <= w);
        if (!Number.isFinite(days) || window === undefined) return;
        if (days < 0 && doc.status === "approved") {
          const changed = await k("documents")
            .where({ id: doc.id, status: "approved" })
            .update({ status: "expired", updated_at: now() });
          if (!changed) return;
          await audit(k, null, "document_expired", "documents", doc, "expired");
        }
        const dedupeKey = `document:${doc.id}:${days < 0 ? "expired" : window}`;
        if (days < 0)
          // Preserve expiry notices sent by older releases, which shared the
          // due-day key. A due-day notice must not suppress the expired notice.
          await k("notifications")
            .where({
              category: "document_expiry",
              title: "Document renewal needed",
              dedupe_key: `document:${doc.id}:0`,
            })
            .whereNotExists(
              k("notifications as delivered")
                .whereRaw("delivered.user_id = notifications.user_id")
                .where("delivered.dedupe_key", dedupeKey),
            )
            .update({ dedupe_key: dedupeKey });
        await notifyOrganizations(
          k,
          [doc.organization_id],
          days < 0
            ? "Document renewal needed"
            : days === 0
              ? "Document expires today"
              : `Document expires in ${days} days`,
          `${doc.category}: ${doc.name}. Upload a renewed version to maintain compliance.`,
          "/app/documents",
          "document_expiry",
          ["verification"],
          dedupeKey,
        );
      });
    }
    const contracts = await db("records")
      .where({ kind: "contracts" })
      .whereIn("status", ["active", "renewed"])
      .select("id");
    for (const candidate of contracts) {
      await db.transaction(async (k) => {
        const query = k("records")
          .where({ id: candidate.id, kind: "contracts" })
          .first();
        if (k.client.config.client === "pg") query.forUpdate();
        const contract = await query;
        if (!contract || !["active", "renewed"].includes(contract.status))
          return;
        const p = parseJson(contract.payload),
          days = Math.ceil(
            (Date.parse(p.end_date) - Date.parse(today)) / 86400000,
          );
        if (!Number.isFinite(days) || days > (p.renewal_notice_days ?? 30))
          return;
        if (days < 0) {
          const changed = await k("records")
            .where({
              id: contract.id,
              version: contract.version,
              status: contract.status,
            })
            .update({
              status: "expired",
              version: contract.version + 1,
              updated_at: now(),
            });
          if (!changed) return;
          await audit(
            k,
            null,
            "contract_expired",
            "contracts",
            contract,
            "expired",
          );
        }
        await notifyOrganizations(
          k,
          [contract.buyer_org_id, contract.partner_org_id],
          days < 0 ? "Contract expired" : "Contract renewal approaching",
          `${contract.number} · ${contract.title} ends on ${p.end_date}.`,
          `/app/contracts/${contract.id}`,
          "contract_expiry",
          ["procurement"],
          `contract:${contract.id}:${p.end_date}:${days < 0 ? "expired" : "notice"}`,
        );
      });
    }
    // Only completed/closed candidates are anonymized; active recruitment is never silently removed.
    const candidates = await db("records")
      .where({ kind: "candidates" })
      .whereIn("status", ["joined", "closed"]);
    for (const candidate of candidates) {
      const p = parseJson(candidate.payload);
      if (!p.retention_until || p.retention_until >= now() || p.anonymized)
        continue;
      const files = await db("documents").where({ record_id: candidate.id });
      const interviews = await db("records").where({
        parent_id: candidate.id,
        kind: "interviews",
      });
      for (const interview of interviews)
        files.push(
          ...(await db("documents").where({ record_id: interview.id })),
        );
      await db.transaction(async (k) => {
        for (const record of [candidate, ...interviews]) {
          const documentIds = files
            .filter((f) => f.record_id === record.id)
            .map((f) => f.id);
          if (documentIds.length)
            await k("document_extractions")
              .whereIn("document_id", documentIds)
              .delete();
          const conversations = await k("ai_messages")
            .where("sources", "like", `%${record.id}%`)
            .distinct("conversation_id");
          if (conversations.length) {
            const ids = conversations.map((c) => c.conversation_id);
            await k("ai_conversations")
              .whereIn("id", ids)
              .update({ title: "Archived recruitment conversation" });
            await k("ai_messages").whereIn("conversation_id", ids).update({
              content: "[Removed under candidate retention policy]",
              structured: "{}",
              sources: "[]",
            });
          }
          await k("record_versions").where({ record_id: record.id }).delete();
          await k("comments").where({ record_id: record.id }).delete();
          await k("documents").where({ record_id: record.id }).delete();
          await k("records")
            .where({ id: record.id })
            .update({
              title: "Archived candidate",
              payload: JSON.stringify({
                anonymized: true,
                retention_until: p.retention_until,
              }),
              version: record.version + 1,
              updated_at: now(),
            });
        }
        await audit(
          k,
          null,
          "candidate_anonymized",
          "candidates",
          candidate,
          undefined,
          "Configured retention period elapsed.",
        );
      });
      for (const file of files)
        await deleteStoredFile(file.storage_key).catch(() => {});
    }
    await db("sessions").where("expires_at", "<", now()).delete();
    // Staged uploads are private, untrusted files. Keep them until all write
    // tokens have expired, then remove abandoned and completed staging objects.
    const uploadCutoff = new Date(Date.now() - 5 * 60000).toISOString();
    const uploads = await db("document_uploads")
      .where("expires_at", "<", uploadCutoff)
      .where("updated_at", "<", uploadCutoff)
      .orderBy("expires_at")
      .limit(100);
    for (const upload of uploads) {
      await deleteStoredFile(upload.storage_key);
      await db("document_uploads").where({ id: upload.id }).delete();
    }
    await db("auth_attempts").where("expires_at", "<", now()).delete();
    await db("auth_tokens").where("expires_at", "<", now()).delete();
    await db("import_batches")
      .where("expires_at", "<", now())
      .whereNot("status", "completed")
      .update({
        status: "expired",
        rows: "[]",
        results: "[]",
        updated_at: now(),
      });
    await db("signature_parties")
      .whereNotNull("otp_expires_at")
      .where("otp_expires_at", "<", now())
      .update({ otp_hash: null, challenge_id: null });
    await db("ai_requests")
      .where({ status: "running" })
      .where("created_at", "<", new Date(Date.now() - 5 * 60000).toISOString())
      .update({ status: "interrupted", completed_at: now() });
    await db("email_outbox")
      .whereIn("status", ["local", "failed", "queued"])
      .where(
        "created_at",
        "<",
        new Date(Date.now() - 7 * 86400000).toISOString(),
      )
      .update({ body: "[Expired; content removed]", status: "expired" });
  } finally {
    running = false;
  }
}
