import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse as parseCsv } from "csv-parse/sync";
import { demoAccounts, demoPassword } from "../shared/demo.js";
import {
  organizationTypes,
  type Module,
  type WorkRecord,
} from "../shared/domain.js";
import { calculate } from "../server/money.js";
import { enterpriseCases } from "./enterprise.cases.js";
import { authCases } from "./auth.cases.js";
import { runtimeCases } from "./runtime.cases.js";
import { analyticsCases } from "./analytics.cases.js";
import { complianceCases } from "./compliance.cases.js";
import { advancedProcurementCases } from "./advanced-procurement.cases.js";

const directory = mkdtempSync(path.join(tmpdir(), "vs-partnerhub-test-"));
process.env.NODE_ENV = "test";
process.env.DEMO_MODE = "true";
process.env.SMTP_HOST = "";
process.env.RESEND_API_KEY = "";
process.env.GEMINI_API_KEY = "";
process.env.SQLITE_PATH = path.join(directory, "test.sqlite");
process.env.UPLOAD_DIR = path.join(directory, "uploads");
if (process.env.TEST_DATABASE_URL)
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
else process.env.DATABASE_URL = ""; // Prevent dotenv from selecting a developer's real database.
let db: any,
  app: any,
  demoId: (key: string) => string,
  samplePdf: (name: string, title: string) => Buffer;
const clients: Record<
  string,
  { agent: ReturnType<typeof supertest.agent>; token: string; user: any }
> = {};
const future = (days = 30) =>
  new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const org = (key: string) => demoId(`org:${key}`);
const rid = (key: string) => demoId(`record:${key}`);
const input = (
  title: string,
  payload: Record<string, any>,
  extra: Record<string, any> = {},
) => ({
  title,
  payload,
  currency: "INR",
  items: [],
  invitations: [],
  ...extra,
});
const line = (price = 10000, quantity = 2) => ({
  name: "Enterprise monitor",
  specification: "27 inch, IPS",
  quantity,
  unit: "units",
  unit_price: price,
  tax: 18,
  discount: 5,
});
async function login(key: string) {
  const account = demoAccounts.find((a) => a.key === key)!;
  const agent = supertest.agent(app);
  const response = await agent
    .post("/api/auth/login")
    .send({ email: account.email, password: demoPassword });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return (clients[key] = {
    agent,
    token: response.body.csrfToken,
    user: response.body.user,
  });
}
async function post(key: string, route: string, body: any, expected = 200) {
  const c = clients[key];
  const r = await c.agent
    .post(`/api${route}`)
    .set("X-CSRF-Token", c.token)
    .send(body);
  expect(r.status, JSON.stringify(r.body)).toBe(expected);
  return r.body;
}
async function get(key: string, route: string, expected = 200) {
  const r = await clients[key].agent.get(`/api${route}`);
  expect(r.status, JSON.stringify(r.body)).toBe(expected);
  return r.body;
}
async function patch(key: string, route: string, body: any, expected = 200) {
  const c = clients[key];
  const r = await c.agent
    .patch(`/api${route}`)
    .set("X-CSRF-Token", c.token)
    .send(body);
  expect(r.status, JSON.stringify(r.body)).toBe(expected);
  return r.body;
}
async function transition(
  key: string,
  record: WorkRecord,
  status: string,
  expected = 200,
  note = "Reviewed and confirmed by the authorized team.",
) {
  const current = await get(key, `/records/${record.kind}/${record.id}`);
  return post(
    key,
    `/records/${record.kind}/${record.id}/transition`,
    { status, version: current.version, note },
    expected,
  );
}
async function edit(
  key: string,
  record: WorkRecord,
  payload: Record<string, any>,
  expected = 200,
) {
  const current = await get(key, `/records/${record.kind}/${record.id}`);
  return patch(
    key,
    `/records/${record.kind}/${record.id}`,
    {
      ...current,
      payload: { ...current.payload, ...payload },
      note: "Updated for workflow verification.",
    },
    expected,
  );
}

beforeAll(async () => {
  const database = await import("../server/db.js");
  db = database.db;
  if (
    process.env.TEST_DATABASE_URL &&
    (await db.schema.hasTable("organizations"))
  ) {
    throw new Error(
      "Integration tests require a new, empty PostgreSQL database. Existing application databases are never reset by the test runner.",
    );
  }
  await database.migrate();
  const seed = await import("../server/seed.js");
  demoId = seed.demoId;
  samplePdf = seed.samplePdf;
  await seed.seed();
  const express = (await import("../server/app.js")).createApp();
  // A single listening server avoids reusing a keep-alive socket while
  // Supertest closes and reopens its implicit server between requests.
  await new Promise<void>((resolve) => {
    app = express.listen(0, "127.0.0.1", resolve);
  });
  for (const key of [
    "admin",
    "buyer",
    "vendor",
    "supplier",
    "recruiter",
    "staffing",
    "service",
    "technology",
    "verification",
    "finance",
    "hr",
    "procurement",
    "management",
    "support",
    "business",
    "other",
  ])
    await login(key);
});
afterAll(async () => {
  if (app?.listening)
    await new Promise<void>((resolve, reject) =>
      app.close((error?: Error) => (error ? reject(error) : resolve())),
    );
  await db?.destroy();
  rmSync(directory, { recursive: true, force: true });
});

