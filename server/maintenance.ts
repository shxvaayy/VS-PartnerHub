import { db, now, parseJson } from "./db.js";
import { audit, notifyOrganizations } from "./events.js";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
let running = false;
export async function maintenance() {
  if (running) return;
  running = true;
  try {
    const settings = parseJson(
      (await db("settings").where({ key: "platform" }).first())?.value,
    );
    const windows = [...(settings.documentExpiryDays || [90, 60, 30]), 0].sort(
      (a: number, b: number) => a - b,
    );
    const today = now().slice(0, 10),
      horizon = new Date(Date.now() + Math.max(...windows) * 86400000)
        .toISOString()
        .slice(0, 10);
    const documents = await db("documents")
      .whereNull("record_id")
      .whereNotNull("expires_at")
      .where("expires_at", "<=", horizon)
      .whereNotExists(
        db("documents as next").whereRaw("next.previous_id = documents.id"),
      );
    for (const doc of documents) {
      const days = Math.ceil(
          (Date.parse(doc.expires_at) - Date.parse(today)) / 86400000,
        ),
        window = windows.find((w: number) => days <= w);
      if (window === undefined) continue;
      await db.transaction(async (k) => {
        if (days < 0 && doc.status === "approved") {
          await k("documents")
            .where({ id: doc.id })
            .update({ status: "expired", updated_at: now() });
          await audit(k, null, "document_expired", "documents", doc, "expired");
        }
        await notifyOrganizations(
          k,
          [doc.organization_id],
          days < 0
            ? "Document renewal needed"
            : `Document expires in ${days} days`,
          `${doc.category}: ${doc.name}. Upload a renewed version to maintain compliance.`,
          "/app/documents",
          "document_expiry",
          ["verification"],
          `document:${doc.id}:${window}`,
        );
      });
    }
    const contracts = await db("records")
      .where({ kind: "contracts" })
      .whereIn("status", ["active", "renewed"]);
    for (const contract of contracts) {
      const p = parseJson(contract.payload),
        days = Math.ceil(
          (Date.parse(p.end_date) - Date.parse(today)) / 86400000,
        );
      if (days > (p.renewal_notice_days || 30)) continue;
      await db.transaction(async (k) => {
        if (days < 0) {
          await k("records")
            .where({ id: contract.id, version: contract.version })
            .update({
              status: "expired",
              version: contract.version + 1,
              updated_at: now(),
            });
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
        await unlink(path.join(config.uploadDir, file.storage_key)).catch(
          () => {},
        );
    }
    await db("sessions").where("expires_at", "<", now()).delete();
    await db("auth_tokens").where("expires_at", "<", now()).delete();
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
