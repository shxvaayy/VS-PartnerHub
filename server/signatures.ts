import { Router } from "express";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { readStoredFile } from "./storage.js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { DatabaseRateLimitStore } from "./rate-limits.js";
import { db, now, parseJson, type Database } from "./db.js";
import { config } from "./config.js";
import {
  authenticated,
  assertActive,
  can,
  getUser,
  hashCode,
} from "./security.js";
import { assert } from "./errors.js";
import { accessibleRecord, getItems, isBuyer } from "./record-service.js";
import {
  audit,
  notifyUsers,
  queueEmail,
  requireEmailDelivery,
  deliverEmails,
} from "./events.js";
import { uuid } from "./validation.js";
import type { SessionUser, WorkRecord } from "../shared/domain.js";

const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const consent =
  "I have reviewed the complete contract document. I am authorized to sign on behalf of my organization and consent to signing this contract electronically with my typed name and verified email code.";
async function contractSnapshot(record: WorkRecord, k: Database = db) {
  return {
    number: record.number,
    title: record.title,
    buyer_org_id: record.buyer_org_id,
    partner_org_id: record.partner_org_id,
    currency: record.currency,
    amount_minor: record.amount_minor,
    payload: record.payload,
    items: (await getItems(record.id, k)).map(({ id: _id, ...item }) => item),
  };
}
async function signatureAccess(
  id: string,
  user: SessionUser,
  k: Database = db,
) {
  const envelope = await k("signature_envelopes").where({ id }).first();
  assert(envelope, 404, "Signature request not found.");
  const record = await accessibleRecord(envelope.contract_id, user, k);
  assert(record.kind === "contracts", 404, "Contract not found.");
  return { envelope, record };
}
async function unchanged(envelope: any, record: WorkRecord, k: Database = db) {
  assert(
    envelope.status === "pending" && envelope.expires_at > now(),
    422,
    "This signing request is closed or expired. Ask the buyer to issue a new request.",
  );
  assert(
    record.status === "approved",
    422,
    "The contract must remain approved and awaiting signatures.",
  );
  assert(
    digest(JSON.stringify(await contractSnapshot(record, k))) ===
      envelope.contract_digest,
    409,
    "The contract terms changed. A new signature request is required.",
  );
  const doc = await k("documents")
    .where({ id: envelope.document_id, record_id: record.id })
    .first();
  assert(
    doc && !(await k("documents").where({ previous_id: doc.id }).first()),
    409,
    "The signing document has been replaced. A new request is required.",
  );
  const bytes = await readStoredFile(doc.storage_key);
  assert(
    digest(bytes) === envelope.source_digest,
    409,
    "The document integrity check failed. Contact your administrator.",
  );
}
export async function signaturesAllowActivation(
  record: WorkRecord,
  k: Database,
) {
  const latest = await k("signature_envelopes")
    .where({ contract_id: record.id })
    .whereNot("status", "void")
    .orderBy("created_at", "desc")
    .first();
  if (!latest) return;
  assert(
    latest.status === "completed" &&
      digest(JSON.stringify(await contractSnapshot(record, k))) ===
        latest.contract_digest,
    422,
    "Complete the signature request for the current contract terms before activation.",
  );
}
export const signaturesRouter = Router();
signaturesRouter.use(authenticated, (req, _res, next) => {
  assertActive(req.user);
  next();
});
const otpLimit = rateLimit({
  store: new DatabaseRateLimitStore("signatures"),
  windowMs: 15 * 60000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "test",
  message: {
    error: "Too many signing attempts. Please wait before trying again.",
  },
});
signaturesRouter.get("/contracts/:id", async (req, res) => {
  const record = await accessibleRecord(uuid.parse(req.params.id), req.user);
  assert(record.kind === "contracts", 404, "Contract not found.");
  const envelopes = await db("signature_envelopes")
    .where({ contract_id: record.id })
    .orderBy("created_at", "desc");
  const items = [];
  for (const envelope of envelopes) {
    const parties = await db("signature_parties")
      .join("users", "users.id", "signature_parties.user_id")
      .where("envelope_id", envelope.id)
      .select(
        "signature_parties.id",
        "signature_parties.user_id",
        "signature_parties.status",
        "signature_parties.signed_name",
        "signature_parties.signed_at",
        "signature_parties.signature_digest",
        "users.name",
        "users.email",
      );
    items.push({
      id: envelope.id,
      status:
        envelope.status === "pending" && envelope.expires_at < now()
          ? "expired"
          : envelope.status,
      document_id: envelope.document_id,
      contract_version: envelope.contract_version,
      source_digest: envelope.source_digest,
      contract_digest: envelope.contract_digest,
      created_at: envelope.created_at,
      expires_at: envelope.expires_at,
      completed_at: envelope.completed_at,
      parties,
    });
  }
  const eligible = [];
  const canRequest =
    isBuyer(req.user, record) && can(req.user, "contracts", "review");
  if (canRequest) {
    const users = await db("users")
      .whereIn(
        "organization_id",
        [record.buyer_org_id, record.partner_org_id].filter(
          Boolean,
        ) as string[],
      )
      .where({ active: true, email_verified: true });
    for (const row of users) {
      const user = await getUser(row.id);
      if (user && can(user, "contracts", "review"))
        eligible.push({
          id: user.id,
          name: user.name,
          email: user.email,
          organization_id: user.organization_id,
          organization_name: user.organization?.legal_name,
        });
    }
  }
  res.json({
    items,
    eligibleSigners: eligible,
    canRequest: canRequest && record.status === "approved",
    consent,
  });
});
signaturesRouter.post("/contracts/:id", async (req, res) => {
  const id = uuid.parse(req.params.id),
    input = z
      .object({
        documentId: uuid,
        signerIds: z.array(uuid).min(2).max(8),
        expiresInDays: z.number().int().min(1).max(30).default(7),
        version: z.number().int().positive(),
      })
      .parse(req.body);
  await requireEmailDelivery();
  const envelopeId = randomUUID();
  await db.transaction(async (k) => {
    let lock = k("records").where({ id });
    if (db.client.config.client === "pg") lock = lock.forUpdate();
    await lock.first();
    const record = await accessibleRecord(id, req.user, k);
    assert(
      record.kind === "contracts" &&
        record.status === "approved" &&
        record.version === input.version,
      422,
      "Refresh the approved contract before requesting signatures.",
    );
    assert(
      isBuyer(req.user, record) && can(req.user, "contracts", "review"),
      403,
      "Only an authorized buyer can request contract signatures.",
    );
    assert(
      !(await k("signature_envelopes")
        .where({ contract_id: id, status: "pending" })
        .first()),
      409,
      "Void the existing signature request before issuing another.",
    );
    const doc = await k("documents")
      .where({
        id: input.documentId,
        record_id: id,
        mime_type: "application/pdf",
      })
      .first();
    assert(
      doc && !(await k("documents").where({ previous_id: doc.id }).first()),
      422,
      "Choose the current PDF contract attachment for signing.",
    );
    const signers: SessionUser[] = [];
    for (const userId of [...new Set(input.signerIds)]) {
      const user = await getUser(userId, k);
      assert(
        user &&
          user.email_verified &&
          user.organization?.status === "active" &&
          [record.buyer_org_id, record.partner_org_id].includes(
            user.organization_id,
          ) &&
          can(user, "contracts", "review"),
        422,
        "Each signer must be an active, verified and authorized representative of a contract party.",
      );
      signers.push(user);
    }
    assert(
      signers.some((u) => u.organization_id === record.buyer_org_id) &&
        signers.some((u) => u.organization_id === record.partner_org_id),
      422,
      "Choose at least one authorized signer from each contract party.",
    );
    const source = await readStoredFile(doc.storage_key);
    try {
      await PDFDocument.load(source);
    } catch {
      assert(
        false,
        422,
        "Upload an accessible, unencrypted PDF contract before requesting signatures.",
      );
    }
    const snapshot = JSON.stringify(await contractSnapshot(record, k));
    await k("signature_envelopes").insert({
      id: envelopeId,
      contract_id: id,
      contract_version: record.version,
      document_id: doc.id,
      source_digest: digest(source),
      contract_snapshot: snapshot,
      contract_digest: digest(snapshot),
      requested_by: req.user.id,
      status: "pending",
      expires_at: new Date(
        Date.now() + input.expiresInDays * 86400000,
      ).toISOString(),
      created_at: now(),
      updated_at: now(),
    });
    for (const signer of signers)
      await k("signature_parties").insert({
        id: randomUUID(),
        envelope_id: envelopeId,
        user_id: signer.id,
        status: "pending",
      });
    await audit(
      k,
      req.user,
      "signature_requested",
      "contracts",
      record,
      undefined,
      `Envelope ${envelopeId} · SHA-256 ${digest(source)}`,
    );
    await notifyUsers(
      k,
      signers.map((u) => u.id),
      "Contract ready for your signature",
      `${record.number} · Review the contract and verify your signature with an email code.`,
      `/app/contracts/${id}`,
      "contracts",
    );
  });
  void deliverEmails().catch(() => {});
  res.status(201).json({ id: envelopeId });
});
signaturesRouter.post("/:id/otp", otpLimit, async (req, res) => {
  await requireEmailDelivery();
  const id = uuid.parse(req.params.id),
    { envelope, record } = await signatureAccess(id, req.user);
  await unchanged(envelope, record);
  const party = await db("signature_parties")
    .where({ envelope_id: id, user_id: req.user.id, status: "pending" })
    .first();
  assert(
    party && can(req.user, "contracts", "review"),
    403,
    "You are not an awaiting authorized signer on this request.",
  );
  assert(
    !party.otp_sent_at || Date.parse(party.otp_sent_at) < Date.now() - 60000,
    429,
    "Wait one minute before requesting another signing code.",
  );
  const code = String(randomInt(100000, 1000000)),
    challenge = randomUUID(),
    expiry = new Date(Date.now() + 10 * 60000).toISOString();
  await db.transaction(async (k) => {
    const changed = await k("signature_parties")
      .where({ id: party.id, status: "pending" })
      .where((q) =>
        q
          .whereNull("otp_sent_at")
          .orWhere(
            "otp_sent_at",
            "<",
            new Date(Date.now() - 60000).toISOString(),
          ),
      )
      .update({
        challenge_id: challenge,
        otp_hash: hashCode(`${party.id}:${challenge}:${code}`),
        otp_expires_at: expiry,
        otp_attempts: 0,
        otp_sent_at: now(),
      });
    assert(
      changed,
      429,
      "A signing code was just requested. Please wait one minute.",
    );
    if (party.email_id)
      await k("email_outbox")
        .where({ id: party.email_id })
        .whereIn("status", ["queued", "blocked", "failed", "local"])
        .update({ status: "expired", body: "[Superseded signing code]" });
    const emailId = await queueEmail(
      k,
      req.user.email,
      "Verify your contract signature",
      `Your signing code is ${code}. It expires in 10 minutes.\n\nContract: ${record.number}\nDocument SHA-256: ${envelope.source_digest}\n\nEnter this code only after reviewing the contract in your VS PartnerHub workspace.`,
      req.user.id,
      { expiresAt: expiry },
    );
    await k("signature_parties")
      .where({ id: party.id, challenge_id: challenge })
      .update({ email_id: emailId });
  });
  void deliverEmails().catch(() => {});
  res.json({
    challengeId: challenge,
    expiresAt: expiry,
    ...(config.demo ? { verificationCode: code } : {}),
  });
});
signaturesRouter.post("/:id/sign", otpLimit, async (req, res) => {
  const id = uuid.parse(req.params.id),
    input = z
      .object({
        challengeId: uuid,
        code: z.string().regex(/^\d{6}$/),
        name: z.string().trim().min(2).max(180),
        consent: z.literal(true),
        sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .parse(req.body);
  const { envelope, record } = await signatureAccess(id, req.user);
  await unchanged(envelope, record);
  assert(
    input.sourceDigest === envelope.source_digest,
    409,
    "The document changed. Review the current request before signing.",
  );
  const party = await db("signature_parties")
    .where({ envelope_id: id, user_id: req.user.id, status: "pending" })
    .first();
  assert(
    party && can(req.user, "contracts", "review"),
    403,
    "You are not an awaiting authorized signer.",
  );
  assert(
    party.challenge_id === input.challengeId &&
      party.otp_expires_at > now() &&
      party.otp_attempts < 5,
    422,
    "The signing code expired or is locked. Request a new code.",
  );
  const attempted = await db("signature_parties")
    .where({ id: party.id, challenge_id: input.challengeId })
    .where("otp_attempts", "<", 5)
    .increment("otp_attempts", 1);
  assert(
    attempted &&
      party.otp_hash ===
        hashCode(`${party.id}:${input.challengeId}:${input.code}`),
    422,
    "That signing code is incorrect.",
  );
  await db.transaction(async (k) => {
    let recordLock = k("records").where({ id: record.id });
    if (db.client.config.client === "pg") recordLock = recordLock.forUpdate();
    await recordLock.first();
    let lock = k("signature_envelopes").where({ id });
    if (db.client.config.client === "pg") lock = lock.forUpdate();
    await lock.first();
    const current = await signatureAccess(id, req.user, k);
    await unchanged(current.envelope, current.record, k);
    const at = now(),
      signature = digest(
        JSON.stringify({
          envelope: id,
          document: envelope.source_digest,
          terms: envelope.contract_digest,
          user: req.user.id,
          email: req.user.email,
          name: input.name,
          consent,
          at,
        }),
      );
    const signed = await k("signature_parties")
      .where({
        id: party.id,
        status: "pending",
        challenge_id: input.challengeId,
      })
      .update({
        status: "signed",
        signed_name: input.name,
        signer_identity: JSON.stringify({
          name: input.name,
          email: req.user.email,
          organization_id: req.user.organization_id,
          organization_name: req.user.organization?.legal_name,
          role: req.user.role,
        }),
        signed_at: at,
        consent,
        signature_digest: signature,
        ip_hash: hashCode(req.ip || ""),
        otp_hash: null,
        challenge_id: null,
        otp_expires_at: null,
      });
    assert(signed, 409, "This signature has already been recorded.");
    await audit(
      k,
      req.user,
      "contract_signed",
      "contracts",
      record,
      undefined,
      `Envelope ${id} · evidence ${signature}`,
    );
    const pending = await k("signature_parties")
      .where({ envelope_id: id, status: "pending" })
      .first();
    if (!pending) {
      await k("signature_envelopes")
        .where({ id })
        .update({ status: "completed", completed_at: at, updated_at: at });
      const signers = await k("signature_parties")
        .where({ envelope_id: id })
        .select("user_id");
      await notifyUsers(
        k,
        signers.map((u) => u.user_id),
        "Contract signatures complete",
        `${record.number} · All signatures have been recorded. The evidence certificate is available in the contract.`,
        `/app/contracts/${record.id}`,
        "contracts",
      );
    }
  });
  res.json({ ok: true });
});
signaturesRouter.post("/:id/void", async (req, res) => {
  const id = uuid.parse(req.params.id),
    { note } = z
      .object({ note: z.string().trim().min(5).max(2000) })
      .parse(req.body);
  await db.transaction(async (k) => {
    const initial = await signatureAccess(id, req.user, k);
    let lock = k("records").where({ id: initial.record.id });
    if (db.client.config.client === "pg") lock = lock.forUpdate();
    await lock.first();
    const { envelope, record } = await signatureAccess(id, req.user, k);
    assert(
      isBuyer(req.user, record) && can(req.user, "contracts", "review"),
      403,
      "Only an authorized buyer can void a signature request.",
    );
    const changed = await k("signature_envelopes")
      .where({ id, status: "pending" })
      .update({ status: "void", updated_at: now() });
    assert(changed, 422, "Only an open signature request can be voided.");
    await audit(
      k,
      req.user,
      "signature_voided",
      "contracts",
      record,
      undefined,
      `${envelope.id}: ${note}`,
    );
  });
  res.json({ ok: true });
});
signaturesRouter.get("/:id/certificate", async (req, res) => {
  const { envelope, record } = await signatureAccess(
    uuid.parse(req.params.id),
    req.user,
  );
  assert(
    envelope.status === "completed",
    422,
    "The certificate is available after every signer has signed.",
  );
  const parties = await db("signature_parties")
    .join("users", "users.id", "signature_parties.user_id")
    .where("envelope_id", envelope.id)
    .select("signature_parties.*", "users.email");
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica),
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595, 842]),
    y = 790;
  const line = (value: string, heading = false) => {
    const safe = value.replace(
      /[^\x20-\x7e]/g,
      (character) =>
        `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
    for (let i = 0; i < safe.length || i === 0; i += 88) {
      if (y < 60) {
        page = pdf.addPage([595, 842]);
        y = 790;
      }
      page.drawText(safe.slice(i, i + 88), {
        x: 42,
        y,
        size: heading ? 13 : 10,
        font: heading ? bold : font,
        color: rgb(0.1, 0.2, 0.15),
      });
      y -= heading ? 25 : 17;
    }
  };
  line("VS PartnerHub | Electronic signing evidence", true);
  line(
    `Contract: ${parseJson(envelope.contract_snapshot).number} - ${parseJson(envelope.contract_snapshot).title}`,
  );
  line(`Envelope: ${envelope.id}`);
  line(`Contract version at issue: ${envelope.contract_version}`);
  line(`Completed (UTC): ${envelope.completed_at}`);
  line(`Document SHA-256: ${envelope.source_digest}`);
  line(`Contract terms SHA-256: ${envelope.contract_digest}`);
  line("");
  for (const party of parties) {
    const identity = parseJson(party.signer_identity);
    line(`Signer: ${party.signed_name}`, true);
    line(`Verified email: ${identity.email || party.email}`);
    line(`Organization: ${identity.organization_name || ""}`);
    line(`Signed (UTC): ${party.signed_at}`);
    line(`Signature evidence: ${party.signature_digest}`);
    line(`Consent: ${party.consent}`);
    line("");
  }
  line(
    "Method: authenticated account, explicit consent, typed name and email OTP.",
  );
  line(
    "This records an electronic signing agreement. It is not a qualified or",
  );
  line(
    "certificate-based statutory digital signature. The original contract remains",
  );
  line("unchanged. Retain the original PDF and this certificate together.");
  await audit(
    db,
    req.user,
    "signature_certificate_downloaded",
    "contracts",
    record,
  );
  res
    .type("application/pdf")
    .set("Cache-Control", "private, no-store")
    .attachment(`${record.number}-signing-evidence.pdf`)
    .send(Buffer.from(await pdf.save()));
});

signaturesRouter.get("/:id/evidence", async (req, res) => {
  const { envelope, record } = await signatureAccess(
    uuid.parse(req.params.id),
    req.user,
  );
  assert(
    envelope.status === "completed",
    422,
    "Signing evidence is available after every signer has signed.",
  );
  const parties = await db("signature_parties")
    .where({ envelope_id: envelope.id })
    .orderBy("id")
    .select(
      "user_id",
      "signed_at",
      "signed_name",
      "signer_identity",
      "consent",
      "signature_digest",
    );
  await audit(
    db,
    req.user,
    "signature_evidence_downloaded",
    "contracts",
    record,
  );
  res
    .set("Cache-Control", "private, no-store")
    .attachment(`${record.number}-signing-evidence.json`)
    .json({
      format: "partnerhub-signing-evidence-v1",
      envelopeId: envelope.id,
      completedAt: envelope.completed_at,
      originalDocumentId: envelope.document_id,
      documentSha256: envelope.source_digest,
      contractSha256: envelope.contract_digest,
      canonicalContractJson: envelope.contract_snapshot,
      signatures: parties.map((p) => ({
        ...p,
        signer_identity: parseJson(p.signer_identity),
      })),
      method:
        "Authenticated account, verified email OTP, typed name and explicit consent. Not a certificate-based statutory digital signature.",
    });
});