describe("authentication and organization isolation", () => {
  it("requires authentication and returns secure cookie attributes", async () => {
    expect((await supertest(app).get("/api/dashboard")).status).toBe(401);
    const response = await supertest(app)
      .post("/api/auth/login")
      .send({ email: "admin@vs.example", password: demoPassword });
    expect(response.headers["set-cookie"][0]).toContain("HttpOnly");
    expect(response.headers["set-cookie"][0]).toContain("SameSite=Lax");
    expect(response.body.user.password_hash).toBeUndefined();
  });
  it("requires the password and a single-use email code when sign-in verification is enabled", async () => {
    await post(
      "other",
      "/auth/mfa",
      { enabled: true, current_password: "incorrect" },
      422,
    );
    await post("other", "/auth/mfa", {
      enabled: true,
      current_password: demoPassword,
    });
    expect((await get("other", "/auth/preferences")).mfa).toBe(true);
    const agent = supertest.agent(app);
    const account = demoAccounts.find((a) => a.key === "other")!;
    const challenge = await agent
      .post("/api/auth/login")
      .send({ email: account.email, password: demoPassword });
    expect(challenge.status).toBe(200);
    expect(challenge.body.requiresOtp).toBe(true);
    expect(challenge.body.user).toBeUndefined();
    expect(challenge.headers["set-cookie"]).toBeUndefined();
    expect((await agent.get("/api/dashboard")).status).toBe(401);
    expect(
      (
        await agent
          .post("/api/auth/verify-login")
          .send({ challengeId: challenge.body.challengeId, code: "000000" })
      ).status,
    ).toBe(422);
    const body = {
      challengeId: challenge.body.challengeId,
      code: challenge.body.verificationCode,
    };
    const verified = await agent.post("/api/auth/verify-login").send(body);
    expect(verified.status).toBe(200);
    expect(verified.body.user.email).toBe(account.email);
    expect(
      (await supertest(app).post("/api/auth/verify-login").send(body)).status,
    ).toBe(422);
    const old = clients.other;
    clients.other = {
      agent,
      token: verified.body.csrfToken,
      user: verified.body.user,
    };
    await post("other", "/auth/mfa", {
      enabled: false,
      current_password: demoPassword,
    });
    expect((await old.agent.get("/api/dashboard")).status).toBe(401);
    expect((await get("other", "/auth/preferences")).mfa).toBe(false);
    await login("other");
  });
  it("limits sign-in code attempts and invalidates pending codes when security settings change", async () => {
    await post("other", "/auth/mfa", {
      enabled: true,
      current_password: demoPassword,
    });
    const account = demoAccounts.find((a) => a.key === "other")!;
    const challenge = await supertest(app)
      .post("/api/auth/login")
      .send({ email: account.email, password: demoPassword });
    for (let attempt = 0; attempt < 5; attempt++) {
      expect(
        (
          await supertest(app)
            .post("/api/auth/verify-login")
            .send({ challengeId: challenge.body.challengeId, code: "000000" })
        ).status,
      ).toBe(422);
    }
    expect(
      (
        await supertest(app).post("/api/auth/verify-login").send({
          challengeId: challenge.body.challengeId,
          code: challenge.body.verificationCode,
        })
      ).status,
    ).toBe(422);
    const fresh = await supertest(app)
      .post("/api/auth/login")
      .send({ email: account.email, password: demoPassword });
    await post("other", "/auth/mfa", {
      enabled: false,
      current_password: demoPassword,
    });
    expect(
      (
        await supertest(app).post("/api/auth/verify-login").send({
          challengeId: fresh.body.challengeId,
          code: fresh.body.verificationCode,
        })
      ).status,
    ).toBe(422);
  });
  it("uses single-use password recovery links and revokes previously authenticated sessions", async () => {
    const account = demoAccounts.find((a) => a.key === "other")!;
    const existing = await supertest(app)
      .post("/api/auth/forgot-password")
      .send({ email: account.email });
    const missing = await supertest(app)
      .post("/api/auth/forgot-password")
      .send({ email: "unregistered@example.test" });
    expect(existing.body).toEqual(missing.body);
    const message = await db("email_outbox")
      .where({
        to_address: account.email,
        subject: "Reset your VS PartnerHub password",
      })
      .orderBy("created_at", "desc")
      .first();
    const token = message.body.match(/token=([a-f0-9]{64})/)[1];
    const changed = "RecoveryPassword2026!";
    const reset = await supertest(app)
      .post("/api/auth/reset-password")
      .send({ token, password: changed });
    expect(reset.status).toBe(200);
    expect((await clients.other.agent.get("/api/dashboard")).status).toBe(401);
    expect(
      (
        await supertest(app)
          .post("/api/auth/reset-password")
          .send({ token, password: demoPassword })
      ).status,
    ).toBe(422);
    expect(
      (
        await supertest(app)
          .post("/api/auth/login")
          .send({ email: account.email, password: demoPassword })
      ).status,
    ).toBe(401);
    const agent = supertest.agent(app);
    const signedIn = await agent
      .post("/api/auth/login")
      .send({ email: account.email, password: changed });
    expect(signedIn.status).toBe(200);
    clients.other = {
      agent,
      token: signedIn.body.csrfToken,
      user: signedIn.body.user,
    };
    const restored = await post("other", "/auth/change-password", {
      current_password: changed,
      password: demoPassword,
    });
    clients.other.token = restored.csrfToken;
    await get("other", "/dashboard");
  });
  it("rejects missing CSRF tokens and cross-origin mutations", async () => {
    const c = clients.admin;
    expect(
      (await c.agent.post("/api/notifications/read-all").send({})).status,
    ).toBe(403);
    expect(
      (
        await c.agent
          .post("/api/notifications/read-all")
          .set("X-CSRF-Token", c.token)
          .set("Origin", "https://untrusted.example")
          .send({})
      ).status,
    ).toBe(403);
  });
  it("supports every organization type and every internal role dashboard", async () => {
    for (const [key, c] of Object.entries(clients)) {
      const dashboard = await get(key, "/dashboard");
      expect(Array.isArray(dashboard.metrics)).toBe(true);
      expect(c.user.internal).toBe(!c.user.organization_id);
    }
  });
  it("isolates supplier transactions and company KYC from unrelated organizations", async () => {
    await get("supplier", `/records/orders/${rid("po:chairs")}`);
    await get("supplier", `/records/orders/${rid("po:network")}`, 404);
    expect(
      (
        await clients.supplier.agent.get(
          `/api/documents/${demoId("doc:vendor:PAN")}/download`,
        )
      ).status,
    ).toBe(404);
    const list = await get("supplier", "/records/orders");
    expect(
      list.items.every(
        (r: any) =>
          r.partner_org_id === org("supplier") ||
          r.buyer_org_id === org("supplier"),
      ),
    ).toBe(true);
  });
  it("keeps finance, hiring and administrative roles separated", async () => {
    await get("support", "/records/invoices", 403);
    await get("verification", "/records/candidates", 403);
    await get("vendor", "/admin/roles", 403);
    await get("supplier", "/organizations", 403);
    await post(
      "management",
      "/records/payments",
      input("Invalid payment", {}),
      403,
    );
  });
  it("only exposes verified public business profiles through discovery", async () => {
    const list = await get("buyer", "/organizations?discovery=true&limit=100");
    expect(list.items.every((o: any) => o.status === "active")).toBe(true);
    const profile = await get("buyer", `/organizations/${org("vendor")}`);
    expect(profile.details.pan).toBeUndefined();
    expect(profile.contact_email).toBeUndefined();
    expect(profile.details.capabilities).toBeTruthy();
    await get("buyer", `/organizations/${org("p1")}`, 404);
  });
  it("searches public business fields without exposing private KYC through search matches", async () => {
    const vendor = await db("organizations")
      .where({ id: org("vendor") })
      .first();
    const details = JSON.parse(vendor.details);
    await db("organizations")
      .where({ id: vendor.id })
      .update({
        details: JSON.stringify({
          ...details,
          verification_note: "private-kyc-sentinel",
        }),
      });
    try {
      const search = await get(
        "buyer",
        "/organizations?discovery=true&q=nExOrA",
      );
      expect(search.items.some((o: any) => o.id === vendor.id)).toBe(true);
      expect(
        (
          await get(
            "buyer",
            "/organizations?discovery=true&q=private-kyc-sentinel",
          )
        ).total,
      ).toBe(0);
      expect(
        (
          await get(
            "buyer",
            "/organizations?discovery=true&certification=private-kyc-sentinel",
          )
        ).total,
      ).toBe(0);
      const global = await get("buyer", "/search?q=pRoCeSs");
      expect(
        global.records.some((r: any) => /Process improvement/i.test(r.title)),
      ).toBe(true);
    } finally {
      await db("organizations")
        .where({ id: vendor.id })
        .update({ details: vendor.details });
    }
  });
  it("exports exactly the directory filters, including public capabilities and business identifiers", async () => {
    const vendor = await db("organizations")
      .where({ id: org("vendor") })
      .first();
    const details = JSON.parse(vendor.details);
    await db("organizations")
      .where({ id: vendor.id })
      .update({
        trade_name: "Directory QA Trade Alias",
        industry: "Manufacturing",
        country: "Directory QA Country",
        details: JSON.stringify({
          ...details,
          locations: "Directory QA Coverage",
          delivery_locations: "Directory QA Delivery",
          certifications: "Directory QA Certificate",
          technologies: "Directory QA Technology",
          products: "Directory QA Product",
          services: "Directory QA Service",
          capabilities: "Directory QA Capability",
          naics: "334513",
          sic: "3823",
          company_type: "Directory QA Business Type",
          verification_note: "Directory QA Private KYC",
        }),
      });
    const filters = [
      { q: "directory qa trade alias" },
      { location: vendor.city },
      { location: "Directory QA Country" },
      { location: "Directory QA Coverage" },
      { location: "Directory QA Delivery" },
      { category: "Manufacturing" },
      { certification: "Directory QA Certificate" },
      { technology: "Directory QA Technology" },
      { product: "Directory QA Product" },
      { service: "Directory QA Service" },
      { capability: "Directory QA Capability" },
      { naics: "334513" },
      { sic: "3823" },
      { business_type: "Directory QA Business Type" },
      {
        type: "vendor",
        status: "active",
        location: vendor.city,
        capability: "Directory QA Capability",
      },
    ];
    try {
      for (const filter of filters) {
        const query = new URLSearchParams(
          filter as Record<string, string>,
        ).toString();
        const list = await get("admin", `/organizations?limit=100&${query}`);
        expect(
          list.items.map((row: any) => row.id),
          query,
        ).toContain(vendor.id);
        const response = await clients.admin.agent.get(
          `/api/admin/organizations-export?limit=1&page=2&${query}`,
        );
        expect(response.status, response.text).toBe(200);
        const exported = parseCsv(response.text, { columns: true, bom: true });
        expect(exported.map((row: any) => row.Reference).sort(), query).toEqual(
          list.items.map((row: any) => row.number).sort(),
        );
        expect(response.text).not.toContain("Directory QA Private KYC");
      }
      for (const filter of [
        { q: "Directory QA Private KYC" },
        { capability: "Directory QA Private KYC" },
        {
          capability: "Directory QA Capability",
          location: "No matching location",
        },
      ]) {
        const query = new URLSearchParams(
          filter as Record<string, string>,
        ).toString();
        expect((await get("admin", `/organizations?${query}`)).total).toBe(0);
        const response = await clients.admin.agent.get(
          `/api/admin/organizations-export?${query}`,
        );
        expect(response.status).toBe(200);
        expect(parseCsv(response.text, { columns: true, bom: true })).toEqual(
          [],
        );
      }
      const discovered = await get(
        "buyer",
        "/organizations?discovery=true&capability=Directory%20QA%20Capability",
      );
      expect(discovered.items.map((row: any) => row.id)).toEqual([vendor.id]);
      expect(discovered.items[0].details.verification_note).toBeUndefined();
      await get(
        "buyer",
        "/admin/organizations-export?capability=Directory%20QA%20Capability",
        403,
      );
      for (const route of ["/organizations", "/admin/organizations-export"]) {
        await get("admin", `${route}?capability=${"x".repeat(151)}`, 422);
        await get("admin", `${route}?location=one&location=two`, 422);
      }
    } finally {
      await db("organizations").where({ id: vendor.id }).update({
        trade_name: vendor.trade_name,
        industry: vendor.industry,
        country: vendor.country,
        details: vendor.details,
      });
    }
  });
  it("prevents external organizations from escalating a colleague to a VS role", async () => {
    await post(
      "vendor",
      "/admin/team/invite",
      {
        name: "Untrusted Admin",
        email: "escalation@test.example",
        role: "super_admin",
      },
      403,
    );
    await post(
      "vendor",
      `/organizations/${org("vendor")}/status`,
      { status: "active" },
      403,
    );
  });
});

