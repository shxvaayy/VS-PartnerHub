import { Router } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { config, INTERNAL_ORG_ID } from "./config.js";
import { db, now, parseJson } from "./db.js";
import { assert } from "./errors.js";
import { authenticated, can, permit } from "./security.js";
import { accessibleRecord } from "./record-service.js";
import { audit, notifyOrganizations } from "./events.js";
import { documentSchema, pagination, uuid } from "./validation.js";
import { activeDocumentCategory, documentPolicies } from "./master-data.js";
import {
  extractionReviewSchema,
  recordExtractionReview,
  validateExtraction,
} from "./document-intelligence.js";
import { emptyIdentity } from "../shared/ai.js";
import type { SessionUser } from "../shared/domain.js";
import { accountAttempt } from "./auth-support.js";
import {
  deleteStoredFile,
  readStoredFile,
  sendStoredFile,
  writeStoredFile,
} from "./storage.js";
export const documentsRouter = Router();
documentsRouter.use(authenticated);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 8, fieldSize: 2000 },
});
function fileType(buffer: Buffer) {
  if (buffer.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255)
    return "image/jpeg";
  return null;
}
const cleanDocument = ({ storage_key: _storage, ...doc }: any) => doc;
documentsRouter.get("/", async (req, res) => {
  const p = pagination.parse(req.query),
    recordId = req.query.record_id ? uuid.parse(req.query.record_id) : null;
  const orgId = req.query.organization_id
    ? uuid.parse(req.query.organization_id)
    : null;
  const q = db("documents").leftJoin(
    "organizations",
    "documents.organization_id",
    "organizations.id",
  );
  if (recordId) {
    await accessibleRecord(recordId, req.user);
    q.where("documents.record_id", recordId);
  } else {
    assert(
      can(req.user, "documents"),
      403,
      "Your role cannot access company documents.",
    );
    q.whereNull("documents.record_id");
    if (!req.user.internal)
      q.where("documents.organization_id", req.user.organization_id);
    if (orgId) q.where("documents.organization_id", orgId);
  }
  if (p.status) q.where("documents.status", p.status);
  if (p.q)
    q.where((b) =>
      b
        .whereILike("documents.name", `%${p.q}%`)
        .orWhereILike("organizations.legal_name", `%${p.q}%`)
        .orWhereILike("documents.category", `%${p.q}%`),
    );
  const count = await q.clone().count({ count: "*" }).first();
  const items = await q
    .select("documents.*", "organizations.legal_name as organization_name")
    .orderBy("documents.created_at", "desc")
    .limit(p.limit)
    .offset((p.page - 1) * p.limit);
  res.json({
    items: items.map(cleanDocument),
    total: Number(count?.count),
    page: p.page,
    limit: p.limit,
  });
});
type DocumentInput = z.infer<typeof documentSchema>;
type DocumentFile = Pick<
  Express.Multer.File,
  "buffer" | "size" | "mimetype" | "originalname"
>;
async function authorizeUpload(input: DocumentInput, user: SessionUser) {
  const orgId = user.internal
    ? input.organization_id || INTERNAL_ORG_ID
    : user.organization_id!;
  assert(
    !input.organization_id ||
      user.internal ||
      input.organization_id === user.organization_id,
    403,
    "You cannot upload documents for another organization.",
  );
  if (input.record_id) {
    const record = await accessibleRecord(input.record_id, user);
    assert(
      can(user, record.kind, "edit") || can(user, record.kind, "create"),
      403,
      "Your role cannot attach documents to this record.",
    );
    assert(
      user.internal ||
        [
          record.owner_org_id,
          record.partner_org_id,
          record.buyer_org_id,
        ].includes(user.organization_id),
      403,
      "Only the transaction parties can attach files.",
    );
  } else
    assert(
      can(user, "documents", "create"),
      403,
      "Your role cannot upload company documents.",
    );
  const organization = await db("organizations").where({ id: orgId }).first();
  assert(organization, 422, "Organization not found.");
  assert(
    await activeDocumentCategory(input.category),
    422,
    "Choose an active document category.",
  );
  if (!input.record_id) {
    const policy = (await documentPolicies(organization.type)).find(
      (p) => p.category === input.category,
    );
    assert(
      !policy?.expiry_required || input.expires_at,
      422,
      "An expiry date is required for this document category.",
    );
  }
  return orgId;
}

