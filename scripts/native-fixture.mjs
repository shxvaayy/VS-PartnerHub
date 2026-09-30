import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import supertest from "supertest";

export const nativeOrigin = "http://127.0.0.1:4207";
export const controlOrigin = "http://127.0.0.1:4208";

/** Disposable native-acceptance data. Never imports a live environment file. */
export async function startNativeFixture({
  checkNativeCache,
  captureNativeDiagnostics,
} = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "partnerhub-native-"));
  Object.assign(process.env, {
    NODE_ENV: "test",
    DEMO_MODE: "true",
    VERCEL: "",
    DATABASE_URL: "",
    SQLITE_PATH: path.join(directory, "native.sqlite"),
    UPLOAD_DIR: path.join(directory, "uploads"),
    FILE_STORAGE: "local",
    BLOB_READ_WRITE_TOKEN: "",
    SMTP_HOST: "",
    RESEND_API_KEY: "",
    GEMINI_API_KEY: "",
    SESSION_SECRET: randomBytes(32).toString("hex"),
    INTEGRATION_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    APP_URL: nativeOrigin,
  });
  const { db, migrate } = await import("../server/db.ts");
  const { seed } = await import("../server/seed.ts");
  const { createApp } = await import("../server/app.ts");
  const { demoAccounts, demoPassword } = await import("../shared/demo.ts");
  await migrate();
  await seed();
  const app = createApp();
  const requests = [];
  let downloadedReport;
  let server;
  async function online() {
    if (server?.listening) return;
    server = await new Promise((resolve, reject) => {
      const current = createServer((req, res) => {
        const request = {
          method: req.method,
          path: new URL(req.url, nativeOrigin).pathname,
          startedAt: new Date().toISOString(),
          status: null,
        };
        requests.push(request);
        if (requests.length > 1000) requests.shift();
        if (request.path === "/api/reports/power-bi") {
          const end = res.end;
          res.end = function (body, ...args) {
            // Observe the real serialized response without replacing it. Some
            // Android WebViews report an empty download body through CDP.
            if (this.statusCode === 200 && Buffer.isBuffer(body))
              downloadedReport = Buffer.from(body);
            return end.call(this, body, ...args);
          };
        }
        res.once("finish", () => {
          request.status = res.statusCode;
        });
        app(req, res);
      });
      current.once("error", reject);
      current.listen(4207, "127.0.0.1", () => resolve(current));
    });
  }
  async function offline() {
    if (!server?.listening) return;
    const current = server;
    server = undefined;
    await new Promise((resolve) => {
      current.close(resolve);
      current.closeAllConnections();
    });
  }
  async function requirement() {
    const client = supertest.agent(app);
    const account = demoAccounts.find((a) => a.key === "admin");
    const login = await client
      .post("/api/auth/login")
      .send({ email: account.email, password: demoPassword });
    assert.equal(login.status, 200);
    const response = await client
      .post("/api/records/requirements")
      .set("X-CSRF-Token", login.body.csrfToken)
      .send({
        title: "Native resume verification",
        currency: "INR",
        items: [],
        invitations: [],
        payload: {
          requirement_type: "procurement",
          required_date: new Date(Date.now() + 30 * 86400000)
            .toISOString()
            .slice(0, 10),
        },
      });
    assert.equal(response.status, 201, response.body.error);
    await client
      .post("/api/auth/logout")
      .set("X-CSRF-Token", login.body.csrfToken)
      .send({});
    return { id: response.body.id, title: response.body.title };
  }
  async function analytics() {
    const client = supertest.agent(app);
    const login = await client.post("/api/auth/login").send({
      email: demoAccounts.find((account) => account.key === "admin").email,
      password: demoPassword,
    });
    assert.equal(login.status, 200);
    const response = await client.get("/api/reports/analytics");
    assert.equal(response.status, 200);
    await client
      .post("/api/auth/logout")
      .set("X-CSRF-Token", login.body.csrfToken)
      .send({});
    return response.body;
  }
  await online();
  const controller = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      const cacheRequest = req.url?.match(
        /^\/native-cache\/(populated|empty)\/([a-f0-9-]{36})$/i,
      );
      const diagnosticsRequest = req.url?.match(
        /^\/native-diagnostics\/([a-f0-9-]{36})$/i,
      );
      if (req.method === "GET" && req.url === "/health")
        res.end(
          JSON.stringify({ online: !!server?.listening, isolated: true }),
        );
      else if (req.method === "POST" && req.url === "/offline") {
        await offline();
        res.end("{}");
      } else if (req.method === "POST" && req.url === "/online") {
        await online();
        res.end("{}");
      } else if (req.method === "POST" && req.url === "/requirement")
        res.end(JSON.stringify(await requirement()));
      else if (req.method === "POST" && cacheRequest && checkNativeCache) {
        await checkNativeCache(
          cacheRequest[1],
          cacheRequest[2],
          cacheRequest[1] === "populated" ? await analytics() : undefined,
        );
        res.end("{}");
      } else if (
        req.method === "POST" &&
        diagnosticsRequest &&
        captureNativeDiagnostics
      ) {
        await captureNativeDiagnostics(diagnosticsRequest[1]);
        res.end("{}");
      } else {
        res.statusCode = 404;
        res.end("{}");
      }
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((resolve, reject) => {
    controller.once("error", reject);
    controller.listen(4208, "127.0.0.1", resolve);
  });
  let closed = false;
  return {
    online,
    offline,
    requirement,
    diagnostics: () => ({ requests, online: !!server?.listening }),
    downloadedReport: () =>
      downloadedReport ? Buffer.from(downloadedReport) : undefined,
    async close() {
      if (closed) return;
      closed = true;
      await offline();
      await new Promise((resolve) => {
        controller.close(resolve);
        controller.closeAllConnections();
      });
      await db.destroy();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const fixture = await startNativeFixture();
  console.log("Disposable native acceptance workspace ready on loopback.");
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => void fixture.close().then(() => process.exit(0)));
}