describe("dynamic registration, verification and private documents", () => {
  let newPartner: {
    agent: ReturnType<typeof supertest.agent>;
    token: string;
    user: any;
    code: string;
  };
  function registration(type: string, suffix = type) {
    return {
      name: "New Partner Admin",
      email: `${suffix}@onboarding.example`,
      password: "SecurePartner2026!",
      accept_terms: true,
      organization: {
        type,
        legal_name: `${type} Verification Company`,
        trade_name: "Verification Company",
        industry: "Information Technology",
        city: "Hyderabad",
        country: "India",
        website: "https://example.com",
        contact_name: "New Partner Admin",
        contact_email: `${suffix}@onboarding.example`,
        contact_phone: "+91 98765 43210",
        details: {
          company_type: "Private Limited",
          contact_role: "Authorized Representative",
          description: "Verified test company offering enterprise services.",
          capabilities: "Enterprise delivery and support",
          locations: "Hyderabad, Bengaluru",
          services: "Technology consulting",
          products: "Enterprise equipment",
          domains: "Information Technology",
          recruiters: "Recruiter Team",
          hiring_types: ["Permanent Hiring"],
          procurement_categories: "Information Technology",
          technologies: "Cloud and SaaS",
          integrations: "REST APIs",
          pricing_model: "Project",
          lead_time: "7 days",
          delivery_locations: "Pan India",
        },
      },
    };
  }
  it("creates all nine organization types with their relevant business information", async () => {
    for (const type of organizationTypes) {
      const agent = supertest.agent(app);
      const response = await agent
        .post("/api/auth/register")
        .send(registration(type));
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      expect(response.body.user.organization.type).toBe(type);
      expect(response.body.user.role).toBe("org_admin");
      expect(response.body.user.organization.status).toBe("registered");
      if (type === "vendor")
        newPartner = {
          agent,
          token: response.body.csrfToken,
          user: response.body.user,
          code: response.body.verificationCode,
        };
    }
  });
  it("validates organization-specific registration information", async () => {
    const data = registration("recruitment", "missing-domain");
    data.organization.details.domains = "";
    expect(
      (await supertest(app).post("/api/auth/register").send(data)).status,
    ).toBe(422);
  });
  it("requires company identity and a contact role for every organization type before creating an account", async () => {
    for (const type of organizationTypes) {
      for (const value of [undefined, ""]) {
        const data = registration(type, `missing-identity-${type}`);
        const details: Record<string, unknown> = {
          ...data.organization.details,
        };
        details.company_type = value;
        details.contact_role = value;
        const response = await supertest(app)
          .post("/api/auth/register")
          .send({ ...data, organization: { ...data.organization, details } });
        expect(response.status, JSON.stringify(response.body)).toBe(422);
        const fields = response.body.details.map((issue: any) => issue.field);
        // Invalid enum values may prevent object-level refinement; missing values
        // must identify both omitted fields explicitly.
        expect(fields).toContain("organization.details.contact_role");
        if (value === undefined)
          expect(fields).toContain("organization.details.company_type");
        expect(
          await db("users").where({ email: data.email }).first(),
        ).toBeUndefined();
        expect(
          await db("organizations")
            .where({ contact_email: data.email })
            .first(),
        ).toBeUndefined();
      }
      const data = registration(type, `blank-company-type-${type}`);
      data.organization.details.company_type = "   ";
      const response = await supertest(app)
        .post("/api/auth/register")
        .send(data);
      expect(response.status).toBe(422);
      expect(response.body.details).toContainEqual({
        field: "organization.details.company_type",
        message: "Select your company type.",
      });
    }
  });
  it("rejects invalid primary phone numbers without creating an organization", async () => {
    for (const phone of [
      "-------",
      "123456",
      "+1234567890123456",
      "call-me-now",
    ]) {
      const data = registration("supplier", "invalid-phone");
      data.organization.contact_phone = phone;
      const response = await supertest(app)
        .post("/api/auth/register")
        .send(data);
      expect(response.status, phone).toBe(422);
      expect(
        response.body.details.some(
          (issue: any) => issue.field === "organization.contact_phone",
        ),
      ).toBe(true);
    }
    expect(
      await db("users")
        .where({ email: "invalid-phone@onboarding.example" })
        .first(),
    ).toBeUndefined();
    expect(
      await db("organizations")
        .where({ contact_email: "invalid-phone@onboarding.example" })
        .first(),
    ).toBeUndefined();
  });
  it("does not permit transactions before email and VS verification", async () => {
    expect(
      (
        await newPartner.agent
          .post("/api/records/catalog")
          .set("X-CSRF-Token", newPartner.token)
          .send(input("Unverified item", { sku: "NO-ACCESS" }))
      ).status,
    ).toBe(403);
    await post(
      "verification",
      `/organizations/${newPartner.user.organization_id}/status`,
      { status: "active", note: "Attempted premature approval." },
      422,
    );
  });
  it("rejects incorrect verification codes and consumes valid codes once", async () => {
    expect(
      (
        await newPartner.agent
          .post("/api/auth/verify")
          .set("X-CSRF-Token", newPartner.token)
          .send({ code: "000000" })
      ).status,
    ).toBe(422);
    const verified = await newPartner.agent
      .post("/api/auth/verify")
      .set("X-CSRF-Token", newPartner.token)
      .send({ code: newPartner.code });
    expect(verified.status).toBe(200);
    expect(verified.body.user.email_verified).toBe(true);
    expect(
      (
        await newPartner.agent
          .post("/api/auth/verify")
          .set("X-CSRF-Token", newPartner.token)
          .send({ code: newPartner.code })
      ).status,
    ).toBe(422);
  });
  it("validates file contents and prevents cross-organization upload", async () => {
    const invalid = await newPartner.agent
      .post("/api/documents")
      .set("X-CSRF-Token", newPartner.token)
      .field("category", "PAN")
      .attach("file", Buffer.from("<script>alert(1)</script>"), {
        filename: "forged.pdf",
        contentType: "application/pdf",
      });
    expect(invalid.status).toBe(422);
    const cross = await newPartner.agent
      .post("/api/documents")
      .set("X-CSRF-Token", newPartner.token)
      .field("category", "PAN")
      .field("organization_id", org("vendor"))
      .attach("file", samplePdf("Company", "PAN"), {
        filename: "pan.pdf",
        contentType: "application/pdf",
      });
    expect(cross.status).toBe(403);
  });
  it("requires approved documents, then permits company activation", async () => {
    for (const category of ["PAN", "Incorporation"]) {
      const r = await newPartner.agent
        .post("/api/documents")
        .set("X-CSRF-Token", newPartner.token)
        .field("category", category)
        .attach("file", samplePdf("Company", category), {
          filename: `${category}.pdf`,
          contentType: "application/pdf",
        });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.storage_key).toBeUndefined();
      await post("verification", `/documents/${r.body.id}/review`, {
        status: "approved",
        note: "Verified against the company identity.",
      });
    }
    const active = await post(
      "verification",
      `/organizations/${newPartner.user.organization_id}/status`,
      {
        status: "active",
        note: "Company identity and required documents verified.",
      },
    );
    expect(active.status).toBe("active");
    const item = await newPartner.agent
      .post("/api/records/catalog")
      .set("X-CSRF-Token", newPartner.token)
      .send(
        input("Verified service", {
          item_type: "Service",
          sku: "SERVICE-01",
          unit: "hour",
          price: 2500,
        }),
      );
    expect(item.status, JSON.stringify(item.body)).toBe(201);
  });
  it("returns legal-identity changes to verification and audits the change", async () => {
    const response = await newPartner.agent.get(
      `/api/organizations/${newPartner.user.organization_id}`,
    );
    const {
      type,
      legal_name,
      trade_name,
      industry,
      city,
      country,
      website,
      contact_name,
      contact_email,
      contact_phone,
      details,
    } = response.body;
    const result = await newPartner.agent
      .patch(`/api/organizations/${newPartner.user.organization_id}`)
      .set("X-CSRF-Token", newPartner.token)
      .send({
        type,
        legal_name: `${legal_name} Updated`,
        trade_name,
        industry,
        city,
        country,
        website,
        contact_name,
        contact_email,
        contact_phone,
        details,
      });
    expect(result.status).toBe(200);
    expect(result.body.status).toBe("under_review");
    const audit = await db("audit_logs")
      .where({
        record_id: newPartner.user.organization_id,
        action: "legal_identity_updated",
      })
      .first();
    expect(audit).toBeTruthy();
  });
});