async function saveDocument(
  input: DocumentInput,
  file: DocumentFile | undefined,
  user: SessionUser,
  uploadId?: string,
) {
  assert(file && file.size > 0, 422, "Choose a PDF, PNG or JPEG document.");
  assert(
    file.size <= 10 * 1024 * 1024,
    413,
    "Choose a document no larger than 10 MB.",
  );
  const detected = fileType(file.buffer);
  assert(
    detected && detected === file.mimetype,
    422,
    "Upload a valid PDF, PNG or JPEG. Renamed or unsupported files are not accepted.",
  );
  const orgId = await authorizeUpload(input, user);
  const id = randomUUID(),
    key = `${id}.${detected === "application/pdf" ? "pdf" : detected === "image/png" ? "png" : "jpg"}`;
  await writeStoredFile(key, file.buffer, detected);
  try {
    await db.transaction(async (k) => {
      if (input.record_id) {
        let lock = k("records").where({ id: input.record_id });
        if (db.client.config.client === "pg") lock = lock.forUpdate();
        await lock.first();
      }
      let version = 1;
      if (input.previous_id) {
        const previous = await k("documents")
          .where({
            id: input.previous_id,
            organization_id: orgId,
            category: input.category,
          })
          .first();
        assert(
          previous && previous.record_id === (input.record_id || null),
          422,
          "Choose the previous version of this document.",
        );
        assert(
          !(await k("documents")
            .where({ previous_id: input.previous_id })
            .first()),
          409,
          "A newer version already exists. Renew the latest document.",
        );
        assert(
          !(await k("signature_envelopes")
            .where({ document_id: previous.id })
            .whereIn("status", ["pending", "completed"])
            .first()),
          409,
          "This document is part of a signature request. Void an open request, or create an amended contract with a new PDF; the signed original is preserved.",
        );
        version = previous.version + 1;
      }
      const doc = {
        id,
        organization_id: orgId,
        record_id: input.record_id || null,
        category: input.category,
        name: path
          .basename(file.originalname)
          .replace(/[\r\n\x00-\x1f]/g, "")
          .slice(0, 200),
        storage_key: key,
        mime_type: detected,
        size: file.size,
        status: "uploaded",
        expires_at: input.expires_at || null,
        previous_id: input.previous_id || null,
        version,
        uploaded_by: user.id,
        created_at: now(),
        updated_at: now(),
      };
      await k("documents").insert(doc);
      await audit(
        k,
        user,
        input.previous_id ? "document_renewed" : "document_uploaded",
        "documents",
        { id },
        "uploaded",
        input.category,
      );
      if (!input.record_id)
        await notifyOrganizations(
          k,
          [orgId],
          "Document ready for review",
          `${input.category}: ${doc.name}`,
          "/app/documents",
          "documents",
          ["verification"],
        );
      if (uploadId) {
        const completed = await k("document_uploads")
          .where({ id: uploadId, user_id: user.id, status: "processing" })
          .update({ status: "completed", document_id: id, updated_at: now() });
        assert(
          completed,
          409,
          "This upload is no longer available. Please upload the file again.",
        );
      }
    });
  } catch (e) {
    await deleteStoredFile(key).catch(() => {});
    throw e;
  }
  return cleanDocument(await db("documents").where({ id }).first());
}

