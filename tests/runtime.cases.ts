import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

export function runtimeCases() {
  describe("shared serverless controls", () => {
    it("counts parallel attempts across separate limiter instances atomically", async () => {
      const { DatabaseRateLimitStore } =
        await import("../server/rate-limits.js");
      const prefix = randomUUID();
      const stores = [
        new DatabaseRateLimitStore(prefix),
        new DatabaseRateLimitStore(prefix),
      ];
      const hits = await Promise.all(
        Array.from({ length: 24 }, (_, i) =>
          stores[i % 2].increment("192.0.2.4"),
        ),
      );
      expect(hits.map((hit) => hit.totalHits).sort((a, b) => a - b)).toEqual(
        Array.from({ length: 24 }, (_, i) => i + 1),
      );
      expect(new Set(hits.map((hit) => hit.resetTime.toISOString())).size).toBe(
        1,
      );
      const isolated = await new DatabaseRateLimitStore(randomUUID()).increment(
        "192.0.2.4",
      );
      expect(isolated.totalHits).toBe(1);
    });

    it("expires shared limits and never persists the raw network identifier", async () => {
      const { DatabaseRateLimitStore } =
        await import("../server/rate-limits.js");
      const { db } = await import("../server/db.js");
      const prefix = randomUUID();
      const store = new DatabaseRateLimitStore(prefix);
      await store.increment("2001:db8::1");
      const rows = await db("auth_attempts").select("key");
      expect(rows.every((row) => /^[a-f0-9]{64}$/.test(row.key))).toBe(true);
      await db("auth_attempts").update({
        expires_at: new Date(Date.now() - 1000).toISOString(),
      });
      expect(
        (await new DatabaseRateLimitStore(prefix).increment("2001:db8::1"))
          .totalHits,
      ).toBe(1);
      await store.resetKey("2001:db8::1");
      expect((await store.increment("2001:db8::1")).totalHits).toBe(1);
    });

    it("runs a scheduled job only once across concurrent claimants and respects its interval", async () => {
      const { runLeasedJob } = await import("../server/jobs.js");
      let runs = 0;
      const job = randomUUID();
      const task = async () => {
        runs++;
      };
      const claims = await Promise.all(
        Array.from({ length: 8 }, () => runLeasedJob(job, task, 60000)),
      );
      expect(claims.filter(Boolean)).toHaveLength(1);
      expect(runs).toBe(1);
      expect(await runLeasedJob(job, task, 60000)).toBe(false);
    });

    it("recovers an expired worker lease without running a completed job twice", async () => {
      const { runLeasedJob } = await import("../server/jobs.js");
      const { db } = await import("../server/db.js");
      const name = randomUUID();
      const expired = new Date(Date.now() - 1000).toISOString();
      await db("job_leases").insert({
        name,
        owner: randomUUID(),
        expires_at: expired,
        next_run_at: expired,
      });
      let runs = 0;
      expect(
        await runLeasedJob(
          name,
          async () => {
            runs++;
          },
          60000,
        ),
      ).toBe(true);
      expect(runs).toBe(1);
    });
  });
}
