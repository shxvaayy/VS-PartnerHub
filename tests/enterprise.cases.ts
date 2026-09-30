import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { createServer, type Server } from "node:http";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { SMTPServer } from "smtp-server";
import { PDFDocument } from "pdf-lib";
import { demoAccounts, demoPassword } from "../shared/demo.js";
import { emptyIdentity } from "../shared/ai.js";
import { legacyCapabilityReply } from "./fixtures/ai-reply.js";

// Runs against the same disposable database as platform.test.ts, including PostgreSQL.
// Provider fixtures exist only in tests. Production always calls the configured providers.
export function enterpriseCases(h: any) {
  describe("enterprise workflows and provider security", () => {
    let smtp: SMTPServer, provider: Server, receiver: Server, config: any;
    let providerBody: any, providerHook: (() => Promise<void>) | undefined;
    let lookupFixture: any,
      identityFixture: any,
      draftFixture: any,
      answerFixture: any;
    let providerStatus = 200,
      providerCalls = 0;
    let malformed = false,
      received: { to: string[]; raw: string }[] = [];
    let webhookMessages: { body: string; headers: any }[] = [];
    let webhookStatus = 204,
      receiverUrl = "",
      mailSettings: any;
    const { clients, post, patch, get, input, line, org, rid, future } = h;
    const currentDb = () => h.db;
    const stamp = () => new Date().toISOString();
    async function mutate(
      key: string,
      method: "put" | "delete",
      route: string,
      body: any = {},
      status = 200,
    ) {
      const c = clients[key];
      const response = await c.agent[method](`/api${route}`)
        .set("X-CSRF-Token", c.token)
        .send(body);
      expect(response.status, JSON.stringify(response.body)).toBe(status);
      return response.body;
    }
    async function listen(server: Server | SMTPServer) {
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      return `http://127.0.0.1:${(server instanceof SMTPServer ? (server as any).server.address() : server.address()).port}`;
    }
    async function until(fn: () => Promise<any> | any) {
      for (let i = 0; i < 100; i++) {
        const result = await fn();
        if (result) return result;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("Expected local provider event was not observed.");
    }
    async function upload(
      key: string,
      fields: Record<string, string>,
      content?: Buffer,
      name = "contract-qa.pdf",
      expected = 201,
    ) {
      const c = clients[key];
      let request = c.agent.post("/api/documents").set("X-CSRF-Token", c.token);
      for (const [field, value] of Object.entries(fields))
        request = request.field(field, value);
      const response = await request.attach(
        "file",
        content || Buffer.from(await (await PDFDocument.create()).save()),
        {
          filename: name,
          contentType: name.endsWith(".png") ? "image/png" : "application/pdf",
        },
      );
      expect(response.status, JSON.stringify(response.body)).toBe(expected);
      return response.body;
    }
    async function createContract() {
      let contract = await post(
        "buyer",
        "/records/contracts",
        input(
          "QA signed service agreement",
          {
            start_date: future(0),
            end_date: future(180),
            terms: "Terms for isolated automated verification.",
            payment_terms: "Net 30",
          },
          { partner_org_id: org("vendor"), items: [line(100, 1)] },
        ),
        201,
      );
      contract = await h.transition("buyer", contract, "review");
      return h.transition("buyer", contract, "approved");
    }
    beforeAll(async () => {
      config = (await import("../server/config.js")).config;
      smtp = new SMTPServer({
        disabledCommands: ["AUTH", "STARTTLS"],
        onData(stream, session, callback) {
          const chunks: Buffer[] = [];
          stream.on("data", (chunk) => chunks.push(chunk));
          stream.on("end", () => {
            received.push({
              to: session.envelope.rcptTo.map((r) => r.address),
              raw: Buffer.concat(chunks)
                .toString()
                .replace(/=\r?\n/g, ""),
            });
            callback();
          });
        },
      });
      const smtpUrl = new URL(await listen(smtp));
      mailSettings = {
        enabled: true,
        provider: "smtp",
        from: "PartnerHub QA <no-reply@qa.example>",
        host: "127.0.0.1",
        port: Number(smtpUrl.port),
        secure: false,
        username: "",
        password: "local-smtp-fixture-secret",
      };
      provider = createServer(async (req, res) => {
        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const request = JSON.parse(Buffer.concat(chunks).toString());
          providerCalls++;
          providerBody = request;
          if (providerHook) {
            const hook = providerHook;
            providerHook = undefined;
            await hook();
          }
          if (providerStatus !== 200) {
            res
              .writeHead(providerStatus, { "Content-Type": "application/json" })
              .end(
                JSON.stringify({
                  error: {
                    status: "RESOURCE_EXHAUSTED",
                    message: "Private provider quota details",
                  },
                }),
              );
            return;
          }
          const context = request.contents
            .at(-1)
            .parts.find((p: any) => p.text)?.text;
          let sources: any[] = [];
          try {
            sources = JSON.parse(context).sources || [];
          } catch {}
          const properties =
            request.generationConfig.responseJsonSchema?.properties || {};
          const answer = malformed
            ? { answer: 42 }
            : properties.includeAlerts
              ? lookupFixture || {
                  records: [],
                  documents: null,
                  partners: null,
                  includeAlerts: false,
                }
              : properties.documentType
                ? {
                    documentType: "Test PDF",
                    summary: "Isolated provider contract fixture",
                    text: "QA reference 1001",
                    identity: identityFixture || emptyIdentity(),
                    fields: [
                      { name: "Reference", value: "1001", confidence: 0.9 },
                    ],
                    warnings: [],
                  }
                : answerFixture || {
                    answer:
                      "Contract fixture: this answer uses only authorized evidence.",
                    sourceIds:
                      properties.sourceIds?.items?.enum?.slice(0, 3) ||
                      sources.slice(0, 3).map((s) => s.id),
                    suggestions: [],
                    warnings: [],
                    ...(properties.draft ? { draft: draftFixture } : {}),
                  };
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              candidates: [
                {
                  finishReason: "STOP",
                  content: { parts: [{ text: JSON.stringify(answer) }] },
                },
              ],
              usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 },
            }),
          );
        } catch {
          res.writeHead(500).end();
        }
      });
      process.env.GEMINI_TEST_URL = await listen(provider);
      receiver = createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        webhookMessages.push({
          body: Buffer.concat(chunks).toString(),
          headers: req.headers,
        });
        res.writeHead(webhookStatus).end();
      });
      receiverUrl = await listen(receiver);
    });
    afterAll(async () => {
      config.demo = true;
      await (await import("../server/events.js")).deliverEmails();
      await currentDb()("integration_settings")
        .where({ key: "email" })
        .delete();
      await Promise.all([
        new Promise<void>((resolve) => smtp.close(resolve)),
        new Promise<void>((resolve) => provider.close(() => resolve())),
        new Promise<void>((resolve) => receiver.close(() => resolve())),
      ]);
      delete process.env.GEMINI_TEST_URL;
    }, 60000);

    it("keeps provider configuration administrator-only, encrypted and redacted", async () => {
      await get("vendor", "/integrations/providers", 403);
      await mutate("admin", "put", "/integrations/email", mailSettings);
      await mutate("admin", "put", "/integrations/gemini", {
        enabled: true,
        apiKey: "gemini-contract-fixture-secret",
        model: "gemini-3.5-flash",
        dailyLimit: 100,
      });
      const settings = await get("admin", "/integrations/providers");
      expect(settings.email.hasPassword).toBe(true);
      expect(settings.gemini.hasApiKey).toBe(true);
      expect(JSON.stringify(settings)).not.toContain("fixture-secret");
      const stored = await currentDb()("integration_settings");
      expect(JSON.stringify(stored)).not.toContain("fixture-secret");
      expect(
        stored.every((r: any) => r.encrypted_value.startsWith("v1:")),
      ).toBe(true);
      await post("admin", "/integrations/email/verify", {});
      const delivery = await post("admin", "/integrations/email/test", {
        recipient: "delivery@qa.example",
      });
      expect(delivery.status).toBe("sent");
      expect(received.some((m) => m.to.includes("delivery@qa.example"))).toBe(
        true,
      );
    });
    it("delivers registration OTP over SMTP without exposing a code in the API, then consumes it once", async () => {
      config.demo = false;
      try {
        const email = "otp-new@qa.example",
          agent = supertest.agent(h.app);
        const registration = await agent.post("/api/auth/register").send({
          name: "QA Partner Owner",
          email,
          password: demoPassword,
          accept_terms: true,
          organization: {
            type: "vendor",
            legal_name: "QA Email Verification Company",
            industry: "Technology",
            city: "Pune",
            contact_name: "QA Partner Owner",
            contact_email: email,
            contact_phone: "+91 9000000001",
            details: {
              company_type: "Private Limited",
              contact_role: "Authorized Representative",
              description: "Isolated SMTP verification fixture",
              capabilities: "Software services",
              services: "Software delivery",
              locations: "Pune",
            },
          },
        });
        expect(registration.status, JSON.stringify(registration.body)).toBe(
          201,
        );
        expect(registration.body.verificationCode).toBeUndefined();
        const message = await until(() =>
          received.find(
            (m) =>
              m.to.includes(email) && m.raw.includes("verification code is"),
          ),
        );
        const code = message.raw.match(/verification code is (\d{6})/)[1];
        const token = await currentDb()("auth_tokens")
          .where({ user_id: registration.body.user.id, kind: "verify" })
          .first();
        expect(token.token_hash).not.toBe(code);
        const delivery = await agent.get("/api/auth/verification-delivery");
        expect(["sent", "sending"]).toContain(delivery.body.status);
        const verify = () =>
          agent
            .post("/api/auth/verify")
            .set("X-CSRF-Token", registration.body.csrfToken)
            .send({ code });
        expect((await verify()).status).toBe(200);
        expect((await verify()).status).toBe(422);
        const stored = await currentDb()("email_outbox")
          .where({ id: token.email_id })
          .first();
        expect(stored.body).not.toContain(code);
      } finally {
        config.demo = true;
      }
    });
    it("replaces MFA challenges, rejects old codes, and never sends a superseded queued code", async () => {
      config.demo = false;
      try {
        await post("vendor", "/auth/mfa", {
          enabled: true,
          current_password: demoPassword,
        });
        const agent = supertest.agent(h.app),
          email = demoAccounts.find((a) => a.key === "vendor")!.email;
        const first = await agent
          .post("/api/auth/login")
          .send({ email, password: demoPassword });
        expect(first.body.requiresOtp).toBe(true);
        expect(first.body.verificationCode).toBeUndefined();
        await until(
          async () =>
            (
              await currentDb()("email_outbox")
                .where({
                  id: (
                    await currentDb()("auth_tokens")
                      .where({ id: first.body.challengeId })
                      .first()
                  ).email_id,
                })
                .first()
            )?.status === "sent",
        );
        await currentDb()("auth_tokens")
          .where({ id: first.body.challengeId })
          .update({ created_at: new Date(Date.now() - 61000).toISOString() });
        const resend = await agent
          .post("/api/auth/resend-login")
          .send({ challengeId: first.body.challengeId });
        expect(resend.status).toBe(200);
        expect(resend.body.challengeId).not.toBe(first.body.challengeId);
        expect(
          (
            await agent
              .post("/api/auth/verify-login")
              .send({ challengeId: first.body.challengeId, code: "123456" })
          ).status,
        ).toBe(422);
        const challenge = await currentDb()("auth_tokens")
          .where({ id: resend.body.challengeId })
          .first();
        await until(
          async () =>
            (
              await currentDb()("email_outbox")
                .where({ id: challenge.email_id })
                .first()
            ).status === "sent",
        );
        const message = received
          .filter(
            (m) => m.to.includes(email) && m.raw.includes("sign-in code is"),
          )
          .at(-1)!;
        const code = message.raw.match(/sign-in code is (\d{6})/)![1];
        expect(
          (
            await agent
              .post("/api/auth/verify-login")
              .send({ challengeId: challenge.id, code })
          ).status,
        ).toBe(200);
        await post("vendor", "/auth/mfa", {
          enabled: false,
          current_password: demoPassword,
        });
      } finally {
        config.demo = true;
      }
    });
    it("keeps AI source selection, conversations and prompts within authorized tenants", async () => {
      const before = Number(
        (await currentDb()("ai_requests").count({ n: "*" }).first()).n,
      );
      await post(
        "supplier",
        "/ai/chat",
        {
          message: "Inspect another vendor's order",
          recordIds: [rid("po:network")],
        },
        404,
      );
      expect(
        Number((await currentDb()("ai_requests").count({ n: "*" }).first()).n),
      ).toBe(before);
      const answer = await post("vendor", "/ai/chat", {
        message: "Summarize my purchase orders",
      });
      const context = JSON.parse(providerBody.contents.at(-1).parts[0].text);
      expect(
        context.workspace.recentRecords.every(
          (r: any) =>
            !["candidates", "interviews", "engagements"].includes(r.kind),
        ),
      ).toBe(true);
      expect(context.sources.some((r: any) => r.id === rid("po:cloud"))).toBe(
        false,
      );
      await get("supplier", `/ai/conversations/${answer.conversationId}`, 404);
      await mutate(
        "supplier",
        "delete",
        `/ai/conversations/${answer.conversationId}`,
        {},
        404,
      );
      expect(
        (await get("vendor", `/ai/conversations/${answer.conversationId}`))
          .messages.length,
      ).toBe(2);
    });
    it("reauthorizes an AI response after a permission change and redacts previously saved history", async () => {
      const role = await currentDb()("roles")
        .where({ id: "org_admin" })
        .first();
      const saved = await post("vendor", "/ai/chat", {
        message: "Summarize the authorized workspace",
      });
      const reduced = JSON.parse(role.permissions);
      delete reduced.orders;
      providerHook = async () => {
        await currentDb()("roles")
          .where({ id: role.id })
          .update({ permissions: JSON.stringify(reduced) });
      };
      try {
        await post(
          "vendor",
          "/ai/chat",
          { message: "Check current purchase orders" },
          403,
        );
        const history = await get(
          "vendor",
          `/ai/conversations/${saved.conversationId}`,
        );
        expect(
          history.messages.every(
            (m: any) => m.unavailable && !m.sources.length,
          ),
        ).toBe(true);
      } finally {
        await currentDb()("roles")
          .where({ id: role.id })
          .update({ permissions: role.permissions });
      }
    });
    it("handles malformed AI output as a provider failure without creating business records", async () => {
      const before = Number(
        (await currentDb()("records").count({ n: "*" }).first()).n,
      );
      malformed = true;
      try {
        await post(
          "vendor",
          "/ai/chat",
          { message: "Test invalid provider output" },
          502,
        );
      } finally {
        malformed = false;
      }
      expect(
        Number((await currentDb()("records").count({ n: "*" }).first()).n),
      ).toBe(before);
      await post(
        "vendor",
        "/ai/extract-document",
        { documentId: h.demoId("doc:supplier:PAN") },
        404,
      );
      await post(
        "vendor",
        "/ai/draft-requirement",
        { brief: "Unauthorized vendor requirement creation" },
        403,
      );
    });
    it("uses minimal context for greetings and current authorized data without a provider call for common RFQ lookups", async () => {
      const start = providerCalls;
      const greeting = await post("vendor", "/ai/chat", { message: "hi" });
      expect(providerCalls - start).toBe(1);
      let context = JSON.parse(providerBody.contents.at(-1).parts[0].text);
      expect(context.workspace.counts).toEqual([]);
      expect(context.workspace.recentRecords).toEqual([]);
      expect(context.workspace.selectedRecords).toEqual([]);
      expect(context.sources.every((s: any) => s.type === "module")).toBe(true);
      expect(providerBody.generationConfig.maxOutputTokens).toBe(512);
      const answer = await post("vendor", "/ai/chat", {
        message: "Show me pending RFQs.",
        conversationId: greeting.conversationId,
      });
      expect(providerCalls - start).toBe(1);
      const last = answer.messages.at(-1),
        lookup = last.structured.lookupResults.records[0];
      expect(last.structured.engine).toBe("workspace");
      expect(last.input_tokens).toBe(0);
      expect(last.model).toBeNull();
      expect(lookup.query.statuses).toEqual(["published", "evaluation"]);
      expect(last.structured.retrieval.records[0].total).toBe(lookup.total);
      for (const row of lookup.items)
        expect((await get("vendor", `/records/rfqs/${row.id}`)).id).toBe(
          row.id,
        );
      const status = await get("vendor", "/ai/status");
      expect(status.capabilities.comparison).toBe(false);
      expect(status).not.toHaveProperty("usedToday");
      expect(status).not.toHaveProperty("model");
    });
    it("bounds provider timeouts and releases the running request without saving an invented response", async () => {
      const { callGemini } = await import("../server/gemini.js");
      const messages = Number(
        (await currentDb()("ai_messages").count({ n: "*" }).first()).n,
      );
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      providerHook = () => pending;
      try {
        await expect(
          callGemini(
            {
              system: "Isolated timeout verification",
              parts: [{ text: "hi" }],
              purpose: "qa_timeout",
              timeoutMs: 100,
              maxOutputTokens: 128,
            },
            clients.vendor.user,
          ),
        ).rejects.toMatchObject({ status: 504 });
        const request = await currentDb()("ai_requests")
          .where({ purpose: "qa_timeout", user_id: clients.vendor.user.id })
          .orderBy("created_at", "desc")
          .first();
        expect(request.status).toBe("failed");
        expect(request.completed_at).toBeTruthy();
        expect(
          Number(
            (await currentDb()("ai_messages").count({ n: "*" }).first()).n,
          ),
        ).toBe(messages);
      } finally {
        providerHook = undefined;
        release();
      }
      await post("vendor", "/ai/chat", { message: "hello" });
    });
    it("presents new replies and legacy history without internal routes and reauthorizes named actions", async () => {
      answerFixture = {
        answer: legacyCapabilityReply,
        sourceIds: [],
        suggestions: ["Open /app/ai?mode=document"],
        warnings: [],
      };
      try {
        const result = await post("buyer", "/ai/chat", {
          message: "What can you do?",
        });
        const message = result.messages.at(-1);
        expect(message.content).not.toContain("/app");
        expect(message.structured.actions).toHaveLength(6);
        expect(message.structured.suggestions.join(" ")).not.toContain("/app");
        const context = JSON.parse(providerBody.contents.at(-1).parts[0].text);
        expect(JSON.stringify(context.workspace.platformGuide)).not.toContain(
          "/app",
        );
        const row = await currentDb()("ai_messages")
          .where({ id: message.id })
          .first();
        expect(row.content).not.toContain("/app");
        const userMessage = result.messages.find(
          (item: any) => item.role === "user",
        );
        await currentDb()("ai_messages")
          .where({ id: userMessage.id })
          .update({ content: "What happens at /app/ai?" });
        await currentDb()("ai_messages")
          .where({ id: message.id })
          .update({
            content: legacyCapabilityReply,
            structured: JSON.stringify({
              ...JSON.parse(row.structured),
              actions: [{ href: "/app/verification", label: "Admin" }],
            }),
          });
        const saved = await get(
          "buyer",
          `/ai/conversations/${result.conversationId}`,
        );
        expect(
          saved.messages.find((item: any) => item.role === "user").content,
        ).toBe("What happens at /app/ai?");
        expect(saved.messages.at(-1).content).not.toContain("/app");
        expect(saved.messages.at(-1).structured.actions).toHaveLength(6);
        expect(
          saved.messages
            .at(-1)
            .structured.actions.some(
              (action: any) => action.href === "/app/verification",
            ),
        ).toBe(false);
        expect(
          (await currentDb()("ai_messages").where({ id: message.id }).first())
            .content,
        ).toBe(legacyCapabilityReply);
        const vendor = await post("vendor", "/ai/chat", {
          message: "What can you do?",
        });
        expect(
          vendor.messages
            .at(-1)
            .structured.actions.some(
              (action: any) => action.href === "/app/ai?mode=comparison",
            ),
        ).toBe(false);
      } finally {
        answerFixture = undefined;
      }
    });
    it("keeps provider citation grammar compact and restores exact authorized references without inventing new ones", async () => {
      const { citationContract } = await import("../server/gemini.js");
      const ids = Array.from({ length: 100 }, () => randomUUID());
      const input = {
        system: "QA reference contract",
        parts: [],
        purpose: "qa_reference_contract",
        schema: {
          type: "object",
          properties: {
            sourceIds: { type: "array", items: { type: "string", enum: ids } },
          },
        },
      };
      const contract = citationContract(input);
      expect(contract.schema.properties.sourceIds.items.enum).toHaveLength(100);
      expect(
        contract.schema.properties.sourceIds.items.enum.every((key: string) =>
          /^ref\d+$/.test(key),
        ),
      ).toBe(true);
      expect(
        contract.restore({ sourceIds: ["ref1", "ref100", "unknown-reference"] })
          .sourceIds,
      ).toEqual([ids[0], ids[99], "unknown-reference"]);
      expect(input.schema.properties.sourceIds.items.enum).toEqual(ids);
      answerFixture = {
        answer: "Unsupported reference fixture",
        sourceIds: ["unknown-reference"],
        suggestions: [],
        warnings: [],
      };
      try {
        await post("buyer", "/ai/chat", { message: "hi" }, 502);
      } finally {
        answerFixture = undefined;
      }
    });
    it("resolves displayed-record follow-ups with fresh line items while keeping personal recruitment payloads behind explicit selection", async () => {
      const conversation = await post("buyer", "/ai/chat", {
        message: "Show me pending RFQs.",
      });
      const target =
        conversation.messages.at(-1).structured.lookupResults.records[0]
          .items[1];
      lookupFixture = {
        questionType: "workspace",
        records: [
          {
            module: "rfqs",
            statuses: [],
            query: "",
            dueBefore: "",
            createdBefore: "",
            recordIds: [target.id],
            includeDetails: true,
          },
        ],
        documents: null,
        partners: null,
        includeAlerts: false,
      };
      try {
        const result = await post("buyer", "/ai/chat", {
          message:
            "For the second one, what exactly is required and in what quantities?",
          conversationId: conversation.conversationId,
        });
        const details =
          result.messages.at(-1).structured.lookupResults.records[0].items[0]
            .recordDetails;
        expect(details.id).toBe(target.id);
        expect(details.items.length).toBeGreaterThan(0);
        expect(
          providerBody.generationConfig.responseJsonSchema.properties.sourceIds.items.enum.every(
            (key: string) => /^ref\d+$/.test(key),
          ),
        ).toBe(true);
        expect(
          result.messages
            .at(-1)
            .sources.some((source: any) => source.id === target.id),
        ).toBe(true);
        const personal = await currentDb()("records")
          .where({
            kind: "candidates",
            partner_org_id: clients.recruiter.user.organization_id,
          })
          .first();
        lookupFixture = {
          questionType: "workspace",
          records: [
            {
              module: "candidates",
              statuses: [],
              query: "",
              dueBefore: "",
              createdBefore: "",
              recordIds: [personal.id],
              includeDetails: true,
            },
          ],
          documents: null,
          partners: null,
          includeAlerts: false,
        };
        await post("recruiter", "/ai/chat", {
          message: "Explain my candidate records with detailed compensation.",
        });
        const context = JSON.parse(providerBody.contents.at(-1).parts[0].text);
        expect(
          context.lookups.records[0].items[0].recordDetails,
        ).toBeUndefined();
        expect(context.lookups.records[0].items[0].details).toBeUndefined();
      } finally {
        lookupFixture = undefined;
      }
    });
    it("treats informal capability questions as a new topic instead of repeating a previous RFQ answer", async () => {
      const conversation = await post("buyer", "/ai/chat", {
        message: "Show me pending RFQs.",
      });
      for (const message of [
        "hi bro what all can u do for me",
        "i said what can u doooo?",
      ]) {
        const calls = providerCalls;
        await post("buyer", "/ai/chat", {
          message,
          conversationId: conversation.conversationId,
        });
        expect(providerCalls - calls).toBe(1);
        expect(providerBody.contents).toHaveLength(1);
        const context = JSON.parse(providerBody.contents[0].parts[0].text);
        expect(context.workspace.counts).toEqual([]);
        expect(context.workspace.recentRecords).toEqual([]);
        expect(context.lookups.records).toEqual([]);
        expect(context.workspace.platformGuide.capabilities).toHaveLength(6);
        expect(
          context.sources.every((source: any) => source.type === "module"),
        ).toBe(true);
        expect(providerBody.contents[0].parts.at(-1).text).toContain(message);
      }
      lookupFixture = {
        questionType: "platform",
        records: [
          {
            module: "rfqs",
            statuses: ["published"],
            query: "",
            dueBefore: "",
            createdBefore: "",
          },
        ],
        documents: null,
        partners: null,
        includeAlerts: false,
      };
      try {
        await post("buyer", "/ai/chat", {
          message:
            "Tell me the different ways this assistant can help our company.",
          conversationId: conversation.conversationId,
        });
        const context = JSON.parse(providerBody.contents.at(-1).parts[0].text);
        expect(context.lookups.records).toEqual([]);
        expect(providerBody.contents).toHaveLength(1);
      } finally {
        lookupFixture = undefined;
      }
    });
    it("cancels provider work when the browser disconnects and permits the next request", async () => {
      let started!: () => void, release!: () => void;
      const seen = new Promise<void>((resolve) => {
        started = resolve;
      });
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      providerHook = async () => {
        started();
        await pending;
      };
      const messages = Number(
        (await currentDb()("ai_messages").count({ n: "*" }).first()).n,
      );
      const request = clients.vendor.agent
        .post("/api/ai/chat")
        .set("X-CSRF-Token", clients.vendor.token)
        .send({ message: "hi" });
      const completion = request.then(
        () => undefined,
        () => undefined,
      );
      try {
        await seen;
        request.abort();
        await completion;
        await until(
          async () =>
            !(await currentDb()("ai_requests")
              .where({ user_id: clients.vendor.user.id, status: "running" })
              .first()),
        );
        expect(
          Number(
            (await currentDb()("ai_messages").count({ n: "*" }).first()).n,
          ),
        ).toBe(messages);
      } finally {
        providerHook = undefined;
        release();
      }
      await post("vendor", "/ai/chat", { message: "hello" });
    });
    it("returns a concise VS AI capacity error without exposing provider details or retrying rejected quota requests", async () => {
      const start = providerCalls;
      providerStatus = 429;
      try {
        const result = await post("vendor", "/ai/chat", { message: "hi" }, 503);
        expect(result.error).toMatch(/VS AI.*capacity/);
        expect(result.error).not.toMatch(/Gemini|Private provider|quota|HTTP/i);
        expect(providerCalls - start).toBe(1);
      } finally {
        providerStatus = 200;
      }
      await post("vendor", "/ai/chat", { message: "hello" });
    });
    it("extracts authorized record attachments, keeps extraction history private and supports deletion", async () => {
      const contract = await createContract();
      const doc = await upload("buyer", {
        category: "Contract",
        record_id: contract.id,
      });
      expect((await get("vendor", `/ai/documents/${doc.id}`)).record_id).toBe(
        contract.id,
      );
      const extraction = await post("vendor", "/ai/extract-document", {
        documentId: doc.id,
      });
      expect(extraction.result.fields[0].value).toBe("1001");
      expect(
        (await get("vendor", "/ai/extractions")).some(
          (e: any) => e.id === extraction.id,
        ),
      ).toBe(true);
      await get("buyer", `/ai/extractions/${extraction.id}`, 404);
      await mutate(
        "buyer",
        "delete",
        `/ai/extractions/${extraction.id}`,
        {},
        404,
      );
      await mutate("vendor", "delete", `/ai/extractions/${extraction.id}`);
      await get("vendor", `/ai/extractions/${extraction.id}`, 404);
    });
    it("reads text PDFs locally, streams actual stages and reuses an unchanged extraction with fresh validation", async () => {
      const pdf = await PDFDocument.create(),
        page = pdf.addPage();
      [
        "Company name: Local Text QA Ltd",
        "PAN: ABCDE1234F",
        "Expiry date: 2027-12-31",
        "Address: 15 QA Road, Pune",
      ].forEach((text, i) =>
        page.drawText(text, { x: 30, y: 760 - i * 24, size: 12 }),
      );
      const doc = await upload(
        "vendor",
        { category: "Other" },
        Buffer.from(await pdf.save()),
        "local-text-qa.pdf",
      );
      identityFixture = {
        ...emptyIdentity(),
        company_name: "Local Text QA Ltd",
        pan: "ABCDE1234F",
        expiry_date: "2027-12-31",
        address: "15 QA Road, Pune",
      };
      const start = providerCalls;
      try {
        const response = await clients.vendor.agent
          .post("/api/ai/extract-document")
          .set("X-CSRF-Token", clients.vendor.token)
          .set("Accept", "text/event-stream")
          .send({ documentId: doc.id });
        expect(response.status).toBe(200);
        expect(response.headers["content-type"]).toContain("text/event-stream");
        const events = response.text
          .trim()
          .split("\n\n")
          .map((block: string) => ({
            event: block.match(/^event: (.+)$/m)![1],
            data: JSON.parse(block.match(/^data: (.+)$/m)![1]),
          }));
        expect([
          ...new Set(
            events
              .filter((e: any) => e.event === "progress")
              .map((e: any) => e.data.stage),
          ),
        ]).toEqual([
          "uploaded",
          "reading",
          "extracting",
          "validating",
          "ready",
        ]);
        expect(
          events.some(
            (e: any) => e.data.pagesRead === 1 && e.data.totalPages === 1,
          ),
        ).toBe(true);
        const result = events.find((e: any) => e.event === "result")!.data;
        expect(providerCalls - start).toBe(1);
        expect(result.result.preparation.method).toBe("pdf_text");
        expect(result.result.text).toContain("Local Text QA Ltd");
        expect(
          providerBody.contents[0].parts.some((p: any) => p.inlineData),
        ).toBe(false);
        expect(
          providerBody.generationConfig.responseJsonSchema.properties,
        ).not.toHaveProperty("text");
        expect(providerBody.systemInstruction.parts[0].text).toContain(
          "Always write user-facing answers",
        );
        await currentDb()("documents")
          .where({ id: doc.id })
          .update({ expires_at: "2028-12-31" });
        const repeated = await post("vendor", "/ai/extract-document", {
          documentId: doc.id,
        });
        expect(repeated.id).toBe(result.id);
        expect(repeated.reused).toBe(true);
        expect(providerCalls - start).toBe(1);
        expect(
          repeated.result.validation.find((v: any) => v.field === "expiry_date")
            .status,
        ).toBe("warning");
        expect((await get("vendor", `/documents/${doc.id}`)).status).toBe(
          "uploaded",
        );
        expect(
          Number(
            (
              await currentDb()("document_extractions")
                .where({ document_id: doc.id })
                .count({ n: "*" })
                .first()
            ).n,
          ),
        ).toBe(1);
      } finally {
        identityFixture = undefined;
      }
    });
    it("extracts a long PDF using sections across the whole document and retains late-page evidence for follow-up questions", async () => {
      const pdf = await PDFDocument.create();
      for (let index = 0; index < 60; index++) {
        const page = pdf.addPage();
        for (let line = 0; line < 22; line++)
          page.drawText(
            `QA handbook section ${index + 1}.${line + 1}. Read the original file before taking action on a record.`,
            { x: 25, y: 775 - line * 24, size: 8 },
          );
      }
      pdf
        .getPage(59)
        .drawText(
          "Company name: Long Document QA Ltd\nRegistration number: FINAL-PAGE-6027",
          { x: 25, y: 150, size: 12, lineHeight: 18 },
        );
      const doc = await upload(
        "vendor",
        { category: "Other" },
        Buffer.from(await pdf.save()),
        "sixty-page-handbook.pdf",
      );
      identityFixture = {
        ...emptyIdentity(),
        company_name: "Long Document QA Ltd",
        registration_number: "FINAL-PAGE-6027",
      };
      try {
        const output = await post("vendor", "/ai/extract-document", {
          documentId: doc.id,
        });
        const context = JSON.parse(providerBody.contents[0].parts[1].text);
        expect(context.transcript).toContain("FINAL-PAGE-6027");
        expect(context.transcript.length).toBeLessThanOrEqual(60000);
        expect(output.result.preparation).toMatchObject({
          pageCount: 60,
          complete: true,
          analysisComplete: false,
        });
        expect(output.result.text.length).toBeGreaterThan(60000);
        expect(output.result.warnings.join(" ")).toContain(
          "relevant excerpts across",
        );
        expect(output.documentStatus).toBe("uploaded");
        await post("vendor", "/ai/chat", {
          message: "What registration number is printed near the end?",
          documentId: doc.id,
        });
        const followup = JSON.parse(providerBody.contents.at(-1).parts[0].text);
        expect(followup.selectedDocument.text).toContain("FINAL-PAGE-6027");
        expect(followup.selectedDocument.coverage.pageCount).toBe(60);
        expect((await get("vendor", `/ai/documents/${doc.id}`)).status).toBe(
          "uploaded",
        );
      } finally {
        identityFixture = undefined;
      }
    });
    it("rejects oversized PDF page counts before provider work and reports streamed failures without completing later stages", async () => {
      const pdf = await PDFDocument.create();
      for (let i = 0; i < 501; i++) pdf.addPage();
      const doc = await upload(
        "vendor",
        { category: "Other" },
        Buffer.from(await pdf.save()),
        "over-five-hundred-pages.pdf",
      );
      const start = providerCalls;
      const error = await post(
        "vendor",
        "/ai/extract-document",
        { documentId: doc.id },
        422,
      );
      expect(error.error).toContain("500 pages");
      expect(providerCalls).toBe(start);
      const streamed = await clients.vendor.agent
        .post("/api/ai/extract-document")
        .set("X-CSRF-Token", clients.vendor.token)
        .set("Accept", "text/event-stream")
        .send({ documentId: doc.id });
      expect(streamed.text).toContain('"status":422');
      expect(streamed.text).not.toContain('"stage":"ready"');
      expect(streamed.text).not.toContain("event: result");
      expect(providerCalls).toBe(start);
    });
    it("grounds arbitrary document follow-ups in private extraction evidence and rechecks access before generation", async () => {
      const doc = await upload("vendor", { category: "Other" });
      await post("vendor", "/ai/extract-document", { documentId: doc.id });
      const start = providerCalls;
      const response = await post("vendor", "/ai/chat", {
        message:
          "Is that reference number readable, and does it prove statutory verification? Hindi mein explain karo.",
        documentId: doc.id,
      });
      expect(providerCalls - start).toBe(1);
      const context = JSON.parse(providerBody.contents.at(-1).parts[0].text);
      expect(context.selectedDocument.text).toContain("QA reference 1001");
      expect(context.selectedDocument.status).toBe("uploaded");
      expect(response.messages.at(-1).structured.documentContext.id).toBe(
        doc.id,
      );
      expect(providerBody.systemInstruction.parts[0].text).toContain(
        "do not mirror them or switch response language, even when asked",
      );
      await post(
        "buyer",
        "/ai/chat",
        { message: "Read this certificate", documentId: doc.id },
        404,
      );
      expect(providerCalls - start).toBe(1);
      await currentDb()("documents")
        .where({ id: doc.id })
        .update({ organization_id: org("supplier") });
      const history = await get(
        "vendor",
        `/ai/conversations/${response.conversationId}`,
      );
      expect(history.messages.every((m: any) => m.unavailable)).toBe(true);
      expect(
        history.messages.every(
          (m: any) => !JSON.stringify(m).includes("QA reference 1001"),
        ),
      ).toBe(true);
    });
    it("reuses factual quotation analysis only while the same user's authorized evidence is unchanged", async () => {
      const db = currentDb(),
        group = await db("records")
          .where({ kind: "quotations", buyer_org_id: org("buyer") })
          .whereNot("status", "draft")
          .select("parent_id")
          .count({ n: "*" })
          .groupBy("parent_id")
          .orderBy("n", "desc")
          .first();
      const input = {
        rfqId: group.parent_id,
        question:
          "Explain the warranties and recorded prices for this cache verification.",
      };
      const original = await db("records")
        .where({ parent_id: group.parent_id, kind: "quotations" })
        .whereNot("status", "draft")
        .first();
      const first = await post("buyer", "/ai/analyze-quotations", input),
        calls = providerCalls;
      const second = await post("buyer", "/ai/analyze-quotations", input);
      expect(providerCalls).toBe(calls);
      expect(second.messages.at(-1).content).toBe(
        first.messages.at(-1).content,
      );
      expect(second.messages.at(-1).structured.engine).toBe("saved_analysis");
      expect(second.messages.at(-1).structured).not.toHaveProperty(
        "analysisResult",
      );
      expect(second.messages.at(-1).input_tokens).toBe(0);
      await post("vendor", "/ai/analyze-quotations", input, 403);
      expect(providerCalls).toBe(calls);
      try {
        await db("records")
          .where({ id: original.id })
          .update({
            payload: JSON.stringify({
              ...JSON.parse(original.payload),
              warranty: "QA changed warranty, 48 months",
            }),
            version: original.version + 1,
          });
        const changed = await post("buyer", "/ai/analyze-quotations", input);
        expect(providerCalls).toBe(calls + 1);
        expect(
          changed.messages
            .at(-1)
            .structured.comparison.find((q: any) => q.id === original.id)
            .warranty,
        ).toContain("48 months");
      } finally {
        await db("records")
          .where({ id: original.id })
          .update({ payload: original.payload, version: original.version });
      }
    });
    it("carries authorization through AI follow-up history and removes retained candidate data everywhere", async () => {
      const db = currentDb(),
        candidate = await db("records")
          .where({ kind: "candidates", partner_org_id: org("recruitment") })
          .whereNot("status", "closed")
          .first();
      // Fixture organization keys use recruiter for the login, recruitment for the organization.
      const record =
        candidate ||
        (await db("records")
          .where({
            kind: "candidates",
            partner_org_id: clients.recruiter.user.organization_id,
          })
          .whereNot("status", "closed")
          .first());
      expect(record).toBeTruthy();
      const answer = await post("recruiter", "/ai/chat", {
        message: `Review candidate ${record.title}`,
        recordIds: [record.id],
      });
      const followup = await post("recruiter", "/ai/chat", {
        message: "Explain the next authorized stage",
        conversationId: answer.conversationId,
      });
      expect(
        followup.messages.at(-1).sources.some((s: any) => s.id === record.id),
      ).toBe(true);
      const doc = await upload("recruiter", {
        category: "Resume",
        record_id: record.id,
      });
      const extraction = await post("recruiter", "/ai/extract-document", {
        documentId: doc.id,
      });
      const payload = JSON.parse(record.payload);
      payload.retention_until = new Date(Date.now() - 86400000).toISOString();
      await db("records")
        .where({ id: record.id })
        .update({ status: "closed", payload: JSON.stringify(payload) });
      await (await import("../server/maintenance.js")).maintenance();
      const history = await get(
        "recruiter",
        `/ai/conversations/${answer.conversationId}`,
      );
      expect(history.title).toBe("Archived recruitment conversation");
      expect(
        history.messages.every(
          (m: any) =>
            m.content === "[Removed under candidate retention policy]" &&
            !m.sources.length,
        ),
      ).toBe(true);
      expect(
        await db("document_extractions").where({ id: extraction.id }).first(),
      ).toBeUndefined();
      expect(
        (await db("documents").where({ record_id: record.id })).length,
      ).toBe(0);
    });
    it("requires the operator setup token and allows only one first-administrator claim", async () => {
      const db = currentDb(),
        admins = await db("users").where({ role: "super_admin" }).select("id");
      const oldToken = process.env.SETUP_TOKEN;
      process.env.SETUP_TOKEN = "qa-only-setup-token-" + randomUUID();
      const attempts = ["first-admin-a@qa.example", "first-admin-b@qa.example"];
      try {
        await db("users")
          .whereIn(
            "id",
            admins.map((a: any) => a.id),
          )
          .update({ role: "management" });
        const data = {
          name: "QA Operator",
          email: attempts[0],
          password: demoPassword,
        };
        expect(
          (await supertest(h.app).post("/api/public/setup").send(data)).status,
        ).toBe(403);
        const results = await Promise.all(
          attempts.map((email) =>
            supertest(h.app)
              .post("/api/public/setup")
              .send({ ...data, email, token: process.env.SETUP_TOKEN }),
          ),
        );
        expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
        expect(
          (await supertest(h.app).get("/api/public/setup")).body.available,
        ).toBe(false);
      } finally {
        await db("users").whereIn("email", attempts).delete();
        await db("users")
          .whereIn(
            "id",
            admins.map((a: any) => a.id),
          )
          .update({ role: "super_admin" });
        if (oldToken === undefined) delete process.env.SETUP_TOKEN;
        else process.env.SETUP_TOKEN = oldToken;
      }
    });
    it("validates reusable catalog access, currency and MOQ while preserving selected references", async () => {
      let catalog = await post(
        "supplier",
        "/records/catalog",
        input("QA reusable catalog monitor", {
          sku: "QA-REUSE-001",
          price: 100,
          moq: 5,
          availability: 100,
        }),
        201,
      );
      catalog = await h.transition("supplier", catalog, "active");
      const request = input(
        "QA catalog procurement",
        { required_date: future(30) },
        { items: [{ ...line(100, 2), catalog_item_id: catalog.id }] },
      );
      await post("buyer", "/records/requirements", request, 422);
      request.items[0].quantity = 5;
      request.currency = "USD";
      await post("buyer", "/records/requirements", request, 422);
      request.currency = "INR";
      const created = await post(
        "buyer",
        "/records/requirements",
        request,
        201,
      );
      expect(created.items[0].catalog_item_id).toBe(catalog.id);
    });
    it("previews CSV through real validation with no persisted rows, notifications or audits", async () => {
      const db = currentDb();
      const counts = async () =>
        Promise.all(
          ["records", "audit_logs", "notifications", "email_outbox"].map(
            async (t) => Number((await db(t).count({ n: "*" }).first()).n),
          ),
        );
      await until(
        async () =>
          !(await db("email_outbox").where({ status: "sending" }).first()),
      );
      const before = await counts();
      const preview = await post("supplier", "/imports/catalog/preview", {
        content:
          "title,sku,price,moq\nQA imported switch,QA-BULK-001,100,2\nQA duplicated switch,QA-BULK-001,120,1",
      });
      expect(preview.status).toBe("invalid");
      expect(preview.results[1].valid).toBe(false);
      expect(await counts()).toEqual(before);
      await post("supplier", `/imports/${preview.id}/commit`, {}, 422);
      const ready = await post("supplier", "/imports/catalog/preview", {
        content:
          "title,sku,price\nQA imported device A,QA-BULK-002,100\nQA imported device B,QA-BULK-003,200",
      });
      expect(ready.status).toBe("ready");
      await post("vendor", `/imports/${ready.id}/commit`, {}, 404);
      const result = await post("supplier", `/imports/${ready.id}/commit`, {});
      expect(result.records.length).toBe(2);
      expect(await post("supplier", `/imports/${ready.id}/commit`, {})).toEqual(
        result,
      );
    });
    it("rolls back an entire CSV commit when a later row becomes invalid after preview", async () => {
      const preview = await post("supplier", "/imports/catalog/preview", {
        content:
          "title,sku,price\nQA late import A,QA-LATE-001,100\nQA late import B,QA-LATE-002,200",
      });
      await post(
        "supplier",
        "/records/catalog",
        input("QA late conflicting record", { sku: "QA-LATE-002", price: 20 }),
        201,
      );
      await post("supplier", `/imports/${preview.id}/commit`, {}, 422);
      expect(
        await currentDb()("records")
          .where({ title: "QA late import A" })
          .first(),
      ).toBeUndefined();
      expect(
        (await currentDb()("import_batches").where({ id: preview.id }).first())
          .status,
      ).toBe("ready");
    });
    it("opens the configured approval queue and notifies reviewers as soon as review starts", async () => {
      const data = {
        name: "QA contract review routing",
        kind: "contracts",
        currency: "INR",
        minimum: 0,
        enabled: true,
        organization_id: org("buyer"),
        steps: [{ name: "Commercial review", roles: ["procurement"] }],
      };
      const policy = await post("admin", "/approvals/policies", data, 201);
      try {
        let contract = await post(
          "buyer",
          "/records/contracts",
          input(
            "QA queued contract",
            { start_date: future(0), end_date: future(100) },
            { partner_org_id: org("vendor") },
          ),
          201,
        );
        contract = await h.transition("buyer", contract, "review");
        const queue = await get("procurement", "/approvals/queue");
        expect(queue.find((r: any) => r.id === contract.id)).toMatchObject({
          completed_steps: 0,
          next_step: "Commercial review",
        });
        expect(
          (await get("procurement", "/notifications")).items.some(
            (n: any) =>
              n.title === "Approval awaiting your review" &&
              n.href.endsWith(contract.id),
          ),
        ).toBe(true);
        await h.transition("buyer", contract, "approved", 403);
        expect(
          (await h.transition("procurement", contract, "approved")).status,
        ).toBe("approved");
      } finally {
        await patch("admin", `/approvals/policies/${policy.id}`, {
          ...data,
          enabled: false,
        });
      }
    });
    it("freezes sequential approvals and defers award/rejection until the final authorized reviewer", async () => {
      let rfq = await post(
        "buyer",
        "/records/rfqs",
        input(
          "QA controlled quotation award",
          {
            deadline: future(14),
            required_date: future(30),
            delivery_address: "QA Pune",
          },
          {
            items: [line(100, 2)],
            invitations: [org("vendor"), org("supplier")],
          },
        ),
        201,
      );
      rfq = await h.transition("buyer", rfq, "published");
      const quote = async (key: string) => {
        let q = await post(
          key,
          "/records/quotations",
          input(
            `QA ${key} response`,
            {
              delivery_date: future(25),
              validity: future(25),
              payment_terms: "Net 30",
            },
            { parent_id: rfq.id, items: [line(100, 2)] },
          ),
          201,
        );
        return h.transition(key, q, "submitted");
      };
      const vendor = await quote("vendor"),
        supplier = await quote("supplier");
      const data = {
        name: "QA two-person award",
        kind: "quotations",
        currency: "INR",
        minimum: 0,
        enabled: true,
        organization_id: org("buyer"),
        steps: [
          { name: "Sourcing review", roles: ["procurement"] },
          { name: "Final review", roles: ["super_admin"] },
        ],
      };
      const policy = await post("admin", "/approvals/policies", data, 201);
      try {
        await h.transition("buyer", vendor, "approved", 403);
        const partial = await h.transition("procurement", vendor, "approved");
        expect(partial.status).toBe("submitted");
        expect((await get("buyer", `/records/rfqs/${rfq.id}`)).status).toBe(
          "published",
        );
        expect(
          (await get("supplier", `/records/quotations/${supplier.id}`)).status,
        ).toBe("submitted");
        await patch("admin", `/approvals/policies/${policy.id}`, {
          ...data,
          steps: [{ name: "Different future policy", roles: ["org_admin"] }],
        });
        await h.transition("buyer", partial, "approved", 403);
        await h.transition("procurement", partial, "approved", 403);
        const approved = await h.transition("admin", partial, "approved");
        expect(approved.status).toBe("approved");
        expect((await get("buyer", `/records/rfqs/${rfq.id}`)).status).toBe(
          "awarded",
        );
        expect(
          (await get("supplier", `/records/quotations/${supplier.id}`)).status,
        ).toBe("rejected");
        const progress = await get("buyer", `/approvals/records/${vendor.id}`);
        expect(progress.cycles[0].decisions.length).toBe(2);
        expect(progress.cycles[0].steps[1].name).toBe("Final review");
      } finally {
        await patch("admin", `/approvals/policies/${policy.id}`, {
          ...data,
          enabled: false,
        });
      }
    });
    it("keeps authorized contacts private and synchronizes exactly one primary contact", async () => {
      const data = {
        name: "QA Finance Contact",
        email: "finance-contact@qa.example",
        phone: "+91 9000000012",
        role: "Finance",
        is_primary: true,
        active: true,
      };
      const first = await post(
        "vendor",
        `/organizations/${org("vendor")}/contacts`,
        data,
        201,
      );
      for (const phone of ["", "-------", "123456", "unknown"])
        await patch(
          "vendor",
          `/organizations/${org("vendor")}/contacts/${first.id}`,
          { ...data, phone },
          422,
        );
      expect(
        (await get("vendor", `/organizations/${org("vendor")}`)).contact_phone,
      ).toBe(data.phone);
      const secondary = await post(
        "vendor",
        `/organizations/${org("vendor")}/contacts`,
        {
          ...data,
          name: "QA Secondary Contact",
          email: "secondary@qa.example",
          phone: " ",
          is_primary: false,
        },
        201,
      );
      await patch(
        "vendor",
        `/organizations/${org("vendor")}/contacts/${secondary.id}`,
        { ...data, phone: "", is_primary: true },
        422,
      );
      await post(
        "vendor",
        `/organizations/${org("vendor")}/contacts`,
        { ...data, name: "QA Primary Contact", email: "primary@qa.example" },
        201,
      );
      const list = await get(
        "vendor",
        `/organizations/${org("vendor")}/contacts`,
      );
      expect(list.filter((c: any) => c.is_primary).length).toBe(1);
      expect(
        (await get("vendor", `/organizations/${org("vendor")}`)).contact_email,
      ).toBe("primary@qa.example");
      await get("buyer", `/organizations/${org("vendor")}/contacts`, 403);
      await patch(
        "supplier",
        `/organizations/${org("vendor")}/contacts/${first.id}`,
        data,
        403,
      );
      await patch(
        "vendor",
        `/organizations/${org("vendor")}/contacts/${list.find((c: any) => c.is_primary).id}`,
        { ...data, active: false },
        422,
      );
    });
    it("scopes resource pools by organization, enforces type restrictions and detects stale edits", async () => {
      const data = {
        title: "QA Cloud engineers",
        skills: "TypeScript, cloud",
        location: "Pune",
        experience: 4,
        count: 3,
        available_from: future(3),
        status: "available",
        rate: 1200,
        currency: "INR",
        rate_unit: "hour",
      };
      const created = await post("vendor", "/resources", data, 201);
      const visible = await get("vendor", "/resources");
      expect(visible.items.some((r: any) => r.id === created.id)).toBe(true);
      expect(
        (await get("staffing", "/resources")).items.some(
          (r: any) => r.id === created.id,
        ),
      ).toBe(false);
      await get("supplier", "/resources", 403);
      await patch("vendor", `/resources/${created.id}`, {
        ...data,
        count: 2,
        version: 1,
      });
      await patch(
        "vendor",
        `/resources/${created.id}`,
        { ...data, count: 9, version: 1 },
        409,
      );
    });
    it("applies document policies by organization type, including required expiry dates", async () => {
      const data = {
        category: "Insurance",
        organization_type: "supplier",
        required: true,
        expiry_required: true,
        reminder_days: [90, 30, 30],
      };
      await mutate("admin", "put", "/master-data/document-policies", data);
      const supplier = await get(
        "supplier",
        "/master-data/document-policies?type=supplier",
      );
      expect(
        supplier.find((p: any) => p.category === "Insurance"),
      ).toMatchObject({
        required: true,
        expiry_required: true,
        reminder_days: [90, 30],
      });
      expect(
        (
          await get("vendor", "/master-data/document-policies?type=vendor")
        ).find((p: any) => p.category === "Insurance").required,
      ).toBe(false);
      await upload(
        "supplier",
        { category: "Insurance" },
        undefined,
        undefined,
        422,
      );
      const saved = await upload("supplier", {
        category: "Insurance",
        expires_at: future(60),
      });
      expect(saved.expires_at).toBe(future(60));
      await mutate(
        "vendor",
        "put",
        "/master-data/document-policies",
        data,
        403,
      );
    });
    it("publishes only opted-in active company profiles without private contacts or KYC", async () => {
      const app = supertest(h.app);
      await patch("vendor", `/organizations/${org("vendor")}/marketplace`, {
        visible: false,
      });
      expect(
        (await app.get(`/api/public/partners/${org("vendor")}`)).status,
      ).toBe(404);
      await patch("vendor", `/organizations/${org("vendor")}/marketplace`, {
        visible: true,
      });
      const profile = await app.get(`/api/public/partners/${org("vendor")}`);
      expect(profile.status).toBe(200);
      expect(profile.body.contact_email).toBeUndefined();
      expect(profile.body.details.pan).toBeUndefined();
      const image = readFileSync("public/icons/partnerhub-192.png");
      const logo = await clients.vendor.agent
        .post(`/api/organizations/${org("vendor")}/logo`)
        .set("X-CSRF-Token", clients.vendor.token)
        .attach("file", image, {
          filename: "qa-logo.png",
          contentType: "image/png",
        });
      expect(logo.status, JSON.stringify(logo.body)).toBe(200);
      expect(
        (await app.get(`/api/public/partners/${org("vendor")}/logo`)).type,
      ).toBe("image/png");
      await patch("vendor", `/organizations/${org("vendor")}/marketplace`, {
        visible: false,
      });
      expect(
        (await app.get(`/api/public/partners/${org("vendor")}/logo`)).status,
      ).toBe(404);
    });
    it("persists public support enquiries and requires resolution notes and internal access", async () => {
      const response = await supertest(h.app).post("/api/public/contact").send({
        name: "QA Enquirer",
        email: "enquirer@qa.example",
        company: "QA Partner",
        message: "Please assist with our partner account setup.",
        consent: true,
      });
      expect(response.status).toBe(201);
      expect(response.body.reference).toMatch(/^INQ-/);
      const row = (await get("support", "/inquiries")).items.find(
        (i: any) => i.reference === response.body.reference,
      );
      await get("vendor", "/inquiries", 403);
      await patch(
        "support",
        `/inquiries/${row.id}`,
        { status: "resolved", resolution: "" },
        422,
      );
      await patch("support", `/inquiries/${row.id}`, {
        status: "resolved",
        resolution: "Account setup guidance provided.",
      });
      expect(
        (
          await supertest(h.app).post("/api/public/setup").send({
            name: "QA Second Admin",
            email: "second-admin@qa.example",
            password: demoPassword,
          })
        ).status,
      ).toBe(409);
    });
    it("binds contract signing to both parties, the source PDF, OTP and immutable evidence", async () => {
      let contract = await createContract();
      const doc = await upload("buyer", {
        category: "Contract",
        record_id: contract.id,
      });
      const envelope = await post(
        "buyer",
        `/signatures/contracts/${contract.id}`,
        {
          documentId: doc.id,
          signerIds: [clients.buyer.user.id, clients.vendor.user.id],
          version: contract.version,
        },
        201,
      );
      const details = await get(
          "buyer",
          `/signatures/contracts/${contract.id}`,
        ),
        digest = details.items[0].source_digest;
      await h.transition("buyer", contract, "active", 422);
      await post("supplier", `/signatures/${envelope.id}/otp`, {}, 404);
      await upload(
        "buyer",
        { category: "Contract", record_id: contract.id, previous_id: doc.id },
        undefined,
        undefined,
        409,
      );
      for (const key of ["buyer", "vendor"]) {
        const challenge = await post(key, `/signatures/${envelope.id}/otp`, {});
        const signed = {
          challengeId: challenge.challengeId,
          code: challenge.verificationCode,
          name: key === "vendor" ? "QA शिवाय" : clients[key].user.name,
          consent: true,
          sourceDigest: digest,
        };
        await post(
          key,
          `/signatures/${envelope.id}/sign`,
          { ...signed, sourceDigest: "0".repeat(64) },
          409,
        );
        await post(
          key,
          `/signatures/${envelope.id}/sign`,
          { ...signed, code: "000000" },
          422,
        );
        await post(key, `/signatures/${envelope.id}/sign`, signed);
        expect(
          (
            await currentDb()("signature_parties")
              .where({
                envelope_id: envelope.id,
                user_id: clients[key].user.id,
              })
              .first()
          ).otp_hash,
        ).toBeNull();
      }
      const evidence = await get(
        "buyer",
        `/signatures/${envelope.id}/evidence`,
      );
      expect(
        createHash("sha256")
          .update(evidence.canonicalContractJson)
          .digest("hex"),
      ).toBe(evidence.contractSha256);
      expect(
        evidence.signatures.some((s: any) => s.signed_name === "QA शिवाय"),
      ).toBe(true);
      const certificate = await clients.buyer.agent.get(
        `/api/signatures/${envelope.id}/certificate`,
      );
      expect(certificate.status).toBe(200);
      expect(certificate.type).toBe("application/pdf");
      contract = await h.transition("buyer", contract, "active");
      expect(contract.status).toBe("active");
      await post(
        "buyer",
        `/signatures/${envelope.id}/void`,
        { note: "Attempt to change completed evidence" },
        422,
      );
    });
    it("keeps an invoice unpaid until the final payment approval and rejects self-approval", async () => {
      const contract = await h.transition(
        "buyer",
        await createContract(),
        "active",
      );
      let invoice = await post(
        "vendor",
        "/records/invoices",
        input(
          "QA sequential payment invoice",
          {
            invoice_number: "QA-PAYMENT-APPROVAL",
            invoice_date: future(0),
            due_date: future(20),
          },
          { parent_id: contract.id },
        ),
        201,
      );
      invoice = await h.transition("vendor", invoice, "submitted");
      invoice = await h.transition("finance", invoice, "under_review");
      invoice = await h.transition("finance", invoice, "approved");
      let payment = await post(
        "buyer",
        "/records/payments",
        input(
          "QA sequential payment",
          {
            amount: invoice.amount_minor / 100,
            reference: "QA-REF-APPROVAL",
            transaction_id: "QA-TXN-APPROVAL",
            payment_date: future(0),
          },
          { parent_id: invoice.id },
        ),
        201,
      );
      payment = await h.transition("buyer", payment, "processing");
      const data = {
        name: "QA payment approval",
        kind: "payments",
        currency: "INR",
        minimum: 0,
        enabled: true,
        organization_id: org("buyer"),
        steps: [
          { name: "Finance review", roles: ["finance", "org_admin"] },
          { name: "Payment authorization", roles: ["super_admin"] },
        ],
      };
      const policy = await post("admin", "/approvals/policies", data, 201);
      try {
        await h.transition("buyer", payment, "completed", 422);
        const partial = await h.transition("finance", payment, "completed");
        expect(partial.status).toBe("processing");
        expect(
          (await get("finance", `/records/invoices/${invoice.id}`)).status,
        ).toBe("approved");
        await h.transition("admin", partial, "completed");
        expect(
          (await get("finance", `/records/invoices/${invoice.id}`)).status,
        ).toBe("paid");
      } finally {
        await patch("admin", `/approvals/policies/${policy.id}`, {
          ...data,
          enabled: false,
        });
      }
    });
    it("signs outgoing webhooks and excludes draft records from the buyer endpoint", async () => {
      const buyer = await post(
        "buyer",
        "/integrations/webhooks",
        { name: "QA buyer ERP", url: receiverUrl, events: ["quotations"] },
        201,
      );
      const vendor = await post(
        "vendor",
        "/integrations/webhooks",
        { name: "QA vendor ERP", url: receiverUrl, events: ["quotations"] },
        201,
      );
      let rfq = await post(
        "buyer",
        "/records/rfqs",
        input(
          "QA webhook draft isolation",
          {
            deadline: future(14),
            required_date: future(30),
            delivery_address: "Pune",
          },
          { items: [line(100, 1)], invitations: [org("vendor")] },
        ),
        201,
      );
      rfq = await h.transition("buyer", rfq, "published");
      let quote = await post(
        "vendor",
        "/records/quotations",
        input(
          "QA confidential draft",
          {
            delivery_date: future(25),
            validity: future(25),
            payment_terms: "Net 30",
          },
          { parent_id: rfq.id, items: [line(100, 1)] },
        ),
        201,
      );
      expect(
        (
          await currentDb()("webhook_deliveries").where({
            endpoint_id: buyer.id,
          })
        ).length,
      ).toBe(0);
      expect(
        (
          await currentDb()("webhook_deliveries").where({
            endpoint_id: vendor.id,
          })
        ).length,
      ).toBeGreaterThan(0);
      quote = await h.transition("vendor", quote, "submitted");
      const { deliverWebhooks } = await import("../server/webhooks.js");
      await deliverWebhooks();
      expect(webhookMessages.length).toBeGreaterThan(0);
      const message = webhookMessages.find(
        (m) => JSON.parse(m.body).organization_id === org("buyer"),
      )!;
      expect(message.headers["x-partnerhub-signature"]).toBe(
        `sha256=${createHmac("sha256", buyer.secret).update(`${message.headers["x-partnerhub-timestamp"]}.${message.body}`).digest("hex")}`,
      );
      await patch("buyer", `/integrations/webhooks/${buyer.id}`, {
        active: false,
      });
      await patch("vendor", `/integrations/webhooks/${vendor.id}`, {
        active: false,
      });
    });
    it("rechecks webhook access at delivery and retries only failed HTTP deliveries", async () => {
      const endpoint = await post(
        "vendor",
        "/integrations/webhooks",
        {
          name: "QA revocation endpoint",
          url: receiverUrl,
          events: ["tickets"],
        },
        201,
      );
      await post(
        "vendor",
        "/records/tickets",
        input("QA pending event", {
          description: "Verify webhook authorization before delivery.",
        }),
        201,
      );
      const { deliverWebhooks } = await import("../server/webhooks.js");
      webhookStatus = 500;
      await deliverWebhooks();
      const queued = await currentDb()("webhook_deliveries")
        .where({ endpoint_id: endpoint.id })
        .first();
      expect(queued.status).toBe("queued");
      expect(queued.attempts).toBe(1);
      const before = webhookMessages.length,
        role = await currentDb()("roles").where({ id: "org_admin" }).first(),
        permissions = JSON.parse(role.permissions);
      delete permissions.integrations;
      await currentDb()("webhook_deliveries")
        .where({ id: queued.id })
        .update({ next_attempt: stamp() });
      try {
        await currentDb()("roles")
          .where({ id: role.id })
          .update({ permissions: JSON.stringify(permissions) });
        await deliverWebhooks();
        expect(webhookMessages.length).toBe(before);
        expect(
          (
            await currentDb()("webhook_deliveries")
              .where({ id: queued.id })
              .first()
          ).status,
        ).toBe("cancelled");
      } finally {
        webhookStatus = 204;
        await currentDb()("roles")
          .where({ id: role.id })
          .update({ permissions: role.permissions });
      }
      await patch("vendor", `/integrations/webhooks/${endpoint.id}`, {
        active: false,
      });
    });
    it("applies token scope, tenant isolation, current permissions, expiration and revocation", async () => {
      const key = await post(
        "vendor",
        "/integrations/tokens",
        { name: "QA read-only ERP", scopes: ["orders"], expiresInDays: 1 },
        201,
      );
      const bearer = (route: string) =>
        supertest(h.app)
          .get(`/api/integration${route}`)
          .auth(key.token, { type: "bearer" });
      expect((await bearer("/records/orders")).status).toBe(200);
      expect((await bearer(`/records/orders/${rid("po:chairs")}`)).status).toBe(
        404,
      );
      expect((await bearer("/records/invoices")).status).toBe(403);
      expect(
        (await currentDb()("integration_tokens").where({ id: key.id }).first())
          .token_hash,
      ).not.toBe(key.token);
      await currentDb()("integration_tokens")
        .where({ id: key.id })
        .update({ expires_at: new Date(Date.now() - 1000).toISOString() });
      expect((await bearer("/records/orders")).status).toBe(401);
      await mutate("vendor", "delete", `/integrations/tokens/${key.id}`);
      expect((await bearer("/records/orders")).status).toBe(401);
    });
    it("returns unavailable forecasts when evidence is insufficient and keeps alerts tenant-scoped", async () => {
      const result = await get("business", "/insights");
      expect(
        result.forecasts.every(
          (f: any) => !f.available && f.next28Days === undefined,
        ),
      ).toBe(true);
      const vendor = await get("vendor", "/insights");
      for (const alert of vendor.alerts)
        for (const source of alert.sources) {
          if (source.type === "record")
            expect(
              (await get("vendor", source.href.replace("/app/", "/records/")))
                .id,
            ).toBe(source.id);
          if (source.type === "document")
            expect((await get("vendor", `/documents/${source.id}`)).id).toBe(
              source.id,
            );
        }
      expect(
        (await get("vendor", "/insights/performance")).items.every(
          (o: any) => o.id === org("vendor"),
        ),
      ).toBe(true);
    });
    it("retrieves older pending RFQs with exact filtered counts instead of relying on the latest workspace snapshot", async () => {
      const db = currentDb(),
        at = stamp(),
        ids: string[] = [];
      const base = {
        kind: "rfqs",
        owner_org_id: org("buyer"),
        buyer_org_id: org("buyer"),
        partner_org_id: null,
        parent_id: null,
        amount_minor: 0,
        currency: "INR",
        payload: JSON.stringify({
          deadline: future(10),
          required_date: future(30),
          delivery_address: "QA address",
        }),
        version: 1,
        created_by: clients.buyer.user.id,
        created_at: at,
        updated_at: at,
      };
      try {
        const target = randomUUID();
        ids.push(target);
        await db("records").insert({
          ...base,
          id: target,
          number: `QA-AI-OLD-${target.slice(0, 8)}`,
          title: "Cedar network pending request",
          status: "published",
          updated_at: new Date(Date.now() - 100 * 86400000).toISOString(),
        });
        for (let i = 0; i < 42; i++) {
          const id = randomUUID();
          ids.push(id);
          await db("records").insert({
            ...base,
            id,
            number: `QA-AI-RECENT-${id.slice(0, 8)}`,
            title: `Recent closed request ${i}`,
            status: "closed",
          });
        }
        await db("record_invitations").insert(
          ids.map((id) => ({ record_id: id, organization_id: org("vendor") })),
        );
        lookupFixture = {
          records: [
            {
              module: "rfqs",
              statuses: ["published", "evaluation"],
              query: "Cedar",
              dueBefore: "",
              createdBefore: "",
            },
          ],
          documents: null,
          partners: null,
          includeAlerts: false,
        };
        const answer = await post("vendor", "/ai/chat", {
          message: "Show me the pending Cedar RFQs.",
        });
        const context = JSON.parse(providerBody.contents.at(-1).parts[0].text);
        expect(
          context.workspace.recentRecords.some((r: any) => r.id === target),
        ).toBe(false);
        expect(context.lookups.records[0].items.map((r: any) => r.id)).toEqual([
          target,
        ]);
        expect(context.lookups.records[0].total).toBe(1);
        expect(
          answer.messages.at(-1).structured.retrieval.records[0].total,
        ).toBe(1);
        await post("supplier", "/ai/chat", {
          message: "Show me the pending Cedar RFQs.",
        });
        expect(
          JSON.parse(providerBody.contents.at(-1).parts[0].text).lookups
            .records[0].total,
        ).toBe(0);
      } finally {
        lookupFixture = undefined;
        await db("record_invitations").whereIn("record_id", ids).delete();
        await db("records").whereIn("id", ids).delete();
      }
    });
    it("looks up current company document status and supplies only permitted module navigation", async () => {
      lookupFixture = {
        records: [],
        documents: { query: "PAN", statuses: [], expiresBefore: "" },
        partners: null,
        includeAlerts: false,
      };
      try {
        await post("vendor", "/ai/chat", {
          message: "Explain my PAN document status and where I can review it.",
        });
        const context = JSON.parse(providerBody.contents.at(-1).parts[0].text);
        expect(context.lookups.documents.total).toBeGreaterThan(0);
        expect(
          context.lookups.documents.items.every(
            (d: any) => !d.storage_key && !d.file_content,
          ),
        ).toBe(true);
        for (const d of context.lookups.documents.items)
          expect(
            (await get("vendor", `/documents/${d.id}`)).organization_id,
          ).toBe(org("vendor"));
        expect(
          context.workspace.platformGuide.navigation.some(
            (m: any) => m.id === "module:documents",
          ),
        ).toBe(true);
        expect(
          context.workspace.platformGuide.navigation.some(
            (m: any) => m.id === "module:verification",
          ),
        ).toBe(false);
        await post("support", "/ai/chat", {
          message: "Show me company PAN documents.",
        });
        expect(
          JSON.parse(providerBody.contents.at(-1).parts[0].text).lookups
            .documents.denied,
        ).toBe(true);
      } finally {
        lookupFixture = undefined;
      }
    });
    it("validates all eight extracted identity fields without approving a document or changing the profile", async () => {
      const doc = await upload("vendor", { category: "PAN" });
      identityFixture = {
        ...emptyIdentity(),
        company_name: "A different company",
        pan: "NOT-A-PAN",
        gst: "27ABCDE1234F1Z5",
        cin: "L12345MH2020PLC123456",
        registration_number: "REG-QA-100",
        expiry_date: "2026-02-31",
        certificate_type: "PAN card",
        address: "QA registered address",
      };
      const before = await currentDb()("organizations")
        .where({ id: org("vendor") })
        .first();
      try {
        const result = await post("vendor", "/ai/extract-document", {
          documentId: doc.id,
        });
        expect(Object.keys(result.result.identity)).toHaveLength(8);
        expect(
          result.result.validation.find((c: any) => c.field === "pan").status,
        ).toBe("invalid");
        expect(
          result.result.validation.find((c: any) => c.field === "expiry_date")
            .status,
        ).toBe("invalid");
        expect(
          result.result.validation.find((c: any) => c.field === "company_name")
            .status,
        ).toBe("warning");
        expect(result.reviewStatus).toBe("pending_human_review");
        expect((await get("vendor", `/documents/${doc.id}`)).status).toBe(
          "uploaded",
        );
        expect(
          (
            await currentDb()("organizations")
              .where({ id: org("vendor") })
              .first()
          ).details,
        ).toBe(before.details);
        await get("buyer", `/documents/${doc.id}/extractions`, 403);
        await get("supplier", `/documents/${doc.id}`, 404);
      } finally {
        identityFixture = undefined;
      }
    });
    it("records human OCR corrections with source evidence and prevents an external user from making the compliance decision", async () => {
      const doc = await upload("vendor", { category: "PAN" });
      const organization = await currentDb()("organizations")
        .where({ id: org("vendor") })
        .first();
      identityFixture = {
        ...emptyIdentity(),
        company_name: organization.legal_name,
        pan: "UNREADABLE",
      };
      try {
        const result = await post("vendor", "/ai/extract-document", {
          documentId: doc.id,
        });
        const fields = {
          ...emptyIdentity(),
          company_name: organization.legal_name,
          pan: JSON.parse(organization.details).pan || "ABCDE1234F",
        };
        const body = {
          status: "approved",
          note: "Source inspected manually and identifier confirmed against the company profile.",
          extraction: {
            extractionId: result.id,
            fields,
            sourceConfirmed: true,
          },
        };
        await post("vendor", `/documents/${doc.id}/review`, body, 403);
        await post(
          "verification",
          `/documents/${doc.id}/review`,
          {
            ...body,
            extraction: { ...body.extraction, sourceConfirmed: false },
          },
          422,
        );
        const other = await upload("vendor", { category: "PAN" });
        await post("verification", `/documents/${other.id}/review`, body, 404);
        expect(
          (await get("verification", `/documents/${doc.id}/extractions`))
            .items[0].id,
        ).toBe(result.id);
        expect(
          (await post("verification", `/documents/${doc.id}/review`, body))
            .status,
        ).toBe("approved");
        const saved = await get("vendor", `/ai/extractions/${result.id}`);
        expect(saved.result.identity.pan).toBe("UNREADABLE");
        expect(saved.reviews[0].fields.pan).toBe(fields.pan);
        expect(saved.reviews[0].source_digest).toBe(result.sourceDigest);
        expect(saved.reviewStatus).toBe("reviewed");
        await post("vendor", "/ai/chat", {
          message:
            "What was corrected during the human review of this document?",
          documentId: doc.id,
        });
        const evidence = JSON.parse(
          providerBody.contents.at(-1).parts[0].text,
        ).selectedDocument;
        expect(evidence.identity.pan).toBe("UNREADABLE");
        expect(evidence.humanReview.fields.pan).toBe(fields.pan);
        expect(evidence.humanReview.decision).toBe("approved");
        await mutate(
          "vendor",
          "delete",
          `/ai/extractions/${result.id}`,
          {},
          409,
        );
      } finally {
        identityFixture = undefined;
      }
    });
    it("keeps requirement analysis reviewable and persists skills, quantity, experience, technology and delivery after an authorized save", async () => {
      const db = currentDb(),
        before = Number((await db("records").count({ n: "*" }).first()).n);
      draftFixture = {
        title: "QA specialist hiring requirement",
        payload: {
          requirement_type: "hiring",
          description: "Four TypeScript specialists for a remote support team.",
          category: "IT Services",
          required_date: future(30),
          deadline: future(10),
          location: "Pune",
          budget: 0,
          quantity: 0,
          positions: 4,
          skills: "TypeScript, React",
          experience: "5–7 years",
          technology: "TypeScript",
          delivery_requirements: "Start within 30 days",
          criteria: "Verified staffing partners",
        },
        items: [],
      };
      try {
        const result = await post("hr", "/ai/draft-requirement", {
          brief:
            "Need 4 TypeScript and React specialists with 5–7 years experience in Pune, remote team starting within 30 days.",
        });
        const draft = result.messages.at(-1).structured.draft;
        expect(draft.payload).toMatchObject({
          quantity: 4,
          positions: 4,
          experience: "5–7 years",
          technology: "TypeScript",
          delivery_requirements: "Remote team. Start within 30 days",
        });
        expect(Number((await db("records").count({ n: "*" }).first()).n)).toBe(
          before,
        );
        const saved = await post(
          "hr",
          "/records/requirements",
          input(draft.title, draft.payload, { items: draft.items }),
          201,
        );
        expect(saved.status).toBe("draft");
        expect(saved.payload.technology).toBe("TypeScript");
      } finally {
        draftFixture = undefined;
      }
    });
    it("provides factual quotation totals and terms to the buyer without awarding or exposing competitors to a vendor", async () => {
      const db = currentDb(),
        group = await db("records")
          .where({ kind: "quotations", buyer_org_id: org("buyer") })
          .whereNot("status", "draft")
          .select("parent_id")
          .count({ n: "*" })
          .groupBy("parent_id")
          .orderBy("n", "desc")
          .first();
      const before = await db("records").where({ id: group.parent_id }).first();
      await post(
        "vendor",
        "/ai/analyze-quotations",
        { rfqId: group.parent_id },
        403,
      );
      const answer = await post("buyer", "/ai/analyze-quotations", {
        rfqId: group.parent_id,
      });
      const comparison = answer.messages.at(-1).structured.comparison;
      expect(comparison.length).toBeGreaterThan(0);
      for (const quote of comparison) {
        const source = await get("buyer", `/records/quotations/${quote.id}`);
        expect(quote.total_minor).toBe(source.amount_minor);
        expect(quote.total_minor).toBe(
          quote.subtotal_minor -
            quote.discount_minor +
            quote.tax_minor +
            quote.delivery_charges_minor,
        );
        expect(quote.payment_terms).toBe(source.payload.payment_terms);
        expect(quote.delivery_date).toBe(source.payload.delivery_date);
        expect(quote).toHaveProperty("missingInformation");
      }
      expect(
        (await db("records").where({ id: group.parent_id }).first()).status,
      ).toBe(before.status);
    });
    it("filters smart discovery by all specified business fields without searching confidential KYC values", async () => {
      const db = currentDb(),
        original = await db("organizations")
          .where({ id: org("vendor") })
          .first();
      const detail = {
        ...JSON.parse(original.details),
        products: "industrial controllers",
        services: "cloud integration",
        technologies: "edge AI",
        certifications: "ISO 9001",
        capabilities: "device management",
        pan: "PRIVATE-DO-NOT-DISCOVER",
      };
      lookupFixture = {
        records: [],
        documents: null,
        partners: null,
        includeAlerts: false,
      };
      try {
        await db("organizations")
          .where({ id: original.id })
          .update({
            industry: "QA manufacturing",
            city: "Pune",
            status: "active",
            details: JSON.stringify(detail),
          });
        const criteria = {
          industry: "QA manufacturing",
          category: "controller",
          location: "Pune",
          products: "controllers",
          services: "cloud integration",
          technology: "edge AI",
          certifications: "ISO 9001",
          capabilities: "device management",
          verification: "active",
        };
        const result = await post("buyer", "/ai/discover", {
          brief: "Find a partner matching these industrial capabilities",
          criteria,
        });
        const context = JSON.parse(providerBody.contents.at(-1).parts[0].text);
        expect(context.organizations.map((o: any) => o.id)).toEqual([
          original.id,
        ]);
        expect(JSON.stringify(context)).not.toContain(detail.pan);
        expect(result.messages.at(-1).structured.discovery.total).toBe(1);
        await post("buyer", "/ai/discover", {
          brief: "Find a specific private identifier",
          criteria: { query: detail.pan },
        });
        expect(
          JSON.parse(providerBody.contents.at(-1).parts[0].text).organizations,
        ).toHaveLength(0);
      } finally {
        lookupFixture = undefined;
        await db("organizations").where({ id: original.id }).update({
          industry: original.industry,
          city: original.city,
          status: original.status,
          details: original.details,
        });
      }
    });
    it("calculates all seven operational signal categories from actual dated records and respects tenant access", async () => {
      const db = currentDb(),
        ids: string[] = [],
        auditIds: string[] = [];
      const partner = await db("organizations")
          .where({ id: org("vendor") })
          .first(),
        trendOrgId = randomUUID();
      await db("organizations").insert({
        ...partner,
        id: trendOrgId,
        number: `QA-TREND-${trendOrgId.slice(0, 8)}`,
        legal_name: "QA Response Trend Partner",
      });
      const date = (days: number) =>
        new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
      async function record(
        kind: string,
        status: string,
        payload: any,
        days = 0,
        extra: any = {},
      ) {
        const id = randomUUID();
        ids.push(id);
        const at = `${date(days)}T12:00:00.000Z`;
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
      async function event(r: any, status: string, days: number) {
        const id = randomUUID();
        auditIds.push(id);
        await db("audit_logs").insert({
          id,
          actor_name: "QA lifecycle fixture",
          role: "system",
          action: "transition",
          module: r.kind,
          record_id: r.id,
          new_status: status,
          remarks: "Dated test evidence",
          created_at: `${date(days)}T12:00:00.000Z`,
        });
      }
      const doc = await upload("vendor", {
        category: "Insurance",
        expires_at: date(14),
      });
      try {
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
              organization_id: trendOrgId,
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
                  owner_org_id: trendOrgId,
                  partner_org_id: trendOrgId,
                },
              );
              await event(quote, "submitted", deadline - 5);
            }
          }
        const outlook = await get("vendor", "/insights");
        const categories = new Set(outlook.alerts.map((a: any) => a.category));
        for (const kind of [
          "contract_expiry",
          "document_expiry",
          "delayed_delivery",
          "invoice_aging",
          "unusual_procurement",
        ])
          expect(categories.has(kind), kind).toBe(true);
        expect(
          outlook.alerts.some((a: any) =>
            a.sources.some((s: any) => s.id === doc.id),
          ),
        ).toBe(true);
        expect(
          outlook.alerts.find(
            (a: any) =>
              a.category === "invoice_aging" &&
              a.sources.some((s: any) => s.id === invoice.id),
          ).description,
        ).toContain("INR 90.00");
        const buyer = await get("buyer", "/insights");
        expect(
          buyer.alerts.some((a: any) => a.category === "recruitment_aging"),
        ).toBe(true);
        expect(
          buyer.alerts.some(
            (a: any) =>
              a.category === "vendor_response" && a.id.includes(trendOrgId),
          ),
        ).toBe(true);
        const supplier = await get("supplier", "/insights");
        expect(
          supplier.alerts.every((a: any) =>
            a.sources.every((s: any) => !ids.includes(s.id) && s.id !== doc.id),
          ),
        ).toBe(true);
        expect(
          outlook.forecasts.find((f: any) => f.kind === "orders").available,
        ).toBe(true);
        const trend = buyer.responseTrends.find(
          (t: any) => t.organizationId === trendOrgId,
        );
        expect(trend.available).toBe(true);
        expect(trend.previous.onTimeRate).toBeGreaterThan(
          trend.recent.onTimeRate,
        );
        const statuses = await db("records")
          .whereIn("id", ids)
          .select("id", "status")
          .orderBy("id");
        const analysis = await post("vendor", "/ai/analyze-alerts", {});
        expect(
          analysis.messages.at(-1).structured.alertSummary.totalAlerts,
        ).toBe(outlook.totalAlerts);
        expect(
          await db("records")
            .whereIn("id", ids)
            .select("id", "status")
            .orderBy("id"),
        ).toEqual(statuses);
        await post("support", "/ai/analyze-alerts", {}, 403);
      } finally {
        await db("audit_logs").whereIn("id", auditIds).delete();
        await db("record_invitations").whereIn("record_id", ids).delete();
        for (const id of [...ids].reverse())
          await db("records").where({ id }).delete();
        await db("organizations").where({ id: trendOrgId }).delete();
      }
    });
    it("normalizes domain-only company websites and rejects unsafe or malformed website input", async () => {
      const before = await get("vendor", `/organizations/${org("vendor")}`);
      try {
        const saved = await patch("vendor", `/organizations/${org("vendor")}`, {
          ...before,
          website: " www.writoryofficial.com ",
        });
        expect(saved.website).toBe("https://www.writoryofficial.com/");
        for (const website of [
          "not a website",
          "javascript:alert(1)",
          "https://name:password@company.com",
        ])
          await patch(
            "vendor",
            `/organizations/${org("vendor")}`,
            { ...before, website },
            422,
          );
        expect(
          (await get("vendor", `/organizations/${org("vendor")}`)).website,
        ).toBe(saved.website);
      } finally {
        await patch("vendor", `/organizations/${org("vendor")}`, before);
      }
    });
  });
}