documentsRouter.post("/uploads", async (req, res) => {
  const { document, file } = z
    .object({
      document: documentSchema,
      file: z.object({
        name: z.string().min(1).max(200),
        type: z.enum(["application/pdf", "image/png", "image/jpeg"]),
        size: z
          .number()
          .int()
          .positive()
          .max(10 * 1024 * 1024),
      }),
    })
    .parse(req.body);
  await authorizeUpload(document, req.user);
  if (config.fileStorage !== "blob") {
    res.json({ transport: "multipart" });
    return;
  }
  assert(
    await accountAttempt("document-upload", req.user.id, 60, 60 * 60000),
    429,
    "The upload limit has been reached. Please try again later.",
  );
  const id = randomUUID();
  const key = `pending-${id}.${file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : "jpg"}`;
  const expiresAt = new Date(Date.now() + 15 * 60000).toISOString();
  const token = await generateClientTokenFromReadWriteToken({
    token: config.blobToken,
    pathname: key,
    allowedContentTypes: [file.type],
    maximumSizeInBytes: file.size,
    validUntil: Date.parse(expiresAt),
    addRandomSuffix: false,
    allowOverwrite: false,
  });
  await db("document_uploads").insert({
    id,
    user_id: req.user.id,
    storage_key: key,
    name: path
      .basename(file.name)
      .replace(/[\r\n\x00-\x1f]/g, "")
      .slice(0, 200),
    mime_type: file.type,
    size: file.size,
    input: JSON.stringify(document),
    status: "pending",
    created_at: now(),
    expires_at: expiresAt,
    updated_at: now(),
  });
  res.status(201).json({ transport: "direct", id, pathname: key, token });
});

documentsRouter.post("/uploads/:id/complete", async (req, res) => {
  const id = uuid.parse(req.params.id);
  const ticket = await db("document_uploads")
    .where({ id, user_id: req.user.id })
    .first();
  assert(ticket, 404, "Upload not found.");
  if (ticket.status === "completed") {
    const doc = await db("documents").where({ id: ticket.document_id }).first();
    assert(doc, 404, "Document not found.");
    await authorizeUpload(
      documentSchema.parse(parseJson(ticket.input)),
      req.user,
    );
    res.json(cleanDocument(doc));
    return;
  }
  assert(
    ticket.expires_at > now(),
    410,
    "This upload expired. Please upload the file again.",
  );
  const claimed = await db("document_uploads")
    .where({ id, user_id: req.user.id, status: "pending" })
    .update({ status: "processing", updated_at: now() });
  assert(
    claimed,
    409,
    "This upload is already being processed. Please wait a moment.",
  );
  try {
    const input = documentSchema.parse(parseJson(ticket.input));
    // Permissions are checked again after upload, including any intervening role
    // or organization changes. The blob URL supplied by a browser is never used.
    await authorizeUpload(input, req.user);
    const bytes = await readStoredFile(ticket.storage_key, ticket.size);
    assert(
      bytes.length === ticket.size,
      422,
      "The uploaded file is incomplete. Please upload it again.",
    );
    const doc = await saveDocument(
      input,
      {
        buffer: bytes,
        size: bytes.length,
        mimetype: ticket.mime_type,
        originalname: ticket.name,
      },
      req.user,
      id,
    );
    // Retain the staging object until its write token expires. Deleting it early
    // would let that token recreate the pathname. Only the validated copy is used.
    res.status(201).json(doc);
  } catch (error) {
    await db("document_uploads")
      .where({ id, status: "processing" })
      .update({ status: "pending", updated_at: now() });
    throw error;
  }
});

