import { afterEach, describe, expect, it, vi } from "vitest";
import {
  backupFreshness,
  deploymentHealth,
  newestVerifiedBackup,
} from "../scripts/operations-health.mjs";

const now = Date.parse("2040-07-12T12:00:00Z");
const backup = (extra: Record<string, unknown> = {}) => ({
  id: 12,
  name: "partnerhub-recovery-1234-1",
  size_in_bytes: 4000,
  expired: false,
  created_at: "2040-07-12T03:20:00Z",
  expires_at: "2040-08-11T03:20:00Z",
  ...extra,
});
const healthy = (extra: Record<string, unknown> = {}, headers = {}) =>
  new Response(
    JSON.stringify({
      status: "ok",
      service: "VS PartnerHub",
      revision: "a".repeat(40),
      ...extra,
    }),
    {
      headers: {
        "Cache-Control": "no-store",
        "Strict-Transport-Security": "max-age=31536000",
        ...headers,
      },
    },
  );
afterEach(() => vi.unstubAllGlobals());

describe("Live operational health and recovery evidence", () => {
  it("ignores test artifacts and expired or empty captures when checking the latest retained backup", () => {
    const result = newestVerifiedBackup(
      [
        backup({ name: "browser-verification", id: 99 }),
        backup({ expired: true, id: 98 }),
        backup({ size_in_bytes: 0, id: 97 }),
        backup({ expires_at: "2040-07-11T12:00:00Z", id: 96 }),
        backup(),
      ],
      now,
    );
    expect(result.artifactId).toBe(12);
    expect(result.ageHours).toBe(8.67);
  });

  it.each([
    [],
    [backup({ expired: true })],
    [backup({ created_at: "2040-07-10T23:59:00Z" })],
    [backup({ created_at: "2040-07-13T12:00:00Z" })],
  ])(
    "fails the monitor when a usable, timely backup is absent: %j",
    (artifacts) => {
      expect(() => newestVerifiedBackup(artifacts, now)).toThrow();
    },
  );

  it("accepts an uncached database-backed HTTPS health result for an identifiable live revision", async () => {
    const fetch = vi.fn().mockResolvedValue(healthy());
    vi.stubGlobal("fetch", fetch);
    await expect(
      deploymentHealth("https://partners.example.test/app"),
    ).resolves.toMatchObject({
      databaseReachable: true,
      revision: "a".repeat(40),
    });
    expect(String(fetch.mock.calls[0][0])).toBe(
      "https://partners.example.test/api/health",
    );
    expect(fetch.mock.calls[0][1].redirect).toBe("error");
  });

  it.each([
    () => new Response("unavailable", { status: 503 }),
    () => healthy({ status: "unavailable" }),
    () => healthy({ revision: undefined }),
    () => healthy({}, { "Cache-Control": "public, max-age=3600" }),
    () => healthy({}, { "Strict-Transport-Security": "" }),
  ])(
    "rejects failed, unidentified, cached or insecure health responses",
    async (response) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
      await expect(
        deploymentHealth("https://partners.example.test"),
      ).rejects.toThrow();
    },
  );

  it("does not probe HTTP or credential-bearing source addresses", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      deploymentHealth("http://partners.example.test"),
    ).rejects.toThrow();
    await expect(
      deploymentHealth("https://secret@partners.example.test"),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads later artifact pages when other workflows fill the first page", async () => {
    const fresh = new Date().toISOString();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            artifacts: Array.from({ length: 100 }, () =>
              backup({ name: "browser-verification" }),
            ),
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            artifacts: [
              backup({
                created_at: fresh,
                expires_at: new Date(Date.now() + 86400000).toISOString(),
              }),
            ],
          }),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      backupFreshness("example/partnerhub", "read-only-fixture"),
    ).resolves.toMatchObject({ artifactId: 12 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[1][0])).toContain("page=2");
  });
});
