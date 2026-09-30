import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import supertest from "supertest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { chromium } from "@playwright/test";

// Real provider calls, isolated and explicitly labelled acceptance data. This
// script never sends email, resets the review database or prints credentials.
if (!process.env.GEMINI_API_KEY)
  throw new Error("Set GEMINI_API_KEY securely before live verification.");
const directory = await mkdtemp(path.join(tmpdir(), "partnerhub-live-ai-"));
Object.assign(process.env, {
  NODE_ENV: "test",
  DEMO_MODE: "true",
  DATABASE_URL: "",
  SQLITE_PATH: path.join(directory, "test.sqlite"),
  UPLOAD_DIR: path.join(directory, "uploads"),
  GEMINI_TEST_URL: "",
  SMTP_HOST: "",
  RESEND_API_KEY: "",
});
const { db, migrate } = await import("../server/db.ts");
const { seed, demoId } = await import("../server/seed.ts");
const { createApp } = await import("../server/app.ts");
const { demoAccounts, demoPassword } = await import("../shared/demo.ts");
const { identityLabels } = await import("../shared/ai.ts");
const { calculate } = await import("../server/money.ts");
const checks = [],
  clients = {};
const fixtureDirectory = path.resolve("artifacts/local-verification/fixtures");
const selected = new Set(
  (process.env.GEMINI_VERIFY_CHECKS || "").split(",").filter(Boolean),
);
const date = (days) =>
  new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const org = (name) => demoId(`org:${name}`);
const last = (response) =>
  response.messages?.findLast((message) => message.role === "assistant");
const countCalls = async () =>
  Number((await db("ai_requests").count({ n: "*" }).first()).n);