documentsRouter.post("/", upload.single("file"), async (req, res) => {
  const doc = await saveDocument(
    documentSchema.parse(req.body),
    req.file,
    req.user,
  );
  res.status(201).json(doc);
});
documentsRouter.get("/:id/download", async (req, res) => {
  const id = uuid.parse(req.params.id),
    doc = await db("documents").where({ id }).first();
  assert(doc, 404, "Document not found.");
  if (doc.record_id) await accessibleRecord(doc.record_id, req.user);
  else
    assert(
      can(req.user, "documents") &&
        (req.user.internal || doc.organization_id === req.user.organization_id),
      404,
      "Document not found.",
    );
  await audit(
    db,
    req.user,
    "document_downloaded",
    "documents",
    doc,
    undefined,
    doc.category,
  );
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  await sendStoredFile(res, doc.storage_key, doc.mime_type, doc.name);
});
documentsRouter.get("/:id", async (req, res) => {
  const doc = await db("documents")
    .where({ id: uuid.parse(req.params.id) })
    .first();
  assert(doc, 404, "Document not found.");
  if (doc.record_id) await accessibleRecord(doc.record_id, req.user);
  else
    assert(
      can(req.user, "documents") &&
        (req.user.internal || doc.organization_id === req.user.organization_id),
      404,
      "Document not found.",
    );
  res.json(cleanDocument(doc));
});
documentsRouter.get(
  "/:id/extractions",
  permit("documents", "review"),
  async (req, res) => {
    assert(
      req.user.internal && can(req.user, "verification", "review"),
      403,
      "Only the verification team can view compliance extraction reviews.",
    );
    const doc = await db("documents")
      .where({ id: uuid.parse(req.params.id), record_id: null })
      .first();
    assert(doc, 404, "Company document not found.");
    const organization = await db("organizations")
      .where({ id: doc.organization_id })
      .first();
    const rows = await db("document_extractions")
      .where({ document_id: doc.id })
      .orderBy("created_at", "desc")
      .limit(20);
    const items = [];
    for (const row of rows) {
      const result = parseJson(row.result);
      const reviews = await db("document_extraction_reviews")
        .where({ extraction_id: row.id })
        .orderBy("created_at", "desc");
      items.push({
        ...row,
        result: {
          ...result,
          identity: result.identity || emptyIdentity(),
          validation: validateExtraction(
            result.identity || emptyIdentity(),
            doc,
            organization,
          ),
        },
        reviews: reviews.map((review) => ({
          ...review,
          fields: parseJson(review.fields),
          validation: parseJson(review.validation, []),
        })),
      });
    }
    res.json({ items, documentStatus: doc.status });
  },
);
documentsRouter.post(
  "/:id/review",
  permit("documents", "review"),
  async (req, res) => {
    assert(
      req.user.internal && can(req.user, "verification", "review"),
      403,
      "Only the verification team can review documents.",
    );
    const id = uuid.parse(req.params.id),
      data = z
        .object({
          status: z.enum(["under_review", "approved", "rejected"]),
          note: z.string().trim().max(2000).default(""),
          extraction: extractionReviewSchema.optional(),
        })
        .parse(req.body);
    if (data.status === "rejected")
      assert(
        data.note.length >= 5,
        422,
        "Give the organization a reason for rejection.",
      );
    await db.transaction(async (k) => {
      let query = k("documents").where({ id, record_id: null });
      if (db.client.config.client === "pg") query = query.forUpdate();
      const doc = await query.first();
      assert(doc, 404, "Company document not found.");
      assert(
        !(await k("documents").where({ previous_id: id }).first()),
        422,
        "Review the latest version of this document.",
      );
      if (data.status === "approved")
        assert(
          !doc.expires_at || doc.expires_at >= now().slice(0, 10),
          422,
          "An expired document cannot be approved.",
        );
      assert(
        doc.status !== data.status || Boolean(data.extraction),
        409,
        "This document already has that status.",
      );
      if (data.extraction)
        await recordExtractionReview(
          k,
          doc,
          req.user,
          data.extraction,
          data.status,
          data.note,
        );
      await k("documents").where({ id }).update({
        status: data.status,
        review_note: data.note,
        reviewed_by: req.user.id,
        updated_at: now(),
      });
      await audit(
        k,
        req.user,
        "document_reviewed",
        "documents",
        doc,
        data.status,
        data.note,
      );
      await notifyOrganizations(
        k,
        [doc.organization_id],
        `Document ${data.status.replaceAll("_", " ")}`,
        `${doc.category}${data.note ? `: ${data.note}` : " has been reviewed."}`,
        "/app/documents",
        "documents",
      );
    });
    res.json(cleanDocument(await db("documents").where({ id }).first()));
  },
);
