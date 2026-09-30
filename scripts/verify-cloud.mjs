import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "dotenv";
import { PDFDocument, StandardFonts } from "pdf-lib";

// Uses real private Blob storage, but all accounts/records live in an isolated
// disposable local database. No production company/account data is changed.
const secrets = parse(
  await readFile(process.env.CLOUD_ENV_FILE || ".env.production.local"),
);
assert.ok(
  secrets.BLOB_READ_WRITE_TOKEN,
  "Private Blob credentials are required.",
);
const directory = await mkdtemp(path.join(tmpdir(), "partnerhub-cloud-qa-"));
Object.assign(process.env, {
  NODE_ENV: "test",
  VERCEL: "",
  DEMO_MODE: "false",
  DATABASE_URL: "",
  DATABASE_SSL: "false",
  FILE_STORAGE: "blob",
  BLOB_READ_WRITE_TOKEN: secrets.BLOB_READ_WRITE_TOKEN,
  SQLITE_PATH: path.join(directory, "qa.sqlite"),
  UPLOAD_DIR: path.join(directory, "uploads"),
  SESSION_SECRET: randomBytes(32).toString("hex"),
  INTEGRATION_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  GEMINI_API_KEY: "",
  SMTP_HOST: "",
  RESEND_API_KEY: "",
  APP_URL: "http://localhost:5173",
});
const { db, migrate, now } = await import("../server/db.ts");
const { ensureInternalOrganization } = await import("../server/seed.ts");
const { hashPassword } = await import("../server/security.ts");
const { readStoredFile, deleteStoredFile } =
  await import("../server/storage.ts");