describe("connected procurement lifecycle and accounting invariants", () => {
  let rfq: WorkRecord,
    quotation: WorkRecord,
    order: WorkRecord,
    delivery: WorkRecord,
    invoice: WorkRecord;
  it("creates a requirement and publishes an RFQ to selected verified partners", async () => {
    const requirement = await post(
      "buyer",
      "/records/requirements",
      input("Integration test workstation need", {
        requirement_type: "procurement",
        required_date: future(40),
        deadline: future(20),
        category: "Information Technology",
        description: "Two enterprise monitors",
        location: "Bengaluru",
      }),
      201,
    );
    await transition("buyer", requirement, "open");
    rfq = await post(
      "buyer",
      "/records/rfqs",
      input(
        "Integration test RFQ",
        {
          deadline: future(20),
          required_date: future(40),
          delivery_address: "Acme Campus, Bengaluru",
        },
        {
          parent_id: requirement.id,
          items: [line(0)],
          invitations: [org("vendor"), org("supplier")],
        },
      ),
      201,
    );
    await get("vendor", `/records/rfqs/${rfq.id}`, 404);
    rfq = await transition("buyer", rfq, "published");
    await get("vendor", `/records/rfqs/${rfq.id}`);
    await get("technology", `/records/rfqs/${rfq.id}`, 404);
  });
  it("rejects altered RFQ quantities and calculates commercial totals on the server", async () => {
    const data = input(
      "Complete commercial proposal",
      {
        delivery_date: future(30),
        validity: future(45),
        payment_terms: "Net 30",
        delivery_charges: 50,
        warranty: "24 months",
      },
      { parent_id: rfq.id, items: [line(10000, 3)] },
    );
    await post("vendor", "/records/quotations", data, 422);
    data.items = [line()];
    quotation = await post("vendor", "/records/quotations", data, 201);
    expect(quotation.amount_minor).toBe(2247000); // 20,000 - 5% + 18% tax + 50 delivery.
    await post("vendor", "/records/quotations", data, 409);
    await get("buyer", `/records/quotations/${quotation.id}`, 404);
    quotation = await transition("vendor", quotation, "submitted");
  });
  it("limits comparison and quotation approval to authorized buyers", async () => {
    await get("vendor", `/records/rfqs/${rfq.id}/compare`, 403);
    const comparison = await get("buyer", `/records/rfqs/${rfq.id}/compare`);
    expect(
      comparison.quotations.some((q: WorkRecord) => q.id === quotation.id),
    ).toBe(true);
    await transition("vendor", quotation, "approved", 403);
    quotation = await transition("buyer", quotation, "approved");
    expect((await get("buyer", `/records/rfqs/${rfq.id}`)).status).toBe(
      "awarded",
    );
  });
  it("copies approved commercials to the PO and enforces optimistic concurrency", async () => {
    order = await post(
      "buyer",
      "/records/orders",
      input(
        "Order for approved monitors",
        {
          delivery_date: future(30),
          delivery_address: "Acme Campus, Bengaluru",
          payment_terms: "Net 30",
          delivery_charges: 999999,
        },
        { parent_id: quotation.id, items: [line(1)] },
      ),
      201,
    );
    expect(order.amount_minor).toBe(quotation.amount_minor);
    expect(order.payload.delivery_charges).toBe(50);
    const stale = order;
    order = await transition("buyer", order, "pending_approval");
    await post(
      "buyer",
      `/records/orders/${order.id}/transition`,
      { status: "approved", version: stale.version },
      409,
    );
    order = await transition("buyer", order, "approved");
    order = await transition("buyer", order, "sent");
    order = await transition("vendor", order, "acknowledged");
    await transition("buyer", order, "fulfilled", 422);
  });
  it("confirms delivery before the supplier can invoice the order", async () => {
    await post(
      "vendor",
      "/records/invoices",
      input(
        "Premature invoice",
        {
          invoice_number: "TEST-EARLY",
          invoice_date: future(0),
          due_date: future(30),
        },
        { parent_id: order.id },
      ),
      422,
    );
    delivery = await post(
      "vendor",
      "/records/deliveries",
      input(
        "Monitor delivery",
        {
          carrier: "Test Logistics",
          tracking_number: "TEST-DEL-100",
          expected_date: future(5),
        },
        { parent_id: order.id },
      ),
      201,
    );
    delivery = await transition("vendor", delivery, "dispatched");
    delivery = await transition("vendor", delivery, "in_transit");
    delivery = await transition("vendor", delivery, "delivered");
    await transition("vendor", delivery, "confirmed", 403);
    await transition("buyer", delivery, "confirmed", 422);
    delivery = await post(
      "buyer",
      `/records/deliveries/${delivery.id}/transition`,
      {
        status: "confirmed",
        version: delivery.version,
        note: "All delivered monitors inspected and accepted.",
        receipt: {
          reference: "TEST-GRN-100",
          received_date: future(0),
          lines: order.items!.map((item) => ({
            order_item_id: item.id,
            accepted_quantity: item.quantity,
            rejected_quantity: 0,
          })),
        },
      },
    );
    expect((await get("buyer", `/records/orders/${order.id}`)).status).toBe(
      "fulfilled",
    );
    invoice = await post(
      "vendor",
      "/records/invoices",
      input(
        "Monitor invoice",
        {
          invoice_number: "TEST-INV-100",
          invoice_date: future(0),
          due_date: future(30),
          delivery_charges: 50,
        },
        {
          parent_id: order.id,
          items: order.items!.map((item) => ({
            ...item,
            source_item_id: item.id,
          })),
        },
      ),
      201,
    );
    expect(invoice.amount_minor).toBe(order.amount_minor);
    await post(
      "vendor",
      "/records/invoices",
      input(
        "Duplicate invoice",
        {
          invoice_number: "TEST-INV-101",
          invoice_date: future(0),
          due_date: future(30),
        },
        { parent_id: order.id },
      ),
      409,
    );
    invoice = await transition("vendor", invoice, "submitted");
    invoice = await transition("finance", invoice, "under_review");
    invoice = await transition("finance", invoice, "approved");
  });
  it("supports partial payments without early closure or overpayment", async () => {
    const half = invoice.amount_minor / 200;
    await post(
      "vendor",
      "/records/payments",
      input(
        "Unauthorized transfer",
        {
          amount: half,
          reference: "REF-INVALID",
          transaction_id: "TX-INVALID",
          payment_date: future(0),
        },
        { parent_id: invoice.id },
      ),
      403,
    );
    const payment = await post(
      "buyer",
      "/records/payments",
      input(
        "First installment",
        {
          amount: half,
          reference: "REF-HALF-1",
          transaction_id: "TEST-TX-1",
          payment_date: future(0),
        },
        { parent_id: invoice.id },
      ),
      201,
    );
    await transition("finance", payment, "completed");
    const partial = await get("buyer", `/records/invoices/${invoice.id}`);
    expect(partial.status).toBe("approved");
    expect(partial.outstanding_minor).toBe(invoice.amount_minor / 2);
    await post(
      "buyer",
      "/records/payments",
      input(
        "Overpayment",
        {
          amount: half + 1,
          reference: "REF-OVER",
          transaction_id: "TEST-TX-OVER",
          payment_date: future(0),
        },
        { parent_id: invoice.id },
      ),
      422,
    );
    const final = await post(
      "buyer",
      "/records/payments",
      input(
        "Final installment",
        {
          amount: half,
          reference: "REF-HALF-2",
          transaction_id: "TEST-TX-2",
          payment_date: future(0),
        },
        { parent_id: invoice.id },
      ),
      201,
    );
    await transition("finance", final, "completed");
    const paid = await get("buyer", `/records/invoices/${invoice.id}`);
    expect(paid.status).toBe("paid");
    expect(paid.outstanding_minor).toBe(0);
    const trail = await get("buyer", `/records/invoices/${invoice.id}/history`);
    expect(
      trail.events.some(
        (a: any) => a.new_status === "paid" && a.previous_status === "approved",
      ),
    ).toBe(true);
  });
  it("reserves pending payment amounts atomically across concurrent requests", async () => {
    const outstanding = (
      await get("buyer", `/records/invoices/${rid("invoice:chairs")}`)
    ).outstanding_minor;
    const c = clients.buyer;
    const responses = await Promise.all(
      [1, 2].map((i) =>
        c.agent
          .post("/api/records/payments")
          .set("X-CSRF-Token", c.token)
          .send(
            input(
              `Concurrent payment ${i}`,
              {
                amount: outstanding / 100,
                reference: `REF-CONCURRENT-${i}`,
                transaction_id: `TEST-CONCURRENT-${i}`,
                payment_date: future(0),
              },
              { parent_id: rid("invoice:chairs") },
            ),
          ),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 422]);
  });
  it("keeps money calculations deterministic including fractional quantities and tax", () => {
    expect(calculate([{ ...line(0.1, 3), tax: 0, discount: 0 }]).total).toBe(
      30,
    );
    expect(
      calculate([{ ...line(19.99, 1.5), tax: 18, discount: 10 }]).total,
    ).toBe(3185);
  });
  it("respects a zero approval threshold and requires a second authorized PO approver", async () => {
    const settings = JSON.parse(
      (await db("settings").where({ key: "platform" }).first()).value,
    );
    await patch("admin", "/admin/settings", {
      ...settings,
      approvalThreshold: 0,
    });
    try {
      const order = await get("admin", `/records/orders/${rid("po:supplies")}`);
      await transition("admin", order, "approved", 422);
      expect((await transition("procurement", order, "approved")).status).toBe(
        "approved",
      );
    } finally {
      await patch("admin", "/admin/settings", settings);
    }
  });
  it("scopes normalized SKU uniqueness to the owning organization", async () => {
    const data = input("Unique catalog fixture", {
      item_type: "Product",
      sku: "CASE-SKU-01",
      unit: "unit",
      price: 100,
    });
    await post("vendor", "/records/catalog", data, 201);
    await post(
      "vendor",
      "/records/catalog",
      { ...data, payload: { ...data.payload, sku: " case-sku-01 " } },
      409,
    );
    await post("supplier", "/records/catalog", data, 201);
  });
  it("rejects reusing a bank transaction ID on another invoice for the same buyer", async () => {
    const original = await get(
      "buyer",
      `/records/payments/${rid("payment:chairs")}`,
    );
    await post(
      "buyer",
      "/records/payments",
      input(
        "Duplicate bank reference",
        {
          amount: 1,
          reference: "Duplicate reference fixture",
          transaction_id: ` ${original.payload.transaction_id.toLowerCase()} `,
          payment_date: future(0),
        },
        { parent_id: rid("invoice:consulting") },
      ),
      409,
    );
  });
});

