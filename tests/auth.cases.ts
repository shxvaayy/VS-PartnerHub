import { describe, expect, it } from "vitest";
import supertest from "supertest";
import { demoPassword } from "../shared/demo.js";
import { emailSchema } from "../shared/auth.js";
import { companyDetailsSchema } from "../server/validation.js";

export function authCases(h: any) {
  describe("complete account authentication", () => {
    const registration = (
      email: string,
      companyEmail = "office@auth.example",
    ) => ({
      name: "Authentication QA",
      email,
      password: demoPassword,
      accept_terms: true,
      organization: {
        type: "vendor",
        legal_name: "Authentication QA Company",
        industry: "Technology",
        city: "Pune",
        contact_name: "Authentication QA",
        contact_email: email,
        contact_phone: "+91 9000000010",
        details: {
          description: "Isolated authentication acceptance verification.",
          services: "Software services",
          capabilities: "Software delivery",
          locations: "Pune",
          company_email: companyEmail,
        },
      },
    });
    async function register(email: string) {
      const agent = supertest.agent(h.app);
      const response = await agent
        .post("/api/auth/register")
        .send(registration(email));
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      return { agent, ...response.body };
    }
    async function login(email: string, agent = supertest.agent(h.app)) {
      const response = await agent
        .post("/api/auth/login")
        .set("User-Agent", "Authentication QA Browser")
        .send({ email, password: demoPassword });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return { agent, ...response.body };
    }
    const mutate = (account: any, path: string, data: any) =>
      account.agent
        .post(`/api/auth${path}`)
        .set("X-CSRF-Token", account.csrfToken)
        .send(data);
    it("validates complete email addresses and optional company email without inventing a Gmail ban", async () => {
      expect(emailSchema.parse("  Partner.Name+sales@Company.CO.IN  ")).toBe(
        "partner.name+sales@company.co.in",
      );
      expect(emailSchema.safeParse("business.contact@gmail.com").success).toBe(
        true,
      );
      expect(
        companyDetailsSchema.parse({ company_email: " OFFICE@Company.com " })
          .company_email,
      ).toBe("office@company.com");
      expect(
        companyDetailsSchema.parse({ company_email: "  " }).company_email,
      ).toBe("");
      for (const invalid of [
        "plain-text",
        "name@",
        "@company.com",
        "name@company",
        "name@@company.com",
        "name surname@company.com",
        "Name <name@company.com>",
        "name..surname@company.com",
      ]) {
        expect(emailSchema.safeParse(invalid).success, invalid).toBe(false);
        expect(
          companyDetailsSchema.safeParse({ company_email: invalid }).success,
          invalid,
        ).toBe(false);
      }
      const rejected = await supertest(h.app)
        .post("/api/auth/register")
        .send(registration("rejected@auth.example", "not-a-company-email"));
      expect(rejected.status).toBe(422);
      expect(
        await h.db("users").where({ email: "rejected@auth.example" }).first(),
      ).toBeUndefined();
    });
    it("normalizes account identity, rejects duplicate registration, and accepts the same normalized identity at login", async () => {
      const account = await register("  Identity+business@Auth.Example ");
      expect(account.user.email).toBe("identity+business@auth.example");
      expect(account.user.email_verified).toBe(false);
      expect(account.user.password_hash).toBeUndefined();
      const duplicate = await supertest(h.app)
        .post("/api/auth/register")
        .send(registration("identity+business@auth.example"));
      expect(duplicate.status).toBe(409);
      const signed = await login("IDENTITY+BUSINESS@AUTH.EXAMPLE");
      expect(signed.user.id).toBe(account.user.id);
    });
    it("enforces OTP attempt limits under concurrent guesses and enforces resend cooldowns", async () => {
      const account = await register("attempts@auth.example");
      expect((await mutate(account, "/resend-code", {})).status).toBe(429);
      const attempts = await Promise.all(
        Array.from({ length: 8 }, () =>
          mutate(account, "/verify", { code: "000000" }),
        ),
      );
      expect(attempts.every((response) => response.status === 422)).toBe(true);
      const original = await h
        .db("auth_tokens")
        .where({ user_id: account.user.id, kind: "verify" })
        .first();
      expect(original.attempts).toBe(5);
      expect(
        (await mutate(account, "/verify", { code: account.verificationCode }))
          .status,
      ).toBe(422);
      await h
        .db("auth_tokens")
        .where({ id: original.id })
        .update({ created_at: new Date(Date.now() - 61000).toISOString() });
      const resent = await mutate(account, "/resend-code", {});
      expect(resent.status).toBe(200);
      expect(Date.parse(resent.body.resendAt)).toBeGreaterThan(Date.now());
      expect(
        await h.db("auth_tokens").where({ id: original.id }).first(),
      ).toBeUndefined();
      expect(
        (await h.db("email_outbox").where({ id: original.email_id }).first())
          .status,
      ).toBe("expired");
      expect(
        (
          await mutate(account, "/verify", {
            code: resent.body.verificationCode,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await mutate(account, "/verify", {
            code: resent.body.verificationCode,
          })
        ).status,
      ).toBe(422);
    });
    it("corrects only an unverified email after checking the password and revokes the previous identity's sessions and codes", async () => {
      const account = await register("mistyped@auth.example"),
        otherSession = await login("mistyped@auth.example");
      expect(
        (
          await mutate(account, "/correct-email", {
            email: "correct@auth.example",
            current_password: "wrong",
          })
        ).status,
      ).toBe(422);
      const originalToken = await h
        .db("auth_tokens")
        .where({ user_id: account.user.id, kind: "verify" })
        .first();
      const changed = await mutate(account, "/correct-email", {
        email: "CORRECT@AUTH.EXAMPLE",
        current_password: demoPassword,
      });
      expect(changed.status, JSON.stringify(changed.body)).toBe(200);
      expect(changed.body.user.email).toBe("correct@auth.example");
      expect(changed.body.user.email_verified).toBe(false);
      expect(changed.body.csrfToken).not.toBe(account.csrfToken);
      expect(
        (await otherSession.agent.get("/api/auth/session")).body.user,
      ).toBeNull();
      expect(
        await h.db("auth_tokens").where({ id: originalToken.id }).first(),
      ).toBeUndefined();
      expect(
        (
          await h
            .db("organizations")
            .where({ id: account.user.organization_id })
            .first()
        ).contact_email,
      ).toBe("correct@auth.example");
      const corrected = { agent: account.agent, ...changed.body };
      expect(
        (
          await mutate(corrected, "/verify", {
            code: corrected.verificationCode,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await mutate(corrected, "/correct-email", {
            email: "another@auth.example",
            current_password: demoPassword,
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await supertest(h.app)
            .post("/api/auth/login")
            .send({ email: "mistyped@auth.example", password: demoPassword })
        ).status,
      ).toBe(401);
    });
    it("exposes only scoped session metadata and prevents one account from revoking another account's session", async () => {
      const first = await register("session-owner@auth.example"),
        second = await login("session-owner@auth.example"),
        outsider = await register("session-outsider@auth.example");
      const list = await second.agent.get("/api/auth/sessions");
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(2);
      expect(
        list.body.every(
          (session: any) =>
            session.id.length === 36 && !session.csrf_token && !session.user_id,
        ),
      ).toBe(true);
      const earlier = list.body.find((session: any) => !session.current);
      expect(
        (
          await outsider.agent
            .delete(`/api/auth/sessions/${earlier.id}`)
            .set("X-CSRF-Token", outsider.csrfToken)
        ).status,
      ).toBe(404);
      expect(
        (
          await second.agent
            .delete(`/api/auth/sessions/${earlier.id}`)
            .set("X-CSRF-Token", second.csrfToken)
        ).status,
      ).toBe(200);
      expect((await first.agent.get("/api/auth/session")).body.user).toBeNull();
      expect((await second.agent.get("/api/auth/session")).body.user.id).toBe(
        first.user.id,
      );
      const latest = await login("session-owner@auth.example");
      expect(
        (
          await mutate(latest, "/sessions/revoke-others", {
            current_password: "wrong",
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await mutate(latest, "/sessions/revoke-others", {
            current_password: demoPassword,
          })
        ).status,
      ).toBe(200);
      expect(
        (await second.agent.get("/api/auth/session")).body.user,
      ).toBeNull();
      const active = (await latest.agent.get("/api/auth/sessions")).body[0];
      await h
        .db("sessions")
        .where({ public_id: active.id })
        .update({ expires_at: new Date(Date.now() - 1000).toISOString() });
      expect(
        (await latest.agent.get("/api/auth/session")).body.user,
      ).toBeNull();
    });
    it("keeps recovery responses private, preserves a recently issued link, and rejects an expired link before password entry", async () => {
      await register("recovery@auth.example");
      const request = (email: string) =>
        supertest(h.app).post("/api/auth/forgot-password").send({ email });
      const known = await request("recovery@auth.example"),
        unknown = await request("missing@auth.example");
      expect(known.body).toEqual(unknown.body);
      const user = await h
        .db("users")
        .where({ email: "recovery@auth.example" })
        .first();
      const initial = await h
        .db("auth_tokens")
        .where({ user_id: user.id, kind: "reset" })
        .first();
      await request("recovery@auth.example");
      expect(
        (
          await h
            .db("auth_tokens")
            .where({ user_id: user.id, kind: "reset" })
            .first()
        ).id,
      ).toBe(initial.id);
      const mail = await h
          .db("email_outbox")
          .where({ id: initial.email_id })
          .first(),
        token = mail.body.match(/token=([a-f0-9]{64})/)[1];
      expect(
        (await supertest(h.app).get(`/api/auth/reset-password/${token}`)).body
          .valid,
      ).toBe(true);
      await h
        .db("auth_tokens")
        .where({ id: initial.id })
        .update({ expires_at: new Date(Date.now() - 1000).toISOString() });
      expect(
        (await supertest(h.app).get(`/api/auth/reset-password/${token}`))
          .status,
      ).toBe(404);
      expect(
        (
          await supertest(h.app)
            .post("/api/auth/reset-password")
            .send({ token, password: "NewPassword2026!" })
        ).status,
      ).toBe(422);
    });
    it("limits password guessing across requests without storing the attempted email in rate-limit records", async () => {
      const email = "guess-target@auth.example";
      for (let i = 0; i < 10; i++)
        expect(
          (
            await supertest(h.app)
              .post("/api/auth/login")
              .send({ email, password: "WrongPassword" })
          ).status,
        ).toBe(401);
      expect(
        (
          await supertest(h.app)
            .post("/api/auth/login")
            .send({ email, password: "WrongPassword" })
        ).status,
      ).toBe(429);
      expect(JSON.stringify(await h.db("auth_attempts"))).not.toContain(email);
    });
    it("refuses invitations if the issuing administrator's authority has been revoked", async () => {
      const invitation = await h.post(
        "vendor",
        "/admin/team/invite",
        {
          name: "Authority QA",
          email: "authority@auth.example",
          role: "org_member",
        },
        201,
      );
      const token = new URL(invitation.invitationUrl).searchParams.get("token");
      const id = h.clients.vendor.user.id;
      await h.db("users").where({ id }).update({ active: false });
      try {
        expect(
          (await supertest(h.app).get(`/api/auth/invitation/${token}`)).status,
        ).toBe(422);
        expect([401, 422]).toContain(
          (
            await supertest(h.app)
              .post("/api/auth/accept-invitation")
              .send({ token, password: demoPassword, name: "Authority QA" })
          ).status,
        );
        expect(
          await h
            .db("users")
            .where({ email: "authority@auth.example" })
            .first(),
        ).toBeUndefined();
      } finally {
        await h.db("users").where({ id }).update({ active: true });
      }
    });
    it("fails explicitly when production-style email delivery is unconfigured without creating an account or returning a code", async () => {
      const { config } = await import("../server/config.js");
      const previous = config.demo;
      config.demo = false;
      try {
        const response = await supertest(h.app)
          .post("/api/auth/register")
          .send(registration("no-provider@auth.example"));
        expect(response.status).toBe(503);
        expect(response.body.verificationCode).toBeUndefined();
        expect(
          await h
            .db("users")
            .where({ email: "no-provider@auth.example" })
            .first(),
        ).toBeUndefined();
        expect(
          (
            await supertest(h.app)
              .post("/api/auth/forgot-password")
              .send({ email: "recovery@auth.example" })
          ).status,
        ).toBe(503);
      } finally {
        config.demo = previous;
      }
    });
  });
}
