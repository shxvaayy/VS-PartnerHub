import "dotenv/config";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import supertest from "supertest";
import { parse } from "csv-parse/sync";
import { PDFDocument, StandardFonts } from "pdf-lib";

const directory = await mkdtemp(
  path.join(tmpdir(), "partnerhub-file-acceptance-"),
);
const output = path.resolve("artifacts/local-verification"),
  fixtures = path.join(output, "fixtures"),
  exports = path.join(output, "exports");
await Promise.all([
  mkdir(fixtures, { recursive: true }),
  mkdir(exports, { recursive: true }),
]);
Object.assign(process.env, {
  NODE_ENV: "test",
  DEMO_MODE: "true",
  DATABASE_URL: "",
  SQLITE_PATH: path.join(directory, "files.sqlite"),
  UPLOAD_DIR: path.join(directory, "uploads"),
  SMTP_HOST: "",
  RESEND_API_KEY: "",
  GEMINI_API_KEY: "",
});
const { db, migrate } = await import("../server/db.ts");
const { seed } = await import("../server/seed.ts");
const { createApp } = await import("../server/app.ts");
const { demoAccounts, demoPassword } = await import("../shared/demo.ts");
const checks = [],
  clients = {};
const date = (offset) =>
  new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function check(name, run) {
  const started = Date.now();
  try {
    const evidence = await run();
    checks.push({
      name,
      passed: true,
      elapsedMs: Date.now() - started,
      evidence,
    });
    console.log(`PASS ${name}`);
  } catch (error) {
    checks.push({ name, passed: false, error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}
async function post(role, endpoint, body, status = 200) {
  const c = clients[role],
    result = await c.agent
      .post(`/api${endpoint}`)
      .set("X-CSRF-Token", c.token)
      .send(body)
      .timeout(15000);
  assert.equal(result.status, status, result.body.error || endpoint);
  return result.body;
}
async function upload(
  role,
  bytes,
  filename,
  mime = "application/pdf",
  expected = 201,
) {
  await writeFile(path.join(fixtures, filename), bytes);
  const c = clients[role],
    response = await c.agent
      .post("/api/documents")
      .set("X-CSRF-Token", c.token)
      .field("category", "Other")
      .attach("file", bytes, { filename, contentType: mime })
      .timeout(15000);
  assert.equal(response.status, expected, response.body.error);
  return response.body;
}
try {
  await migrate();
  await seed();
  const app = createApp();
  for (const key of [
    "admin",
    "supplier",
    "vendor",
    "buyer",
    "recruiter",
    "management",
  ]) {
    const agent = supertest.agent(app),
      account = demoAccounts.find((item) => item.key === key);
    const response = await agent
      .post("/api/auth/login")
      .send({ email: account.email, password: demoPassword })
      .timeout(15000);
    assert.equal(response.status, 200, `Sign-in failed for ${key}`);
    clients[key] = { agent, token: response.body.csrfToken };
  }
  await check(
    "Generated PDF uploads, byte-for-byte download and cross-organization denial",
    async () => {
      const pdf = await PDFDocument.create(),
        font = await pdf.embedFont(StandardFonts.Helvetica),
        page = pdf.addPage();
      [
        "VS PARTNERHUB | FILE ACCEPTANCE",
        "QA FIXTURE - NOT A LEGAL DOCUMENT",
        "Company name: QA File Verification Ltd",
        "Registration number: QA-FILE-014",
        `Expiry date: ${date(90)}`,
        "Address: 14 QA Road, Pune",
      ].forEach((text, index) =>
        page.drawText(text, { x: 40, y: 760 - index * 38, size: 14, font }),
      );
      const bytes = Buffer.from(await pdf.save()),
        document = await upload("vendor", bytes, "qa-file-upload.pdf");
      const downloaded = await clients.vendor.agent
        .get(`/api/documents/${document.id}/download`)
        .buffer(true);
      assert.equal(downloaded.status, 200);
      assert.equal(hash(downloaded.body), hash(bytes));
      assert.equal(
        (
          await clients.buyer.agent.get(
            `/api/documents/${document.id}/download`,
          )
        ).status,
        404,
      );
      assert.equal(
        (await supertest(app).get(`/api/documents/${document.id}/download`))
          .status,
        401,
      );
      assert.equal((await PDFDocument.load(downloaded.body)).getPageCount(), 1);
      return {
        filename: "qa-file-upload.pdf",
        sha256: hash(bytes),
        status: document.status,
      };
    },
  );
  await check(
    "Invalid file content and oversized PDF uploads are rejected",
    async () => {
      await upload(
        "vendor",
        Buffer.from("This is plain text, not a PDF."),
        "qa-invalid-content.pdf",
        "application/pdf",
        422,
      );
      const oversized = Buffer.alloc(10 * 1024 * 1024 + 1);
      oversized.write("%PDF-1.7");
      await upload(
        "vendor",
        oversized,
        "qa-over-10mb.pdf",
        "application/pdf",
        413,
      );
      return { rejected: ["Invalid PDF signature", "More than 10 MB"] };
    },
  );
  await check(
    "Catalog CSV preview, atomic import, replay protection and tenant isolation",
    async () => {
      const content =
        "title,sku,price,moq,tax,availability\nQA File Acceptance Switch,QA-FILE-SWITCH,1200,2,18,20\nQA File Acceptance Router,QA-FILE-ROUTER,2400,1,18,12\n";
      await writeFile(path.join(fixtures, "catalog-valid.csv"), content);
      const count = async () =>
          Number((await db("records").count({ n: "*" }).first()).n),
        before = await count();
      const preview = await post("supplier", "/imports/catalog/preview", {
        content,
      });
      assert.equal(preview.status, "ready");
      assert.equal(await count(), before);
      await post("vendor", `/imports/${preview.id}/commit`, {}, 404);
      const committed = await post(
        "supplier",
        `/imports/${preview.id}/commit`,
        {},
      );
      assert.equal(committed.records.length, 2);
      assert.equal(await count(), before + 2);
      assert.deepEqual(
        await post("supplier", `/imports/${preview.id}/commit`, {}),
        committed,
      );
      assert.equal(await count(), before + 2);
      return {
        filename: "catalog-valid.csv",
        imported: committed.records.map((row) => row.number),
      };
    },
  );
  await check(
    "Duplicate SKUs, invalid numeric values and unknown CSV columns cannot be committed",
    async () => {
      for (const [filename, content] of [
        [
          "catalog-duplicate.csv",
          "title,sku,price\nQA Duplicate A,QA-DUP-SKU,10\nQA Duplicate B,QA-DUP-SKU,20",
        ],
        [
          "catalog-invalid-number.csv",
          "title,sku,price\nQA Invalid Numeric,QA-BAD-PRICE,not-a-number",
        ],
      ]) {
        await writeFile(path.join(fixtures, filename), content);
        const preview = await post("supplier", "/imports/catalog/preview", {
          content,
        });
        assert.equal(preview.status, "invalid");
        await post("supplier", `/imports/${preview.id}/commit`, {}, 422);
      }
      const unknown = "title,secret_bank_field\nQA Unknown Header,value";
      await writeFile(
        path.join(fixtures, "catalog-unknown-column.csv"),
        unknown,
      );
      await post(
        "supplier",
        "/imports/catalog/preview",
        { content: unknown },
        422,
      );
      return { invalidCases: 3 };
    },
  );
  await check(
    "Requirement and candidate CSV templates validate and enter their correct initial workflow states",
    async () => {
      const requirements = `title,requirement_type,category,location,required_date,deadline,quantity\nQA CSV Monitor Requirement,procurement,IT Services,Pune,${date(45)},${date(10)},12`;
      await writeFile(
        path.join(fixtures, "requirements-valid.csv"),
        requirements,
      );
      const hiring = (
        await clients.recruiter.agent.get("/api/records/requirements?limit=100")
      ).body.items.find(
        (row) =>
          row.payload.requirement_type === "hiring" && row.status === "open",
      );
      assert(
        hiring,
        "An authorized open hiring requirement is needed for the test.",
      );
      const candidates = `title,parent_id,email,phone,skills,experience,location,notice_period,availability,consent\nQA CSV Candidate,${hiring.id},candidate@qa.example,+919000000001,TypeScript,5,Pune,30 days,${date(30)},true`;
      await writeFile(path.join(fixtures, "candidates-valid.csv"), candidates);
      for (const [role, kind, content] of [
        ["buyer", "requirements", requirements],
        ["recruiter", "candidates", candidates],
      ]) {
        const template = await clients[role].agent.get(
          `/api/imports/${kind}/template`,
        );
        assert.equal(template.status, 200);
        await writeFile(
          path.join(exports, `${kind}-template.csv`),
          template.text,
        );
        const preview = await post(role, `/imports/${kind}/preview`, {
          content,
        });
        assert.equal(preview.status, "ready", JSON.stringify(preview.results));
        const committed = await post(role, `/imports/${preview.id}/commit`, {});
        assert.equal(committed.records.length, 1);
        const saved = await db("records")
          .where({ id: committed.records[0].id })
          .first();
        assert.equal(
          saved.status,
          kind === "candidates" ? "submitted" : "draft",
        );
      }
      return {
        requirementStatus: "draft",
        candidateStatus: "submitted",
        templates: ["requirements-template.csv", "candidates-template.csv"],
      };
    },
  );
  await check(
    "Record exports contain only authorized rows and neutralize spreadsheet formulas",
    async () => {
      const content = "title,sku,price\n=QA(1),QA-FORMULA-EXPORT,10";
      await writeFile(
        path.join(fixtures, "catalog-formula-title.csv"),
        content,
      );
      const preview = await post("supplier", "/imports/catalog/preview", {
        content,
      });
      assert.equal(preview.status, "ready");
      await post("supplier", `/imports/${preview.id}/commit`, {});
      const catalog = await clients.supplier.agent.get(
        "/api/records/catalog/export",
      );
      assert.equal(catalog.status, 200);
      const rows = parse(catalog.text, { columns: true, bom: true });
      assert(rows.some((row) => row.Title === "'=QA(1)"));
      await writeFile(path.join(exports, "supplier-catalog.csv"), catalog.text);
      const orders = await clients.vendor.agent.get(
        "/api/records/orders/export",
      );
      assert.equal(orders.status, 200);
      assert(orders.text.includes("Engineering workstations"));
      assert(!orders.text.includes("Cloud infrastructure & migration"));
      await writeFile(path.join(exports, "vendor-orders.csv"), orders.text);
      return { catalogRows: rows.length, spreadsheetFormulaNeutralized: true };
    },
  );
  await check(
    "Management CSV totals reconcile to stored counts and amounts by currency",
    async () => {
      const report = await clients.management.agent.get("/api/reports/export");
      assert.equal(report.status, 200);
      await writeFile(path.join(exports, "management-report.csv"), report.text);
      const rows = parse(report.text, { columns: true, bom: true });
      assert(rows.length > 0);
      for (const row of rows) {
        const current = await db("records")
          .where({
            kind: row.Module,
            status: row.Status,
            currency: row.Currency,
          })
          .count({ count: "*" })
          .sum({ amount: "amount_minor" })
          .first();
        assert.equal(Number(row.Count), Number(current.count));
        assert.equal(Number(row["Total amount"]), Number(current.amount) / 100);
      }
      assert(
        Number(
          (
            await db("audit_logs")
              .where({ action: "report_exported" })
              .count({ n: "*" })
              .first()
          ).n,
        ) > 0,
      );
      return {
        filename: "management-report.csv",
        reconciledGroups: rows.length,
      };
    },
  );
} finally {
  await writeFile(
    path.join(output, "files-report.json"),
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        isolatedFixtures: true,
        externalServicesUsed: false,
        checks,
      },
      null,
      2,
    ),
  );
  console.log(
    `File acceptance: ${checks.filter((check) => check.passed).length}/${checks.length} passed. Files: ${fixtures}`,
  );
  await db.destroy();
  await rm(directory, { recursive: true, force: true });
}