describe("recruitment, staffing, service and technology operations", () => {
  let candidate: WorkRecord, interview: WorkRecord;
  it("requires candidate consent and deduplicates submissions for a requirement", async () => {
    const data = input(
      "Test Candidate",
      {
        email: "candidate@consent.example",
        phone: "+91 90000 00001",
        skills: "React, TypeScript",
        experience: 6,
        notice_period: "30 days",
        availability: future(30),
        consent: false,
      },
      { parent_id: rid("hiring:fullstack") },
    );
    await post("recruiter", "/records/candidates", data, 422);
    data.payload.consent = true;
    await post(
      "recruiter",
      "/records/candidates",
      {
        ...data,
        payload: { ...data.payload, phone: "-------" },
      },
      422,
    );
    candidate = await post("recruiter", "/records/candidates", data, 201);
    expect(candidate.payload.retention_until).toBeTruthy();
    await post("recruiter", "/records/candidates", data, 409);
    await get("vendor", `/records/candidates/${candidate.id}`, 404);
    await transition("recruiter", candidate, "screening", 403);
    candidate = await transition("hr", candidate, "screening");
    candidate = await transition("hr", candidate, "shortlisted");
  });
  it("requires interview scheduling and completed feedback before selection", async () => {
    await transition("hr", candidate, "interview", 422);
    interview = await post(
      "hr",
      "/records/interviews",
      input(
        "Test technical interview",
        {
          scheduled_at: new Date(Date.now() + 86400000).toISOString(),
          duration: 60,
          interviewer: "Ananya Rao",
        },
        { parent_id: candidate.id },
      ),
      201,
    );
    candidate = await transition("hr", candidate, "interview");
    await transition("hr", candidate, "selected", 422);
    await transition("hr", interview, "completed", 422);
    interview = await edit("hr", interview, {
      feedback: "Strong technical fundamentals and communication.",
      recommendation: "Proceed",
    });
    interview = await transition("hr", interview, "completed");
    candidate = await transition("hr", candidate, "selected");
  });
  it("requires offer, BGV clearance and joining data at their respective stages", async () => {
    await transition("hr", candidate, "offer", 422);
    // Calculated retention/consent metadata is not accepted as editable payload.
    const editable = async (updates: any) => {
      const current = await get("hr", `/records/candidates/${candidate.id}`);
      const {
        retention_until: _retention,
        consent_recorded_at: _consent,
        ...payload
      } = current.payload;
      return patch("hr", `/records/candidates/${candidate.id}`, {
        ...current,
        payload: { ...payload, ...updates },
        note: "Hiring decision recorded.",
      });
    };
    candidate = await editable({
      offer_date: future(0),
      offer_compensation: 2400000,
    });
    candidate = await transition("hr", candidate, "offer");
    candidate = await transition("hr", candidate, "bgv");
    await transition("hr", candidate, "onboarding", 422);
    candidate = await editable({ bgv_status: "Clear" });
    candidate = await transition("hr", candidate, "onboarding");
    await transition("hr", candidate, "joined", 422);
    candidate = await editable({ joining_date: future(0) });
    candidate = await transition("hr", candidate, "joined");
    expect(candidate.status).toBe("joined");
  });
  it("uses active staffing engagements and prevents overlapping timesheets", async () => {
    const data = input(
      "Overlap test",
      {
        period_start: future(-6),
        period_end: future(-1),
        hours: 40,
        work_summary: "Verified work summary.",
      },
      { parent_id: rid("engagement:1") },
    );
    await post("staffing", "/records/timesheets", data, 409);
    data.payload.period_start = future(0);
    data.payload.period_end = future(6);
    const sheet = await post("staffing", "/records/timesheets", data, 201);
    await transition("staffing", sheet, "submitted");
    expect((await transition("buyer", sheet, "approved")).status).toBe(
      "approved",
    );
  });
  it("supports technology demo requests through the verified catalog", async () => {
    const lookup = await get("buyer", "/lookups?kind=demos");
    expect(lookup.parents.length).toBeGreaterThan(0);
    const record = await post(
      "buyer",
      "/records/demos",
      input(
        "Cloud platform demo",
        {
          contact_name: "Priya Sharma",
          contact_email: "buyer@acme.example",
          preferred_date: future(7),
          use_case: "Centralized cloud operations.",
        },
        { parent_id: lookup.parents[0].id },
      ),
      201,
    );
    await transition("technology", record, "scheduled", 422);
    const scheduled = await edit("technology", record, {
      scheduled_at: new Date(Date.now() + 86400000).toISOString(),
      meeting_link: "https://example.com/meeting",
    });
    expect(
      (await transition("technology", scheduled, "scheduled")).status,
    ).toBe("scheduled");
  });
  it("keeps contract amendments versioned and subject to fresh approval", async () => {
    const contract = await get(
      "buyer",
      `/records/contracts/${rid("contract:services")}`,
    );
    const renewed = await post(
      "buyer",
      `/records/contracts/${contract.id}/renew`,
      {
        end_date: future(400),
        note: "Extend the engagement with the existing commercial terms.",
        version: contract.version,
      },
    );
    expect(renewed.status).toBe("review");
    const history = await get(
      "buyer",
      `/records/contracts/${contract.id}/history`,
    );
    expect(
      history.versions.some(
        (v: any) => v.snapshot.payload.end_date === contract.payload.end_date,
      ),
    ).toBe(true);
    await transition("buyer", renewed, "approved");
    expect((await transition("buyer", renewed, "active")).status).toBe(
      "active",
    );
  });
  it("delivers support conversations only to the relevant organization and internal team", async () => {
    const ticket = await post(
      "vendor",
      "/records/tickets",
      input("Need help with a company document", {
        category: "Verification",
        priority: "normal",
        description: "Please clarify which document needs renewal.",
      }),
      201,
    );
    await post(
      "support",
      `/records/tickets/${ticket.id}/comments`,
      {
        body: "Please upload the latest certificate in your document workspace.",
      },
      201,
    );
    const comments = await get(
      "vendor",
      `/records/tickets/${ticket.id}/comments`,
    );
    expect(comments.length).toBe(1);
    await get("supplier", `/records/tickets/${ticket.id}`, 404);
    const resolved = await transition(
      "support",
      ticket,
      "resolved",
      200,
      "The requested clarification has been provided.",
    );
    expect((await transition("vendor", resolved, "closed")).status).toBe(
      "closed",
    );
  });
});

