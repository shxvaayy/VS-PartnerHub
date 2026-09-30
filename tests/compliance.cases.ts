import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// The existing platform harness supplies an isolated SQLite/PostgreSQL database.
// These cases verify persisted reminders and decisions, including changes made
// after the worker has read its initial batch.
export function complianceCases(h: any) {
  describe("compliance expiry and concurrent decisions", () => {
    const day = 86400000;
    const date = (at: number) => new Date(at).toISOString().slice(0, 10);
    const stamp = () => new Date().toISOString();
    async function document(
      key: string,
      expires: string,
      category = "PAN",
      extra: object = {},
    ) {
      const id = randomUUID();
      await h.db("documents").insert({
        id,
        organization_id: h.org(key),
        category,
        name: `Compliance check ${id}.pdf`,
        storage_key: id,
        mime_type: "application/pdf",
        size: 100,
        status: "approved",
        uploaded_by: h.clients[key].user.id,
        expires_at: expires,
        created_at: stamp(),
        updated_at: stamp(),
        ...extra,
      });
      return id;
    }
    const reminders = (id: string, key = "vendor") =>
      h
        .db("notifications")
        .where({ user_id: h.clients[key].user.id, category: "document_expiry" })
        .where("dedupe_key", "like", `document:${id}:%`)
        .orderBy("created_at");

    async function changeAfterBatch(
      table: string,
      id: string,
      change: () => Promise<void>,
    ) {
      const { maintenance } = await import("../server/maintenance.js");
      let seen = false;
      let changed = false;
      const observe = (rows: any, query: any) => {
        if (
          query.method === "select" &&
          query.sql.includes(table) &&
          Array.isArray(rows) &&
          rows.some((row: any) => row.id === id)
        )
          seen = true;
      };
      const transaction = h.db.transaction.bind(h.db);
      const spy = vi
        .spyOn(h.db, "transaction")
        .mockImplementation(async (callback: any, ...args: any[]) => {
          if (seen && !changed) {
            changed = true;
            await change();
          }
          return transaction(callback, ...args);
        });
      h.db.on("query-response", observe);
      try {
        await maintenance();
        expect(
          changed,
          "The concurrent change must happen after the batch read.",
        ).toBe(true);
      } finally {
        spy.mockRestore();
        h.db.off("query-response", observe);
      }
    }

    it("sends the 90/60/30-day, due-day and expired notifications once each", async () => {
      const { maintenance } = await import("../server/maintenance.js");
      const start = Date.now();
      const id = await document("vendor", date(start + 90 * day));
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        for (const elapsed of [0, 30, 60, 90, 91]) {
          vi.setSystemTime(start + elapsed * day);
          await maintenance();
          await maintenance();
        }
        expect((await reminders(id)).map((row: any) => row.title)).toEqual([
          "Document expires in 90 days",
          "Document expires in 60 days",
          "Document expires in 30 days",
          "Document expires today",
          "Document renewal needed",
        ]);
        expect((await h.db("documents").where({ id }).first()).status).toBe(
          "expired",
        );
        const audit = await h
          .db("audit_logs")
          .where({ record_id: id, action: "document_expired" });
        expect(audit).toHaveLength(1);
        expect(audit[0]).toMatchObject({
          previous_status: "approved",
          new_status: "expired",
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("honors document-category and organization-type reminder windows", async () => {
      const { maintenance } = await import("../server/maintenance.js");
      const category = `QA-${randomUUID().slice(0, 8)}`;
      await h.db("master_data").insert({
        id: randomUUID(),
        kind: "document",
        code: category.toLowerCase(),
        label: category,
        active: true,
        position: 0,
        metadata: "{}",
        created_at: stamp(),
        updated_at: stamp(),
      });
      for (const [type, windows] of [
        ["all", [90, 60, 30]],
        ["vendor", [75, 45, 15]],
      ] as const)
        await h.db("document_policies").insert({
          id: randomUUID(),
          category,
          organization_type: type,
          required: false,
          expiry_required: true,
          reminder_days: JSON.stringify(windows),
          updated_at: stamp(),
        });
      const start = Date.now();
      const vendor = await document("vendor", date(start + 90 * day), category);
      const supplier = await document(
        "supplier",
        date(start + 90 * day),
        category,
      );
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        await maintenance();
        expect(await reminders(vendor)).toHaveLength(0);
        expect(
          (await reminders(supplier, "supplier")).map((row: any) => row.title),
        ).toEqual(["Document expires in 90 days"]);
        for (const elapsed of [15, 45, 75]) {
          vi.setSystemTime(start + elapsed * day);
          await maintenance();
          await maintenance();
        }
        expect((await reminders(vendor)).map((row: any) => row.title)).toEqual([
          "Document expires in 75 days",
          "Document expires in 45 days",
          "Document expires in 15 days",
        ]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps existing expired notices while still notifying users who only received a due-day notice", async () => {
      const { maintenance } = await import("../server/maintenance.js");
      const id = await document("vendor", date(Date.now() - day), "PAN", {
        status: "expired",
      });
      for (const [key, title] of [
        ["vendor", "Document renewal needed"],
        ["verification", "Document expires in 0 days"],
      ])
        await h.db("notifications").insert({
          id: randomUUID(),
          user_id: h.clients[key].user.id,
          title,
          body: "Existing notice from the preceding release.",
          href: "/app/documents",
          category: "document_expiry",
          dedupe_key: `document:${id}:0`,
          created_at: new Date(Date.now() - day).toISOString(),
        });
      await maintenance();
      await maintenance();
      expect(await reminders(id)).toHaveLength(1);
      expect(
        (await reminders(id, "verification")).map((row: any) => row.title),
      ).toEqual(["Document expires in 0 days", "Document renewal needed"]);
    });

    it.each(["renewed", "terminated"])(
      "does not record a false expiry when a contract is %s after the batch read",
      async (decision) => {
        const id = randomUUID();
        const payload = {
          start_date: date(Date.now() - 365 * day),
          end_date: date(Date.now() - day),
          renewal_notice_days: 30,
        };
        await h.db("records").insert({
          id,
          kind: "contracts",
          number: `COM-${id}`,
          title: "Concurrent contract decision",
          status: "active",
          owner_org_id: h.org("buyer"),
          buyer_org_id: h.org("buyer"),
          partner_org_id: h.org("vendor"),
          payload: JSON.stringify(payload),
          version: 1,
          created_by: h.clients.buyer.user.id,
          created_at: stamp(),
          updated_at: stamp(),
        });
        await changeAfterBatch("records", id, async () => {
          await h
            .db("records")
            .where({ id })
            .update({
              status: decision === "renewed" ? "active" : "terminated",
              version: 2,
              payload: JSON.stringify({
                ...payload,
                end_date: date(Date.now() + 365 * day),
              }),
              updated_at: stamp(),
            });
        });
        expect((await h.db("records").where({ id }).first()).status).toBe(
          decision === "renewed" ? "active" : "terminated",
        );
        expect(
          await h
            .db("audit_logs")
            .where({ record_id: id, action: "contract_expired" }),
        ).toHaveLength(0);
        expect(
          await h
            .db("notifications")
            .where("dedupe_key", "like", `contract:${id}:%`),
        ).toHaveLength(0);
      },
    );

    it("preserves a verification rejection made after the document batch read", async () => {
      const id = await document("vendor", date(Date.now() - day));
      await changeAfterBatch("documents", id, async () => {
        await h.db("documents").where({ id }).update({
          status: "rejected",
          review_note: "The verification team rejected this certificate.",
          reviewed_by: h.clients.verification.user.id,
          updated_at: stamp(),
        });
      });
      expect((await h.db("documents").where({ id }).first()).status).toBe(
        "rejected",
      );
      expect(
        await h
          .db("audit_logs")
          .where({ record_id: id, action: "document_expired" }),
      ).toHaveLength(0);
    });

    it("does not expire or notify a superseded document after a renewal is uploaded", async () => {
      const id = await document("vendor", date(Date.now() - day));
      await changeAfterBatch("documents", id, async () => {
        await document("vendor", date(Date.now() + 365 * day), "PAN", {
          previous_id: id,
          version: 2,
          status: "under_review",
        });
      });
      expect((await h.db("documents").where({ id }).first()).status).toBe(
        "approved",
      );
      expect(
        await h
          .db("audit_logs")
          .where({ record_id: id, action: "document_expired" }),
      ).toHaveLength(0);
      expect(await reminders(id)).toHaveLength(0);
    });
  });
}