const english = (text) => {
  assert(
    !/[\u0900-\u097f]/u.test(text),
    "A user-facing narrative must be in English.",
  );
  assert(
    !/\b(aap|aapke|tumhare|hoon|hain|bhai|kijiye|sakta|sakti)\b/i.test(text),
    "The answer must not mirror Hinglish.",
  );
};
let browser;
// Acceptance exercises many independent tasks in one burst. Pace only this QA
// runner to respect free-tier project limits; application requests are unchanged.
const providerInterval = Number(process.env.GEMINI_VERIFY_INTERVAL_MS ?? 5500);
let providerReadyAt = 0,
  providerWaitMs = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  if (!String(args[0]).includes("generativelanguage.googleapis.com"))
    return realFetch(...args);
  const delay = Math.max(0, providerReadyAt - Date.now());
  if (delay) {
    const started = Date.now();
    await new Promise((resolve) => setTimeout(resolve, delay));
    providerWaitMs += Date.now() - started;
  }
  providerReadyAt = Date.now() + providerInterval;
  const response = await realFetch(...args);
  if (process.env.GEMINI_VERIFY_DIAGNOSTICS === "true" && !response.ok) {
    const details = await response
      .clone()
      .json()
      .catch(() => ({}));
    const message = String(
      details.error?.message || "No provider detail",
    ).replaceAll(process.env.GEMINI_API_KEY || "<no-key>", "[redacted]");
    console.error(
      "Live acceptance provider diagnostic:",
      message.slice(0, 1800),
    );
  }
  return response;
};
async function request(role, endpoint, body, expected = 200) {
  const client = clients[role];
  const result = await client.agent
    .post(`/api${endpoint}`)
    .set("X-CSRF-Token", client.token)
    .send(body)
    .timeout({ response: 105000, deadline: 110000 });
  assert.equal(
    result.status,
    expected,
    `${endpoint}: ${result.status} ${result.body.error || "Unexpected response"}`,
  );
  return result.body;
}
async function ai(role, endpoint, input, label, verify = () => {}) {
  const started = Date.now(),
    calls = await countCalls(),
    previousWait = providerWaitMs;
  const entry = { feature: label, passed: false, input };
  checks.push(entry);
  try {
    const result = await request(role, `/ai/${endpoint}`, input);
    const message = last(result);
    Object.assign(entry, {
      elapsedMs: Date.now() - started - (providerWaitMs - previousWait),
      wallTimeMs: Date.now() - started,
      acceptancePacingMs: providerWaitMs - previousWait,
      providerRequests: (await countCalls()) - calls,
      output: message
        ? {
            answer: message.content,
            structured: message.structured,
            sources: message.sources,
          }
        : result,
      model: result.model || message?.model,
    });
    english(message?.content || result.result.summary);
    if (message)
      assert(
        !/\/app(?:[/?]|$)|\bmode=(document|draft|comparison|discovery|alerts)/.test(
          message.content,
        ),
        "Internal routes must not appear in the assistant narrative.",
      );
    for (const warning of message?.structured.warnings ||
      result.result?.warnings ||
      [])
      english(warning);
    await verify(result, entry);
    entry.passed = true;
    console.log(
      `PASS ${label} (${entry.elapsedMs} ms; ${entry.providerRequests} provider requests)`,
    );
    return result;
  } catch (error) {
    entry.error = error.message;
    throw error;
  }
}
async function scenario(name, run) {
  if (selected.size && !selected.has(name)) return;
  try {
    await run();
  } catch (error) {
    checks.push({ feature: name, passed: false, error: error.message });
    process.exitCode = 1;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}
async function upload(
  role,
  bytes,
  filename,
  mime = "application/pdf",
  fields = {},
) {
  await mkdir(fixtureDirectory, { recursive: true });
  await writeFile(path.join(fixtureDirectory, path.basename(filename)), bytes);
  const client = clients[role];
  let call = client.agent
    .post("/api/documents")
    .set("X-CSRF-Token", client.token)
    .field("category", "Other");
  for (const [key, value] of Object.entries(fields))
    call = call.field(key, value);
  const result = await call.attach("file", bytes, {
    filename,
    contentType: mime,
  });
  assert.equal(result.status, 201, result.body.error);
  return result.body;
}
async function certificatePdf(identity) {
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica),
    page = pdf.addPage([650, 880]);
  [
    "QA ACCEPTANCE FIXTURE - NOT A LEGAL DOCUMENT",
    ...Object.keys(identityLabels).map(
      (key) => `${identityLabels[key]}: ${identity[key]}`,
    ),
  ].forEach((text, i) =>
    page.drawText(text, { x: 30, y: 820 - i * 37, size: 12, font }),
  );
  return Buffer.from(await pdf.save());
}
function identityCheck(result, expected) {
  assert.equal(Object.keys(result.result.identity).length, 8);
  for (const [key, value] of Object.entries(expected))
    assert.equal(
      result.result.identity[key]?.replace(/\s+/g, " ").trim(),
      value,
      `Incorrect ${key}`,
    );
  assert.equal(result.reviewStatus, "pending_human_review");
  assert.equal(result.documentStatus, "uploaded");
}
try {
  console.log("Preparing isolated live-provider acceptance data…");
  await migrate();
  await seed();
  const app = createApp();
  for (const key of [
    "admin",
    "buyer",
    "vendor",
    "supplier",
    "procurement",
    "hr",
    "verification",
  ]) {
    const agent = supertest.agent(app),
      account = demoAccounts.find((account) => account.key === key);
    const login = await agent
      .post("/api/auth/login")
      .send({ email: account.email, password: demoPassword })
      .timeout({ response: 15000, deadline: 20000 });
    assert.equal(login.status, 200, `Fixture sign-in failed: ${key}`);
    clients[key] = {
      agent,
      token: login.body.csrfToken,
      user: login.body.user,
    };
  }
  console.log("Acceptance accounts ready. Testing live AI responses…");
  const identity = {
    company_name: "QA Document Intelligence Ltd",
    gst: "27ABCDE1234F1Z5",
    pan: "ABCDE1234F",
    cin: "L12345MH2020PLC123456",
    registration_number: "QA-REG-2026-071",
    expiry_date: date(180),
    certificate_type: "Registration certificate",
    address: "22 QA Road, Pune, Maharashtra 411001",
  };
  const group = await db("records")
    .where({ kind: "quotations", buyer_org_id: org("buyer") })
    .whereNot("status", "draft")
    .select("parent_id")
    .count({ n: "*" })
    .groupBy("parent_id")
    .orderBy("n", "desc")
    .first();

  await scenario("chat", async () => {
    const response = await clients.buyer.agent.get(
      "/api/records/rfqs?limit=100",
    );
    const pending = response.body.items.filter((row) =>
      ["published", "evaluation"].includes(row.status),
    );
    let conversation = await ai(
      "buyer",
      "chat",
      { message: "Show me pending RFQs." },
      "A: current RFQs without a provider call",
      (result, meta) => {
        assert.equal(meta.providerRequests, 0);
        assert.equal(
          last(result).structured.lookupResults.records[0].total,
          pending.length,
        );
      },
    );
    const secondRfq =
      last(conversation).structured.lookupResults.records[0].items[1];
    conversation = await ai(
      "buyer",
      "chat",
      {
        message:
          "For the second RFQ in that list, what exactly is required and in what quantities?",
        conversationId: conversation.conversationId,
      },
      "A: natural follow-up retrieves current line items",
      (result) => {
        const retrieved = last(result).structured.lookupResults.records.flatMap(
          (group) => group.items,
        );
        const target = retrieved.find((record) => record.id === secondRfq.id);
        assert(
          target?.recordDetails?.items.length > 0,
          "Follow-up did not retrieve line items for the second displayed RFQ.",
        );
        for (const item of target.recordDetails.items)
          assert(
            last(result).content.includes(String(item.quantity)),
            "A line-item quantity was omitted.",
          );
      },
    );
    for (const message of [
      "hi bro what all can u do for me",
      "i said what can u doooo?",
      "Could you give me a quick tour of ways you can help our operations?",
      "मेरे लंबित RFQ दिखाओ, लेकिन जवाब हिंदी में दो।",
    ]) {
      conversation = await ai(
        "buyer",
        "chat",
        { message, conversationId: conversation.conversationId },
        `A: varied input / English output: ${message}`,
        (result) => {
          if (message.includes("RFQ"))
            assert.equal(
              last(result).structured.retrieval.records[0].total,
              pending.length,
            );
          else {
            assert(/document/i.test(last(result).content));
            assert.equal(
              last(result).structured.actions.length,
              6,
              "Every enabled AI task needs a named action.",
            );
            assert(/draft|requirement/i.test(last(result).content));
            assert(
              pending.every(
                (row) => !last(result).content.includes(row.number),
              ),
              "Capability answer repeated a previous RFQ report.",
            );
          }
        },
      );
    }
    for (const message of [
      "What is the capital of Japan?",
      "blorp zzzz 741 ??",
    ]) {
      conversation = await ai(
        "buyer",
        "chat",
        { message, conversationId: conversation.conversationId },
        `A: topic change: ${message}`,
        (result) => {
          const output = last(result);
          assert.equal(output.structured.retrieval.records.length, 0);
          if (message.includes("Japan")) assert(/Tokyo/i.test(output.content));
          assert(
            output.content.length < 2200,
            "Unrelated input caused an unsolicited workspace report.",
          );
        },
      );
    }
    const invoice = await db("records")
      .where({
        kind: "invoices",
        buyer_org_id: org("buyer"),
        status: "approved",
      })
      .first();
    const paid = Number(
      (
        await db("records")
          .where({
            kind: "payments",
            parent_id: invoice.id,
            status: "completed",
          })
          .sum({ total: "amount_minor" })
          .first()
      ).total || 0,
    );
    await ai(
      "buyer",
      "chat",
      {
        message:
          "Explain this invoice's current status and outstanding amount, including recorded completed payments.",
        recordIds: [invoice.id],
      },
      "A: selected invoice and settlement evidence",
      (result) => {
        assert(last(result).sources.some((source) => source.id === invoice.id));
        const number = ((invoice.amount_minor - paid) / 100).toFixed(2);
        assert(
          last(result).content.replaceAll(",", "").includes(number) ||
            last(result)
              .content.replaceAll(",", "")
              .includes(String(Number(number))),
          "Outstanding amount not explained.",
        );
      },
    );
  });

  await scenario("long-pdf", async () => {
    const pdf = await PDFDocument.create();
    for (let index = 0; index < 60; index++) {
      const page = pdf.addPage([650, 880]);
      for (let line = 0; line < 22; line++)
        page.drawText(
          `QA handbook section ${index + 1}.${line + 1}. Consult the original source before acting on extracted information.`,
          { x: 25, y: 830 - line * 24, size: 9 },
        );
    }
    const certificate = await PDFDocument.load(await certificatePdf(identity));
    for (const page of await pdf.copyPages(certificate, [0])) pdf.addPage(page);
    const doc = await upload(
      "vendor",
      Buffer.from(await pdf.save()),
      "qa-61-page-handbook.pdf",
    );
    await ai(
      "vendor",
      "extract-document",
      { documentId: doc.id },
      "B: long PDF with identity fields on page 61",
      (output) => {
        identityCheck(output, identity);
        assert.equal(output.result.preparation.pageCount, 61);
        assert.equal(output.result.preparation.method, "pdf_text");
        assert.equal(output.result.preparation.analysisComplete, false);
        assert(output.result.text.length > 60000);
        assert(output.result.text.includes("section 32.22"));
      },
    );
    await ai(
      "vendor",
      "chat",
      {
        documentId: doc.id,
        message:
          "What registration number is printed near the end of this handbook?",
      },
      "B: long-document follow-up finds late-page evidence",
      (output) => {
        assert(last(output).content.includes(identity.registration_number));
      },
    );
  });

  await scenario("pdf-ocr", async () => {
    const doc = await upload(
      "vendor",
      await certificatePdf(identity),
      "qa-native-certificate.pdf",
    );
    const result = await ai(
      "vendor",
      "extract-document",
      { documentId: doc.id },
      "B: eight fields from readable PDF",
      (output) => {
        identityCheck(output, identity);
        assert.equal(output.result.preparation.method, "pdf_text");
        assert(output.result.text.includes(identity.pan));
      },
    );
    await ai(
      "vendor",
      "extract-document",
      { documentId: doc.id },
      "B: unchanged document reuse",
      (output, meta) => {
        assert.equal(meta.providerRequests, 0);
        assert.equal(output.id, result.id);
      },
    );
    await ai(
      "vendor",
      "chat",
      {
        message:
          "What is the registration number and expiry date on this file, and is it approved? Please answer in Hindi.",
        documentId: doc.id,
      },
      "B: document follow-up stays factual and English",
      (output) => {
        assert(last(output).content.includes(identity.registration_number));
        assert(!/has been approved|is approved by/i.test(last(output).content));
        assert.equal(last(output).structured.documentContext.id, doc.id);
      },
    );
    const decision = {
      status: "approved",
      note: "Isolated QA certificate inspected against its source. Fixture identifiers differ from the seeded organization and are not statutory verification.",
      extraction: {
        extractionId: result.id,
        fields: result.result.identity,
        sourceConfirmed: true,
      },
    };
    await request("vendor", `/documents/${doc.id}/review`, decision, 403);
    await request(
      "verification",
      `/documents/${doc.id}/review`,
      {
        ...decision,
        extraction: { ...decision.extraction, sourceConfirmed: false },
      },
      422,
    );
    assert.equal(
      (await request("verification", `/documents/${doc.id}/review`, decision))
        .status,
      "approved",
    );
    const reviewed = await clients.vendor.agent.get(
      `/api/ai/extractions/${result.id}`,
    );
    assert.equal(reviewed.body.reviewStatus, "reviewed");
    assert.equal(reviewed.body.reviews[0].source_digest, result.sourceDigest);
    checks.push({
      feature: "B: human review required; approval and source digest persisted",
      passed: true,
    });
  });

  await scenario("image-ocr", async () => {
    browser ||= await chromium.launch({
      ...(process.env.CI ? {} : { channel: "chrome" }),
      headless: true,
    });
    const page = await browser.newPage({
      viewport: { width: 1100, height: 880 },
    });
    await page.setContent(
      `<main style="padding:35px;background:white;color:black;font:24px Arial"><h2>QA FIXTURE — NOT A LEGAL DOCUMENT</h2>${Object.keys(
        identityLabels,
      )
        .map((key) => `<p>${identityLabels[key]}: ${identity[key]}</p>`)
        .join("")}</main>`,
    );
    const png = await page.screenshot();
    await page.close();
    const image = await upload(
      "supplier",
      png,
      "qa-scanned-certificate.png",
      "image/png",
    );
    await ai(
      "supplier",
      "extract-document",
      { documentId: image.id },
      "B: actual image OCR",
      (output) => identityCheck(output, identity),
    );
    const pdf = await PDFDocument.create(),
      embedded = await pdf.embedPng(png),
      sheet = pdf.addPage([1100, 880]);
    sheet.drawImage(embedded, { x: 0, y: 0, width: 1100, height: 880 });
    const scanned = await upload(
      "supplier",
      Buffer.from(await pdf.save()),
      "qa-scanned-certificate.pdf",
    );
    await ai(
      "supplier",
      "extract-document",
      { documentId: scanned.id },
      "B: scanned PDF OCR",
      (output) => {
        identityCheck(output, identity);
        assert.equal(output.result.preparation.method, "scanned_pdf_ocr");
      },
    );
    pdf
      .insertPage(0, [650, 880])
      .drawText(
        "QA COVER PAGE - The scanned certificate follows. Consult the original source for human review.",
        { x: 25, y: 800, size: 10 },
      );
    pdf
      .addPage([650, 880])
      .drawText(
        "QA END PAGE - Supporting record ENDCOVER-903. This fixture is not a legal document.",
        { x: 25, y: 800, size: 10 },
      );
    const mixed = await upload(
      "supplier",
      Buffer.from(await pdf.save()),
      "qa-mixed-text-and-scan.pdf",
    );
    await ai(
      "supplier",
      "extract-document",
      { documentId: mixed.id },
      "B: mixed PDF reads native pages and isolates scanned-page OCR",
      (output) => {
        identityCheck(output, identity);
        assert.equal(output.result.preparation.pageCount, 3);
        assert.equal(output.result.preparation.scannedPages, 1);
        assert(output.result.text.includes("ENDCOVER-903"));
      },
    );
    const partial = await PDFDocument.create(),
      sheet2 = partial.addPage();
    sheet2.drawText(
      "QA PRODUCT NOTE - Network switch; SKU QA-SWITCH-24P; quantity 24 units",
      { x: 25, y: 760, size: 12 },
    );
    const missing = await upload(
      "supplier",
      Buffer.from(await partial.save()),
      "qa-product-missing-identity.pdf",
    );
    await ai(
      "supplier",
      "extract-document",
      { documentId: missing.id },
      "B: absent identity values remain null",
      (output) => {
        for (const key of ["company_name", "gst", "pan", "cin", "expiry_date"])
          assert.equal(output.result.identity[key], null);
      },
    );
  });

  await scenario("draft-requirement", async () => {
    const brief = `We need 12 enterprise monitors, 27 inch IPS with HDMI, delivered in Pune by ${date(45)}. Draft this procurement requirement and flag missing commercial details.`;
    const before = Number((await db("records").count({ n: "*" }).first()).n);
    const result = await ai(
      "procurement",
      "draft-requirement",
      { brief },
      "C: structured procurement draft",
      (output) => {
        const draft = last(output).structured.draft;
        assert(draft.items.some((item) => item.quantity === 12));
        assert.equal(draft.payload.required_date, date(45));
        assert.equal(draft.payload.location, "Pune");
        assert(last(output).structured.warnings.length > 0);
        for (const item of draft.items) {
          assert.equal(item.unit_price, 0);
          assert.equal(item.tax, 0);
          assert.equal(item.discount, 0);
        }
      },
    );
    assert.equal(
      Number((await db("records").count({ n: "*" }).first()).n),
      before,
    );
    await ai(
      "procurement",
      "draft-requirement",
      { brief },
      "C: identical reviewed analysis reuse",
      (output, meta) => {
        assert.equal(meta.providerRequests, 0);
        assert.equal(last(output).structured.engine, "saved_analysis");
      },
    );
    const draft = last(result).structured.draft;
    const saved = await request(
      "procurement",
      "/records/requirements",
      {
        title: draft.title,
        payload: {
          ...draft.payload,
          category: "IT Services",
          deadline: date(7),
        },
        items: draft.items,
        currency: "INR",
        invitations: [],
      },
      201,
    );
    assert.equal(saved.status, "draft");
    checks.push({
      feature: "C: authorized save creates a draft only after review",
      passed: true,
      record: saved.number,
    });
  });
  await scenario("hiring-draft", async () => {
    await ai(
      "hr",
      "draft-requirement",
      {
        brief: `Pune ke liye 4 React aur TypeScript developers chahiye, experience 5 to 7 years. Remote team, joining by ${date(30)}. Budget abhi confirm nahi hai.`,
      },
      "C: Hinglish hiring brief to English structured draft",
      (output) => {
        const draft = last(output).structured.draft;
        english(draft.title);
        english(draft.payload.description);
        assert.equal(draft.payload.requirement_type, "hiring");
        assert.equal(draft.payload.positions, 4);
        assert(/React/i.test(draft.payload.skills));
        assert(
          /TypeScript/i.test(draft.payload.technology + draft.payload.skills),
        );
        assert(/5.*7/.test(draft.payload.experience));
        assert(/remote/i.test(draft.payload.delivery_requirements));
        assert.equal(draft.payload.budget, 0);
      },
    );
  });

  await scenario("analyze-quotations", async () => {
    const before = await db("records")
      .where({ parent_id: group.parent_id, kind: "quotations" })
      .orderBy("id")
      .select("id", "status");
    await ai(
      "buyer",
      "analyze-quotations",
      { rfqId: group.parent_id },
      "D: factual quotation comparison",
      async (output) => {
        const quotes = last(output).structured.comparison;
        assert(quotes.length >= 2);
        for (const quote of quotes) {
          const response = await clients.buyer.agent.get(
              `/api/records/quotations/${quote.id}`,
            ),
            record = response.body;
          const calculated = calculate(
            record.items,
            record.payload.delivery_charges || 0,
          );
          assert.equal(quote.total_minor, record.amount_minor);
          assert.equal(quote.tax_minor, calculated.tax);
          assert.equal(quote.discount_minor, calculated.discount);
          assert.equal(quote.warranty, record.payload.warranty || null);
          assert.equal(
            quote.payment_terms,
            record.payload.payment_terms || null,
          );
        }
      },
    );
    await ai(
      "buyer",
      "analyze-quotations",
      { rfqId: group.parent_id },
      "D: unchanged comparison reuse",
      (output, meta) => assert.equal(meta.providerRequests, 0),
    );
    assert.deepEqual(
      await db("records")
        .where({ parent_id: group.parent_id, kind: "quotations" })
        .orderBy("id")
        .select("id", "status"),
      before,
    );
    await request(
      "vendor",
      "/ai/analyze-quotations",
      { rfqId: group.parent_id },
      403,
    );
    checks.push({
      feature:
        "D: no award or status changes; competitor analysis is buyer-only",
      passed: true,
    });
  });

  await scenario("discover", async () => {
    const original = await db("organizations")
      .where({ id: org("vendor") })
      .first();
    const details = {
      ...JSON.parse(original.details),
      products: "industrial controllers",
      services: "cloud integration",
      technologies: "edge AI",
      certifications: "ISO 9001",
      capabilities: "device management",
      pan: "PRIVATE-KYC-NOT-FOR-DISCOVERY",
    };
    await db("organizations")
      .where({ id: original.id })
      .update({
        industry: "QA manufacturing",
        city: "Pune",
        details: JSON.stringify(details),
      });
    const input = {
      brief:
        "Find an industrial partner using exactly these profile filters. Explain matches and any verification limits.",
      criteria: {
        industry: "QA manufacturing",
        category: "controller",
        location: "Pune",
        products: "controllers",
        services: "cloud integration",
        technology: "edge AI",
        certifications: "ISO 9001",
        capabilities: "device management",
        verification: "active",
        query: "",
        type: "",
      },
    };
    await ai(
      "buyer",
      "discover",
      input,
      "E: discovery using all nine specified business fields",
      (output) => {
        assert.equal(last(output).structured.discovery.total, 1);
        assert(
          last(output).sources.some((source) => source.id === original.id),
        );
        assert(!JSON.stringify(output).includes(details.pan));
      },
    );
    await ai(
      "buyer",
      "discover",
      input,
      "E: unchanged discovery reuse",
      (output, meta) => assert.equal(meta.providerRequests, 0),
    );
    await db("organizations")
      .where({ id: original.id })
      .update({
        details: JSON.stringify({
          ...details,
          technologies: "Legacy hardware only",
        }),
      });
    await ai(
      "buyer",
      "discover",
      input,
      "E: changed profile invalidates previous match",
      (output, meta) => {
        assert.equal(last(output).structured.discovery.total, 0);
        assert.equal(meta.providerRequests, 1);
      },
    );
  });

  await scenario("analyze-alerts", async () => {
    const vendor = await db("organizations")
        .where({ id: org("vendor") })
        .first(),
      trendId = randomUUID();
    await db("organizations").insert({
      ...vendor,
      id: trendId,
      number: `QA-TREND-${trendId.slice(0, 8)}`,
      legal_name: "QA Response Trend Partner",
    });
    async function record(kind, status, payload, days = 0, extra = {}) {
      const id = randomUUID(),
        at = `${date(days)}T12:00:00.000Z`;
      const row = {
        id,
        kind,
        number: `QA-SIGNAL-${id.slice(0, 8)}`,
        title: `QA ${kind} operational evidence`,
        owner_org_id: org("buyer"),
        buyer_org_id: org("buyer"),
        partner_org_id: org("vendor"),
        parent_id: null,
        amount_minor: 10000,
        currency: "INR",
        version: 1,
        created_by: clients.buyer.user.id,
        created_at: at,
        updated_at: at,
        status,
        payload: JSON.stringify(payload),
        ...extra,
      };
      await db("records").insert(row);
      return row;
    }
    async function event(row, status, days) {
      await db("audit_logs").insert({
        id: randomUUID(),
        actor_name: "QA lifecycle fixture",
        role: "system",
        action: "transition",
        module: row.kind,
        record_id: row.id,
        new_status: status,
        remarks: "Dated live acceptance evidence",
        created_at: `${date(days)}T12:00:00.000Z`,
      });
    }
    await upload(
      "vendor",
      await certificatePdf(identity),
      "qa-expiry-signal.pdf",
      "application/pdf",
      { expires_at: date(14) },
    );
    await record("contracts", "active", {
      end_date: date(14),
      renewal_notice_days: 30,
    });
    await record("orders", "acknowledged", { delivery_date: date(-10) });
    const invoice = await record("invoices", "approved", {
      due_date: date(-45),
    });
    await record("payments", "completed", { amount: 10 }, 0, {
      parent_id: invoice.id,
      amount_minor: 1000,
    });
    await record(
      "requirements",
      "open",
      { requirement_type: "hiring", positions: 4, required_date: date(10) },
      -45,
    );
    for (let week = 0; week < 8; week++)
      for (let i = 0; i < 2; i++)
        await record(
          "orders",
          "closed",
          { delivery_date: date(-30) },
          -62 + week * 7 + i,
          { currency: "USD", amount_minor: 10000 },
        );
    for (let i = 0; i < 12; i++)
      await record(
        "orders",
        "sent",
        { delivery_date: date(30) },
        -6 + (i % 6),
        { currency: "USD", amount_minor: i === 0 ? 100000 : 10000 },
      );
    for (const recent of [false, true])
      for (let i = 0; i < 6; i++) {
        const deadline = recent ? -15 : -45,
          rfq = await record(
            "rfqs",
            "closed",
            { deadline: date(deadline), required_date: date(10) },
            deadline - 10,
            { partner_org_id: null },
          );
        await db("record_invitations").insert({
          record_id: rfq.id,
          organization_id: trendId,
        });
        await event(rfq, "published", deadline - 10);
        if (!recent || i === 0) {
          const quote = await record(
            "quotations",
            "submitted",
            { delivery_date: date(10) },
            deadline - 5,
            {
              parent_id: rfq.id,
              owner_org_id: trendId,
              partner_org_id: trendId,
            },
          );
          await event(quote, "submitted", deadline - 5);
        }
      }
    const response = await clients.admin.agent.get("/api/insights"),
      outlook = response.body;
    for (const category of [
      "contract_expiry",
      "document_expiry",
      "delayed_delivery",
      "invoice_aging",
      "unusual_procurement",
      "recruitment_aging",
      "vendor_response",
    ])
      assert(
        outlook.alerts.some((alert) => alert.category === category),
        `Missing ${category}`,
      );
    assert(
      outlook.alerts
        .find(
          (alert) =>
            alert.category === "invoice_aging" &&
            alert.sources.some((source) => source.id === invoice.id),
        )
        .description.includes("INR 90.00"),
    );
    const before = await db("records").orderBy("id").select("id", "status");
    await ai(
      "admin",
      "analyze-alerts",
      {
        question:
          "Summarize all seven types of operational signals. Explain the recorded evidence, uncertainty and next steps without making decisions.",
      },
      "F: all seven evidence-based operational alert categories",
      (output) => {
        assert.equal(
          last(output).structured.alertSummary.totalAlerts,
          outlook.totalAlerts,
        );
      },
    );
    await ai(
      "admin",
      "analyze-alerts",
      {
        question:
          "Summarize all seven types of operational signals. Explain the recorded evidence, uncertainty and next steps without making decisions.",
      },
      "F: unchanged operational analysis reuse",
      (output, meta) => assert.equal(meta.providerRequests, 0),
    );
    assert.deepEqual(
      await db("records").orderBy("id").select("id", "status"),
      before,
    );
    checks.push({
      feature: "F: deterministic alert evidence and no business mutations",
      passed: true,
      evidence: outlook,
    });
  });
} finally {
  const output =
    process.env.GEMINI_VERIFICATION_REPORT ||
    path.join(tmpdir(), "partnerhub-gemini-verification.json");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(
    output,
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        provider: "Google Gemini live API",
        acceptanceRequestIntervalMs: providerInterval,
        isolatedFixtures: true,
        externalEmailSent: false,
        checks,
      },
      null,
      2,
    ),
  );
  console.log(
    `Live verification: ${checks.filter((check) => check.passed).length}/${checks.length} checks passed. Report: ${output}`,
  );
  await browser?.close();
  await db.destroy();
  await rm(directory, { recursive: true, force: true });
}