describe("administration, exports and security lifecycle", () => {
  it("finds audit records by their underlying identifier when they have no generated reference number", async () => {
    const contact = await post(
      "vendor",
      `/organizations/${org("vendor")}/contacts`,
      {
        name: "QA Audit Reference Contact",
        email: "audit-reference@qa.example",
        phone: "+91 9000000123",
        role: "Procurement",
        is_primary: false,
      },
      201,
    );
    const recordId = contact.id;
    const result = await get("admin", `/admin/audit?q=${recordId}`);
    expect(result.total).toBeGreaterThan(0);
    expect(result.items.every((row: any) => row.record_id === recordId)).toBe(
      true,
    );
    expect(result.items.some((row: any) => !row.record_number)).toBe(true);
    const filtered = await get(
      "admin",
      `/admin/audit?q=${recordId}&category=contacts`,
    );
    expect(filtered.total).toBeGreaterThan(0);
    expect(
      filtered.items.every(
        (row: any) => row.module === "contacts" && row.record_id === recordId,
      ),
    ).toBe(true);
  });
  it("creates one-time invitations and assigns only the requested external role", async () => {
    const invited = await post(
      "vendor",
      "/admin/team/invite",
      {
        name: "New Colleague",
        email: "colleague@invite.example",
        role: "org_member",
      },
      201,
    );
    const token = new URL(invited.invitationUrl).searchParams.get("token");
    const response = await supertest(app)
      .post("/api/auth/accept-invitation")
      .send({ token, password: "ColleagueSecure2026!", name: "New Colleague" });
    expect(response.status).toBe(201);
    expect(response.body.user.organization_id).toBe(org("vendor"));
    expect(response.body.user.role).toBe("org_member");
    expect(
      (
        await supertest(app).post("/api/auth/accept-invitation").send({
          token,
          password: "ColleagueSecure2026!",
          name: "New Colleague",
        })
      ).status,
    ).toBe(422);
  });
  it("protects the Super Admin role and external permission ceilings", async () => {
    await patch("admin", "/admin/roles/super_admin", { permissions: {} }, 403);
    await patch(
      "admin",
      "/admin/roles/org_member",
      { permissions: { verification: ["view", "review"] } },
      422,
    );
  });
  it("exports scoped CSV data and records export activity", async () => {
    const response = await clients.vendor.agent.get(
      "/api/records/orders/export",
    );
    expect(response.status).toBe(200);
    expect(response.type).toContain("text/csv");
    expect(response.text).toContain("Engineering workstations");
    expect(response.text).not.toContain("Cloud infrastructure & migration");
    const report = await clients.management.agent.get("/api/reports/export");
    expect(report.status).toBe(200);
    expect(report.text).toContain("Currency");
    const directory = await clients.verification.agent.get(
      "/api/admin/organizations-export",
    );
    expect(directory.status).toBe(200);
    expect(directory.text).not.toContain("pan.pdf");
    const { csv } = await import("../server/records.js");
    expect(csv([['=HYPERLINK("https://example.com")']])).toContain(
      "'=HYPERLINK",
    );
  });
  it("tracks in-app notifications and marks only the current user’s notifications read", async () => {
    const inbox = await get("vendor", "/notifications");
    expect(inbox.total).toBeGreaterThan(0);
    await post("vendor", "/notifications/read-all", {});
    expect((await get("vendor", "/notifications")).unread).toBe(0);
    expect((await get("buyer", "/notifications")).unread).toBeGreaterThan(0);
  });
  it("invalidates existing sessions on suspension and prevents suspended transactions", async () => {
    await post("admin", `/organizations/${org("other")}/status`, {
      status: "suspended",
      note: "Access suspended for the integration security check.",
    });
    await get("other", "/dashboard", 401);
    await login("other");
    await post(
      "other",
      "/records/catalog",
      input("Blocked catalog item", { sku: "SUSPENDED-1" }),
      403,
    );
    await post(
      "other",
      "/records/tickets",
      input("Suspension clarification", {
        description: "Please clarify the suspension review process.",
      }),
      201,
    );
  });
  it("uses the configured retention policy to anonymize completed candidate records and resumes", async () => {
    const record = await db("records")
      .where({ id: rid("candidate:7") })
      .first();
    const p = JSON.parse(record.payload);
    await db("records")
      .where({ id: record.id })
      .update({
        payload: JSON.stringify({
          ...p,
          retention_until: new Date(Date.now() - 86400000).toISOString(),
        }),
      });
    const { maintenance } = await import("../server/maintenance.js");
    await maintenance();
    const anonymized = await db("records").where({ id: record.id }).first();
    expect(anonymized.title).toBe("Archived candidate");
    expect(JSON.parse(anonymized.payload).email).toBeUndefined();
    expect((await db("documents").where({ record_id: record.id })).length).toBe(
      0,
    );
  });
});

enterpriseCases({
  get db() {
    return db;
  },
  get app() {
    return app;
  },
  clients,
  post,
  patch,
  get,
  input,
  line,
  org,
  rid,
  future,
  login,
  transition,
  demoId: (key: string) => demoId(key),
});

authCases({
  get db() {
    return db;
  },
  get app() {
    return app;
  },
  clients,
  post,
});

runtimeCases();

analyticsCases({
  get db() {
    return db;
  },
  get app() {
    return app;
  },
  clients,
  post,
  get,
  input,
  org,
  future,
});

complianceCases({
  get db() {
    return db;
  },
  clients,
  org,
});

advancedProcurementCases({
  get db() {
    return db;
  },
  clients,
  post,
  patch,
  get,
  input,
  line,
  org,
  rid,
  future,
  login,
  transition,
});
