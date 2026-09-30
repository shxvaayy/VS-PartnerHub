import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import supertest from "supertest";
import { parse } from "csv-parse/sync";
import { defaultPermissions, type Module } from "../shared/domain.js";
import {
  reportViews,
  type AnalyticsReport,
  type ReportViewId,
} from "../shared/analytics.js";
import { demoPassword } from "../shared/demo.js";

// The shared harness creates an isolated SQLite/PostgreSQL database. These rows
// exercise aggregation edge cases independently of the transaction workflow tests.
export function analyticsCases(h: any) {
  describe("analytics, BI exports and source permissions", () => {
    const from = "2041-06-01",
      to = "2041-06-30",
      created = `${from}T00:00:00.000Z`;
    const query = `from=${from}&to=${to}&currency=INR`;
    const ids = {
      buyer: randomUUID(),
      supplier: randomUUID(),
      otherBuyer: randomUUID(),
      otherSupplier: randomUUID(),
    };
    const records: Record<string, string> = {};
    let buyer: any, supplier: any;
    const dateAfter = (days: number) =>
      new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    const view = (r: AnalyticsReport, id: ReportViewId) =>
      r.views.find((v) => v.id === id)!;
    const metric = (r: AnalyticsReport, id: ReportViewId, key: string) =>
      view(r, id).metrics.find((m) => m.key === key)!;
    const value = (r: AnalyticsReport, id: ReportViewId, key: string) =>
      metric(r, id, key).value;
    async function report(
      client = buyer,
      filters = query,
    ): Promise<AnalyticsReport> {
      const response = await client.agent.get(
        `/api/reports/analytics?${filters}`,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return response.body;
    }
    async function insertRecord(
      key: string,
      kind: Module,
      status: string,
      payload: object = {},
      extra: object = {},
    ) {
      const id = randomUUID();
      await h.db("records").insert({
        id,
        kind,
        status,
        number: `AN-${id}`,
        title: `Analytics fixture ${key}`,
        owner_org_id: ids.buyer,
        buyer_org_id: ids.buyer,
        partner_org_id: ids.supplier,
        payload: JSON.stringify(payload),
        created_by: buyer.user.id,
        created_at: created,
        updated_at: created,
        ...extra,
      });
      records[key] = id;
      return id;
    }
    async function event(
      record: string,
      module: string,
      status: string,
      at: string,
    ) {
      await h.db("audit_logs").insert({
        id: randomUUID(),
        record_id: record,
        module,
        new_status: status,
        action: "status_changed",
        actor_name: "Analytics QA",
        role: "super_admin",
        user_id: buyer.user.id,
        organization_id: ids.buyer,
        created_at: at,
      });
    }
    async function doc(category: string, days?: number, extra: object = {}) {
      const id = randomUUID();
      await h.db("documents").insert({
        id,
        organization_id: ids.buyer,
        category,
        name: `Analytics ${category}.pdf`,
        storage_key: id,
        mime_type: "application/pdf",
        size: 100,
        status: "approved",
        uploaded_by: buyer.user.id,
        expires_at: days === undefined ? null : dateAfter(days),
        created_at: created,
        updated_at: created,
        ...extra,
      });
      return id;
    }
    async function token(client: any, scopes: string[]) {
      const response = await client.agent
        .post("/api/integrations/tokens")
        .set("X-CSRF-Token", client.token)
        .send({
          name: "Isolated analytics verification",
          scopes,
          expiresInDays: 1,
        });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      return response.body;
    }
    const integrationReport = (accessToken: string) =>
      supertest(h.app)
        .get(`/api/integration/reports/analytics?${query}`)
        .set("Authorization", `Bearer ${accessToken}`);

    beforeAll(async () => {
      const sourceOrg = await h
        .db("organizations")
        .where({ id: h.org("buyer") })
        .first();
      const sourceUser = await h
        .db("users")
        .where({ id: h.clients.buyer.user.id })
        .first();
      await h.db("roles").insert({
        id: "analytics_reader",
        name: "Isolated analytics reader",
        internal: false,
        permissions: JSON.stringify({
          ...defaultPermissions.org_admin,
          organizations: ["view"],
        }),
      });
      for (const [name, id] of Object.entries(ids)) {
        const isSupplier = name.toLowerCase().includes("supplier");
        await h.db("organizations").insert({
          ...sourceOrg,
          id,
          number: `ORG-${id}`,
          legal_name:
            name === "otherSupplier"
              ? '=HYPERLINK("https://example.test")'
              : `Analytics ${name}`,
          type: isSupplier ? "supplier" : "client",
          status: "active",
          contact_email: `${name}@analytics.example.test`,
          created_at: created,
          updated_at: created,
        });
        if (!["buyer", "supplier"].includes(name)) continue;
        const userId = randomUUID(),
          email = `${name}@analytics.example.test`;
        await h.db("users").insert({
          ...sourceUser,
          id: userId,
          organization_id: id,
          email,
          role: "analytics_reader",
          preferences: "{}",
          email_verified: true,
          created_at: created,
          updated_at: created,
        });
        const agent = supertest.agent(h.app);
        const response = await agent
          .post("/api/auth/login")
          .send({ email, password: demoPassword });
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        const client = {
          agent,
          token: response.body.csrfToken,
          user: response.body.user,
        };
        if (name === "buyer") buyer = client;
        else supplier = client;
      }
      await insertRecord("rfq1", "rfqs", "published");
      await insertRecord("rfq2", "rfqs", "evaluation");
      await insertRecord("rfqDraft", "rfqs", "draft");
      await h.db("record_invitations").insert([
        { record_id: records.rfq1, organization_id: ids.supplier },
        { record_id: records.rfq1, organization_id: ids.otherSupplier },
        { record_id: records.rfq2, organization_id: ids.supplier },
        { record_id: records.rfqDraft, organization_id: ids.supplier },
      ]);
      await insertRecord(
        "quote",
        "quotations",
        "submitted",
        {},
        {
          parent_id: records.rfq1,
          amount_minor: 118000,
          version: 3,
          owner_org_id: ids.supplier,
        },
      );
      await insertRecord(
        "quoteDraft",
        "quotations",
        "draft",
        {},
        {
          parent_id: records.rfq2,
          amount_minor: 999999,
          owner_org_id: ids.supplier,
        },
      );
      await insertRecord(
        "quoteUsd",
        "quotations",
        "submitted",
        {},
        {
          parent_id: records.rfq1,
          amount_minor: 60000,
          currency: "USD",
          owner_org_id: ids.otherSupplier,
          partner_org_id: ids.otherSupplier,
        },
      );
      await insertRecord("procurement", "requirements", "open", {
        requirement_type: "procurement",
        positions: 1,
      });
      await insertRecord("hiringOpen", "requirements", "open", {
        requirement_type: "hiring",
        positions: 4,
        notice_period: "30 days",
      });
      await insertRecord("hiringClosed", "requirements", "closed", {
        requirement_type: "hiring",
        positions: 3,
      });
      await insertRecord(
        "po1",
        "orders",
        "fulfilled",
        { delivery_date: "2041-06-04" },
        { amount_minor: 100000 },
      );
      await insertRecord(
        "po2",
        "orders",
        "approved",
        { delivery_date: "2041-06-03" },
        { amount_minor: 200000 },
      );
      await insertRecord(
        "poDraft",
        "orders",
        "draft",
        {},
        { amount_minor: 900000 },
      );
      await insertRecord(
        "poUsd",
        "orders",
        "sent",
        {},
        { amount_minor: 1000000, currency: "USD" },
      );
      await insertRecord(
        "onTime",
        "deliveries",
        "confirmed",
        {},
        { parent_id: records.po1 },
      );
      await insertRecord(
        "late",
        "deliveries",
        "confirmed",
        {},
        { parent_id: records.po2 },
      );
      await insertRecord(
        "undated",
        "deliveries",
        "confirmed",
        {},
        { parent_id: records.po2 },
      );
      await event(
        records.onTime,
        "deliveries",
        "delivered",
        "2041-06-03T08:00:00.000Z",
      );
      await event(
        records.late,
        "deliveries",
        "delivered",
        "2041-06-04T08:00:00.000Z",
      );
      await insertRecord("review", "performance", "published", {
        quality: 4,
        delivery: 3,
        communication: 5,
        value: 4,
      });
      await insertRecord("reviewDraft", "performance", "draft", {
        quality: 5,
        delivery: 5,
        communication: 5,
        value: 5,
      });
      await insertRecord(
        "invoice",
        "invoices",
        "approved",
        { due_date: dateAfter(-31) },
        { amount_minor: 100000 },
      );
      await insertRecord(
        "oldInvoice",
        "invoices",
        "approved",
        { due_date: dateAfter(-91) },
        { amount_minor: 200000, created_at: "2040-01-01T00:00:00.000Z" },
      );
      await insertRecord(
        "invoiceUsd",
        "invoices",
        "approved",
        { due_date: dateAfter(10) },
        { amount_minor: 900000, currency: "USD" },
      );
      await insertRecord(
        "payment",
        "payments",
        "completed",
        {},
        { parent_id: records.invoice, amount_minor: 25000 },
      );
      await insertRecord(
        "paymentFailed",
        "payments",
        "failed",
        {},
        { parent_id: records.invoice, amount_minor: 10000 },
      );
      await insertRecord(
        "paymentPending",
        "payments",
        "processing",
        {},
        { parent_id: records.invoice, amount_minor: 15000 },
      );
      await insertRecord(
        "oldPayment",
        "payments",
        "completed",
        {},
        {
          parent_id: records.oldInvoice,
          amount_minor: 50000,
          created_at: "2040-01-02T00:00:00.000Z",
        },
      );
      await insertRecord(
        "privateInvoice",
        "invoices",
        "approved",
        { due_date: dateAfter(-10) },
        {
          amount_minor: 99999999,
          owner_org_id: ids.otherBuyer,
          buyer_org_id: ids.otherBuyer,
          partner_org_id: ids.otherSupplier,
        },
      );
      for (const stage of [
        "submitted",
        "shortlisted",
        "offer",
        "bgv",
        "joined",
      ])
        await insertRecord(`candidate_${stage}`, "candidates", stage, {
          email: "candidate-private@example.test",
          phone: "+919999999999",
          expected_ctc: "private compensation",
        });
      await insertRecord("interview", "interviews", "scheduled");
      await insertRecord("resolved", "tickets", "resolved", {
        priority: "high",
        category: "Technical",
        assigned_team: "Support",
      });
      await event(
        records.resolved,
        "tickets",
        "resolved",
        "2041-06-03T00:00:00.000Z",
      );
      await event(
        records.resolved,
        "tickets",
        "resolved",
        "2041-06-04T00:00:00.000Z",
      );
      await insertRecord(
        "waiting",
        "tickets",
        "waiting_for_user",
        {},
        { created_at: "2040-01-01T00:00:00.000Z" },
      );
      await insertRecord("openTicket", "tickets", "open");
      await doc("PAN");
      await doc("Incorporation");
      for (const days of [-1, 0, 30, 31, 60, 61, 90, 91])
        await doc("Certification", days);
      const old = await doc("Insurance", -3);
      await doc("Insurance", 120, {
        previous_id: old,
        version: 2,
        status: "under_review",
      });
      await doc("Product document", -10, { record_id: records.po1 });
    });

    it("requires authentication and reports permission, and returns all eight authorized views", async () => {
      expect(
        (await supertest(h.app).get("/api/reports/analytics")).status,
      ).toBe(401);
      expect(
        (await h.clients.support.agent.get("/api/reports/analytics")).status,
      ).toBe(403);
      expect((await report()).views.map((v) => v.id)).toEqual([...reportViews]);
    });
    it("keeps organization snapshots and transaction counts within the caller's scope", async () => {
      const r = await report();
      expect(value(r, "partners", "organizations")).toBe(1);
      expect(value(r, "procurement", "requirements")).toBe(1);
      expect(
        view(r, "procurement")
          .dataset.rows.filter((row) => row.module === "requirements")
          .map((row) => row.requirement_type),
      ).toEqual(["procurement"]);
      expect(JSON.stringify(r)).not.toContain("99999999");
      const own = await report(supplier);
      expect(JSON.stringify(own)).not.toContain("HYPERLINK");
      expect(own.views.some((v) => v.id === "recruitment")).toBe(false);
    });
    it("uses invitation denominators, excludes drafts and counts a revised quotation once", async () => {
      const r = await report();
      expect(value(r, "procurement", "rfq_invitations")).toBe(3);
      expect(value(r, "procurement", "rfq_response_rate")).toBe(66.7);
      expect(value(r, "procurement", "average_quotation")).toBe(118000);
      expect(
        value(await report(supplier), "procurement", "rfq_response_rate"),
      ).toBe(50);
    });
    it("separates currencies, approval status and date boundaries in commercial KPIs", async () => {
      const r = await report();
      expect(value(r, "procurement", "po_value")).toBe(300000);
      expect(metric(r, "procurement", "po_value").href).toContain(
        "currency=INR",
      );
      const usd = await report(buyer, `from=${from}&to=${to}&currency=USD`);
      expect(value(usd, "procurement", "po_value")).toBe(1000000);
      expect(value(usd, "procurement", "average_quotation")).toBe(60000);
      expect(
        value(
          await report(buyer, `from=2041-06-02&to=${to}`),
          "procurement",
          "orders",
        ),
      ).toBe(0);
      expect(view(r, "procurement").trend).toEqual([
        { month: "2041-06", value: 3 },
      ]);
    });
    it("keeps older outstanding invoices and subtracts only completed same-currency payments", async () => {
      const r = await report();
      expect(value(r, "finance", "invoice_value")).toBe(100000);
      expect(value(r, "finance", "payments_completed")).toBe(25000);
      expect(value(r, "finance", "outstanding")).toBe(225000);
      expect(value(r, "finance", "overdue")).toBe(225000);
      expect(metric(r, "finance", "outstanding").scope).toBe("current");
      expect(metric(r, "finance", "outstanding").href).not.toContain("from=");
      const aging = view(r, "finance").tables.find((t) => t.id === "aging")!;
      expect(
        aging.rows.find((row) => row.bucket === "31–60 days")
          ?.outstanding_minor,
      ).toBe(75000);
      expect(
        aging.rows.find((row) => row.bucket === "Over 90 days")
          ?.outstanding_minor,
      ).toBe(150000);
    });
    it("uses confirmed delivery timestamps and published ratings, with visible evidence samples", async () => {
      const r = await report();
      expect(value(r, "performance", "rated_deliveries")).toBe(2);
      expect(value(r, "performance", "on_time_rate")).toBe(50);
      expect(value(r, "performance", "average_rating")).toBe(4);
      const empty = await report(buyer, "from=2042-01-01&to=2042-01-31");
      expect(value(empty, "performance", "on_time_rate")).toBeNull();
      expect(value(empty, "procurement", "average_quotation")).toBeNull();
      expect(value(empty, "support", "resolution_hours")).toBeNull();
    });
    it("counts disjoint expiry windows, current versions and pending renewals", async () => {
      const r = await report();
      for (const [bucket, count] of [
        ["Expired", 1],
        ["0–30 days", 2],
        ["31–60 days", 2],
        ["61–90 days", 2],
      ] as const)
        expect(value(r, "compliance", `expiry_${bucket}`)).toBe(count);
      expect(value(r, "compliance", "renewals_pending")).toBe(1);
      expect(value(r, "compliance", "missing_required_documents")).toBe(0);
      expect(value(r, "compliance", "organizations_missing_documents")).toBe(0);
    });
    it("applies organization-specific required-document overrides without treating upload as approval", async () => {
      const before = await h
        .db("document_policies")
        .where({ category: "GST", organization_type: "client" })
        .first();
      try {
        await h
          .db("document_policies")
          .insert({
            id: before?.id || randomUUID(),
            category: "GST",
            organization_type: "client",
            required: true,
            expiry_required: false,
            reminder_days: "[90,60,30]",
            updated_at: created,
          })
          .onConflict(["category", "organization_type"])
          .merge();
        expect(
          value(await report(), "compliance", "missing_required_documents"),
        ).toBe(1);
        const id = await doc("GST", undefined, { status: "uploaded" });
        expect(
          value(await report(), "compliance", "missing_required_documents"),
        ).toBe(0);
        expect((await h.db("documents").where({ id }).first()).status).toBe(
          "uploaded",
        );
        await h.db("documents").where({ id }).update({ status: "rejected" });
        expect(
          value(await report(), "compliance", "missing_required_documents"),
        ).toBe(1);
        await h.db("documents").where({ id }).delete();
      } finally {
        if (before)
          await h
            .db("document_policies")
            .where({ id: before.id })
            .update(before);
        else
          await h
            .db("document_policies")
            .where({ category: "GST", organization_type: "client" })
            .delete();
      }
    });
    it("reports hiring position counts and candidate stages without exporting personal candidate data", async () => {
      const r = await report();
      expect(value(r, "recruitment", "hiring_requirements")).toBe(2);
      expect(value(r, "recruitment", "open_positions")).toBe(4);
      expect(value(r, "recruitment", "closed_positions")).toBe(3);
      expect(value(r, "recruitment", "candidates")).toBe(5);
      expect(value(r, "recruitment", "candidates_joined")).toBe(1);
      expect(JSON.stringify(r)).not.toMatch(
        /candidate-private|private compensation|9999999999/,
      );
      const result = await h.post(
        "buyer",
        "/records/requirements",
        h.input("Notice-period API verification", {
          requirement_type: "hiring",
          required_date: h.future(30),
          description: "Three engineers",
          notice_period: "Up to 30 days",
          positions: 3,
        }),
        201,
      );
      expect(
        (await h.get("buyer", `/records/requirements/${result.id}`)).payload
          .notice_period,
      ).toBe("Up to 30 days");
      const preview = await h.post("buyer", "/imports/requirements/preview", {
        content: `title,requirement_type,required_date,notice_period,technology,delivery_requirements,positions\nImported notice period,hiring,${h.future(30)},15 days,TypeScript,Hybrid team,2`,
      });
      expect(preview.status).toBe("ready");
      const imported = await h.post(
        "buyer",
        `/imports/${preview.id}/commit`,
        {},
      );
      expect(imported.status).toBe("completed");
      expect(imported.records).toHaveLength(1);
      const saved = await h.get(
        "buyer",
        `/records/requirements/${imported.records[0].id}`,
      );
      expect(saved.payload).toMatchObject({
        notice_period: "15 days",
        technology: "TypeScript",
        delivery_requirements: "Hybrid team",
        positions: 2,
      });
    });
    it("measures first audited support resolution and includes older waiting tickets in current workload", async () => {
      const r = await report();
      expect(value(r, "support", "resolution_hours")).toBe(48);
      expect(value(r, "support", "resolution_samples")).toBe(1);
      expect(value(r, "support", "unresolved")).toBe(2);
    });
    it("exports every view and its tables as valid, scoped CSV, and protects spreadsheet formulas", async () => {
      const r = await report();
      for (const v of r.views) {
        for (const table of v.tables) {
          const response = await buyer.agent.get(
            `/api/reports/datasets/${v.id}?${query}&table=${table.id}`,
          );
          expect(response.status, response.text).toBe(200);
          expect(response.headers["content-type"]).toContain("text/csv");
          const rows = parse(response.text, { columns: true, bom: true });
          expect(rows).toHaveLength(table.rows.length);
          if (rows[0]) expect(rows[0].measurement_scope).toBe(table.scope);
          expect(response.text).not.toMatch(
            /candidate-private|password_hash|phk_/,
          );
          if (v.id === "performance" && table.id === "summary")
            expect(
              rows.find((row: any) => row.partner.includes("HYPERLINK"))
                .partner,
            ).toMatch(/^'=/);
        }
      }
      const source = await buyer.agent.get(
        `/api/reports/power-query?view=finance&table=aging&${query}`,
      );
      expect(source.status).toBe(200);
      expect(source.text).toContain("api/integration/reports/analytics");
      expect(source.text).toContain('Authorization = "Bearer " & AccessToken');
      expect(source.text).not.toMatch(/phk_[a-f0-9]{64}/);
      expect(
        await h
          .db("audit_logs")
          .where({ user_id: buyer.user.id, action: "analytics_exported" })
          .count({ n: "*" })
          .first(),
      ).toMatchObject({ n: expect.anything() });
    });
    it("intersects BI token scopes with current permissions, including revocation and expiry", async () => {
      const invoicesOnly = await token(buyer, ["reports", "invoices"]);
      let response = await integrationReport(invoicesOnly.token);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body.views.map((v: any) => v.id)).toEqual([
        "executive",
        "finance",
      ]);
      expect(view(response.body, "finance").metrics.map((m) => m.key)).toEqual([
        "invoices",
        "invoice_value",
      ]);
      expect(
        view(response.body, "finance").tables.some((t) => t.id === "aging"),
      ).toBe(false);
      expect(
        (
          await supertest(h.app)
            .get(
              `/api/integration/reports/datasets/finance?${query}&table=aging`,
            )
            .set("Authorization", `Bearer ${invoicesOnly.token}`)
        ).status,
      ).toBe(403);
      const noReports = await token(buyer, ["invoices"]);
      expect((await integrationReport(noReports.token)).status).toBe(403);
      const noSources = await token(buyer, ["reports"]);
      expect((await integrationReport(noSources.token)).status).toBe(403);
      const catalog = await token(supplier, ["reports", "catalog"]);
      expect((await integrationReport(catalog.token)).status).toBe(200);
      const performance = await token(buyer, ["reports", "orders"]);
      response = await integrationReport(performance.token);
      expect(
        view(response.body, "performance").dataset.columns.map((c) => c.key),
      ).toEqual(["partner", "orders", "completed_orders"]);
      const currentRole = await h
        .db("roles")
        .where({ id: "analytics_reader" })
        .first();
      const permissions = JSON.parse(currentRole.permissions);
      try {
        delete permissions.invoices;
        await h
          .db("roles")
          .where({ id: "analytics_reader" })
          .update({ permissions: JSON.stringify(permissions) });
        expect((await integrationReport(invoicesOnly.token)).status).toBe(403);
      } finally {
        await h
          .db("roles")
          .where({ id: "analytics_reader" })
          .update({ permissions: currentRole.permissions });
      }
      await buyer.agent
        .delete(`/api/integrations/tokens/${invoicesOnly.id}`)
        .set("X-CSRF-Token", buyer.token)
        .expect(200);
      expect((await integrationReport(invoicesOnly.token)).status).toBe(401);
      await h
        .db("integration_tokens")
        .where({ id: catalog.id })
        .update({ expires_at: "2000-01-01T00:00:00.000Z" });
      expect((await integrationReport(catalog.token)).status).toBe(401);
    });
    it("validates dates, export identifiers and source drill-down filters", async () => {
      for (const filters of [
        "from=2041-02-30",
        "from=2042-01-01&to=2041-01-01",
        "from=2000-01-01&to=2050-01-01",
        "currency=XYZ",
      ])
        expect(
          (await buyer.agent.get(`/api/reports/analytics?${filters}`)).status,
        ).toBe(422);
      expect(
        (await buyer.agent.get("/api/reports/datasets/unknown")).status,
      ).toBe(422);
      const response = await buyer.agent.get(
        `/api/records/requirements?${query}&requirement_type=hiring`,
      );
      expect(response.status).toBe(200);
      expect(response.body.total).toBe(2);
      const orders = await buyer.agent.get(
        `/api/records/orders?${query}&status=approved`,
      );
      expect(orders.status).toBe(200);
      expect(orders.body.items.map((r: any) => r.id)).toEqual([records.po2]);
    });
  });
}