const { createApp } = await import("../server/app.ts");
const { put: clientPut } = await import("@vercel/blob/client");
const { head } = await import("@vercel/blob");
const cloudKeys = new Set();
const results = [];
const reportPath = "artifacts/local-verification/cloud-storage-report.json";
let server, base;
const password = `CloudQA${randomBytes(20).toString("hex")}1!`;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function check(name, task) {
  const started = Date.now();
  try {
    await task();
    results.push({ name, passed: true, milliseconds: Date.now() - started });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
    throw error;
  }
}
async function request(
  account,
  route,
  body,
  method = body === undefined ? "GET" : "POST",
) {
  const response = await fetch(base + "/api" + route, {
    method,
    headers: {
      ...(account
        ? { Cookie: account.cookie, "X-CSRF-Token": account.csrfToken }
        : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  return { status: response.status, data, response };
}
async function account(label) {
  const orgId = randomUUID(),
    userId = randomUUID(),
    email = `cloud-${label}@qa.example.test`;
  await db("organizations").insert({
    id: orgId,
    number: `QA-${label}`,
    type: "vendor",
    legal_name: `Cloud Storage QA ${label}`,
    trade_name: "",
    industry: "Technology",
    city: "Pune",
    country: "India",
    website: "",
    status: "active",
    contact_name: "Cloud QA",
    contact_email: email,
    contact_phone: "+919000000010",
    details: "{}",
    created_at: now(),
    updated_at: now(),
  });
  await db("users").insert({
    id: userId,
    organization_id: orgId,
    name: `Cloud QA ${label}`,
    email,
    password_hash: await hashPassword(password),
    role: "org_admin",
    email_verified: true,
    active: true,
    created_at: now(),
    updated_at: now(),
  });
  const login = await request(null, "/auth/login", { email, password });
  assert.equal(login.status, 200);
  return {
    userId,
    orgId,
    csrfToken: login.data.csrfToken,
    cookie: login.response.headers.get("set-cookie").split(";")[0],
  };
}
async function ticket(account, bytes, extra = {}) {
  const response = await request(account, "/documents/uploads", {
    document: { category: "Incorporation", ...extra },
    file: {
      name: "Cloud-storage-QA.pdf",
      type: "application/pdf",
      size: bytes.length,
    },
  });
  if (response.data.pathname) cloudKeys.add(response.data.pathname);
  return response;
}
async function upload(t, bytes) {
  await clientPut(t.pathname, bytes, {
    access: "private",
    token: t.token,
    contentType: "application/pdf",
  });
}
try {
  await migrate();
  await ensureInternalOrganization();
  server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const owner = await account("owner"),
    stranger = await account("stranger");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf
    .addPage()
    .drawText(
      "CLOUD STORAGE QA - NO LEGAL VALIDITY\nCompany name: Storage QA\nCertificate type: Incorporation",
      { x: 40, y: 740, size: 12, font },
    );
  await pdf.attach(randomBytes(5 * 1024 * 1024), "QA-random-payload.bin", {
    description:
      "Random data used only to verify a PDF larger than the function request limit.",
  });
  const bytes = Buffer.from(await pdf.save());
  assert.ok(
    bytes.length > 4.5 * 1024 * 1024 && bytes.length < 10 * 1024 * 1024,
  );
  let t, document;
  await check("Unauthenticated upload preparation is rejected", async () => {
    assert.equal((await ticket(null, bytes)).status, 401);
  });
  await check(
    "A partner cannot request upload access for another organization",
    async () => {
      assert.equal(
        (await ticket(owner, bytes, { organization_id: stranger.orgId }))
          .status,
        403,
      );
    },
  );
  await check(
    "Files above 10 MB are rejected before issuing storage access",
    async () => {
      const r = await request(owner, "/documents/uploads", {
        document: { category: "PAN" },
        file: {
          name: "oversize.pdf",
          type: "application/pdf",
          size: 10 * 1024 * 1024 + 1,
        },
      });
      assert.equal(r.status, 422);
      assert.equal(r.data.token, undefined);
    },
  );
  await check(
    "A scoped upload token sends a real PDF above 4.5 MB directly to private storage",
    async () => {
      const r = await ticket(owner, bytes);
      assert.equal(r.status, 201, JSON.stringify(r.data));
      assert.equal(r.data.transport, "direct");
      t = r.data;
      await upload(t, bytes);
      const stored = await head(t.pathname, {
        token: secrets.BLOB_READ_WRITE_TOKEN,
      });
      assert.equal(stored.size, bytes.length);
    },
  );
  await check(
    "The private blob cannot be downloaded without authentication",
    async () => {
      const stored = await head(t.pathname, {
        token: secrets.BLOB_READ_WRITE_TOKEN,
      });
      const response = await fetch(stored.url);
      await response.arrayBuffer();
      assert.ok([403, 404].includes(response.status));
    },
  );
  await check(
    "The upload token cannot overwrite the file or write a different pathname",
    async () => {
      await assert.rejects(() => upload(t, bytes));
      await assert.rejects(() =>
        clientPut(`pending-${randomUUID()}.pdf`, bytes, {
          access: "private",
          token: t.token,
          contentType: "application/pdf",
        }),
      );
      assert.equal(sha256(await readStoredFile(t.pathname)), sha256(bytes));
    },
  );
  await check("Only the upload owner can finalize its ticket", async () => {
    assert.equal(
      (await request(stranger, `/documents/uploads/${t.id}/complete`, {}))
        .status,
      404,
    );
  });
  await check(
    "Server validation creates an immutable document without exposing its private key",
    async () => {
      const r = await request(owner, `/documents/uploads/${t.id}/complete`, {
        url: "https://example.invalid/untrusted.pdf",
      });
      assert.equal(r.status, 201, JSON.stringify(r.data));
      assert.equal(r.data.storage_key, undefined);
      assert.equal(r.data.size, bytes.length);
      document = r.data;
      const stored = await db("documents").where({ id: document.id }).first();
      cloudKeys.add(stored.storage_key);
      assert.notEqual(stored.storage_key, t.pathname);
      assert.equal(
        sha256(await readStoredFile(stored.storage_key)),
        sha256(bytes),
      );
    },
  );
  await check(
    "A repeated completion request returns the same document without duplication",
    async () => {
      const r = await request(owner, `/documents/uploads/${t.id}/complete`, {});
      assert.equal(r.status, 200);
      assert.equal(r.data.id, document.id);
      assert.equal(
        Number((await db("documents").count({ count: "*" }).first()).count),
        1,
      );
    },
  );
  await check(
    "Authenticated large-PDF download preserves its exact bytes",
    async () => {
      const r = await fetch(`${base}/api/documents/${document.id}/download`, {
        headers: { Cookie: owner.cookie },
      });
      assert.equal(r.status, 200);
      assert.match(r.headers.get("cache-control"), /no-store/);
      assert.equal(sha256(Buffer.from(await r.arrayBuffer())), sha256(bytes));
    },
  );
  await check(
    "A different organization cannot read or download the document",
    async () => {
      assert.equal(
        (await request(stranger, `/documents/${document.id}`)).status,
        404,
      );
      assert.equal(
        (await request(stranger, `/documents/${document.id}/download`)).status,
        404,
      );
    },
  );
  await check(
    "A renamed non-PDF is rejected after upload and never becomes a document",
    async () => {
      const invalid = Buffer.from(
        "This is not a PDF even when declared as application/pdf.",
      );
      const r = await ticket(owner, invalid);
      assert.equal(r.status, 201);
      await upload(r.data, invalid);
      const finalized = await request(
        owner,
        `/documents/uploads/${r.data.id}/complete`,
        {},
      );
      assert.equal(finalized.status, 422);
      assert.equal(
        Number((await db("documents").count({ count: "*" }).first()).count),
        1,
      );
    },
  );
  await check(
    "Expired tickets and CSRF-invalid requests cannot finalize uploads",
    async () => {
      const r = await ticket(owner, bytes);
      await db("document_uploads")
        .where({ id: r.data.id })
        .update({ expires_at: new Date(Date.now() - 1000).toISOString() });
      assert.equal(
        (await request(owner, `/documents/uploads/${r.data.id}/complete`, {}))
          .status,
        410,
      );
      assert.equal(
        (
          await request(
            { ...owner, csrfToken: "invalid" },
            `/documents/uploads/${t.id}/complete`,
            {},
          )
        ).status,
        403,
      );
    },
  );
  await check("Files remain readable after the API restarts", async () => {
    await new Promise((resolve) => server.close(resolve));
    server = createApp().listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(
      `${base}/api/documents/${document.id}/download`,
      { headers: { Cookie: owner.cookie } },
    );
    assert.equal(response.status, 200);
    assert.equal(
      sha256(Buffer.from(await response.arrayBuffer())),
      sha256(bytes),
    );
  });
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  for (const doc of await db("documents")
    .select("storage_key")
    .catch(() => []))
    cloudKeys.add(doc.storage_key);
  const cleanup = await Promise.allSettled(
    [...cloudKeys].map((key) => deleteStoredFile(key)),
  );
  const cleaned = cleanup.every((r) => r.status === "fulfilled");
  await db.destroy();
  await rm(directory, { recursive: true, force: true });
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        scope: "Real private cloud storage; isolated local account database",
        productionAccountsChanged: false,
        passed: results.filter((r) => r.passed).length,
        failed: results.filter((r) => !r.passed).length,
        cloudTestObjectsRemoved: cleaned,
        results,
      },
      null,
      2,
    ),
  );
  assert.ok(cleaned, "Cloud test-object cleanup needs attention.");
}
