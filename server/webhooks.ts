import { randomUUID, createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { db, now, parseJson, type Database } from "./db.js";
import { assert } from "./errors.js";
import { decryptSecret } from "./integration-config.js";
import { assertActive, can, getUser } from "./security.js";
import { accessibleRecord } from "./record-service.js";

async function endpointCanRead(
  k: Database,
  endpoint: any,
  module: string,
  recordId?: string,
) {
  const user = await getUser(endpoint.created_by, k);
  if (
    !user ||
    user.organization_id !== endpoint.organization_id ||
    !can(user, "integrations", "manage") ||
    !can(user, module)
  )
    return false;
  try {
    assertActive(user);
    if (recordId) await accessibleRecord(recordId, user, k);
    return true;
  } catch {
    return false;
  }
}
export async function validateWebhookUrl(value: string) {
  const url = new URL(value);
  const testing = process.env.NODE_ENV === "test";
  assert(
    (url.protocol === "https:" || (testing && url.protocol === "http:")) &&
      !url.username &&
      !url.password &&
      !url.hash,
    422,
    "Use a public HTTPS endpoint without credentials or a fragment.",
  );
  const addresses = await lookup(url.hostname, { all: true });
  const allowed = (process.env.WEBHOOK_ALLOWED_PRIVATE_HOSTS || "")
    .split(",")
    .map((v) => v.trim());
  assert(
    addresses.length > 0 &&
      addresses.every(
        (a) =>
          testing || allowed.includes(url.hostname) || !isPrivate(a.address),
      ),
    422,
    "Private network webhook addresses must be explicitly allowed by the server administrator.",
  );
  return { url, addresses };
}
function isPrivate(ip: string) {
  if (ip.includes(":")) {
    const x = ip.toLowerCase();
    return (
      x === "::" ||
      x === "::1" ||
      /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(x) ||
      x.startsWith("::ffff:")
    );
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19))
  );
}
export async function enqueueWebhookEvent(
  k: Database,
  event: {
    id: string;
    module: string;
    action: string;
    organizationId: string | null;
    recordId?: string;
    number?: string;
    previousStatus?: string;
    status?: string;
    at: string;
  },
) {
  const organizations = new Set<string>();
  if (event.organizationId) organizations.add(event.organizationId);
  if (event.recordId) {
    const record = await k("records").where({ id: event.recordId }).first();
    if (record)
      for (const id of [
        record.owner_org_id,
        record.buyer_org_id,
        record.partner_org_id,
      ])
        if (id) organizations.add(id);
  }
  if (!organizations.size) return;
  const endpoints = await k("webhook_endpoints")
    .where({ active: true })
    .whereIn("organization_id", [...organizations]);
  for (const endpoint of endpoints) {
    if (!parseJson<string[]>(endpoint.events, []).includes(event.module))
      continue;
    if (!(await endpointCanRead(k, endpoint, event.module, event.recordId)))
      continue;
    const payload = JSON.stringify({
      id: event.id,
      type: `${event.module}.${event.action}`,
      created_at: event.at,
      organization_id: endpoint.organization_id,
      data: {
        id: event.recordId,
        number: event.number,
        previous_status: event.previousStatus,
        status: event.status,
      },
    });
    await k("webhook_deliveries")
      .insert({
        id: randomUUID(),
        endpoint_id: endpoint.id,
        event_id: event.id,
        payload,
        status: "queued",
        attempts: 0,
        next_attempt: now(),
        created_at: now(),
      })
      .onConflict(["endpoint_id", "event_id"])
      .ignore();
  }
}
let delivering = false;
export async function deliverWebhooks() {
  if (delivering) return;
  delivering = true;
  try {
    await db("webhook_deliveries")
      .where({ status: "sending" })
      .where("next_attempt", "<", now())
      .update({ status: "queued" });
    const deliveries = await db("webhook_deliveries as d")
      .join("webhook_endpoints as e", "d.endpoint_id", "e.id")
      .where("d.status", "queued")
      .where("e.active", true)
      .where("d.next_attempt", "<=", now())
      .select(
        "d.*",
        "e.url",
        "e.encrypted_secret",
        "e.organization_id",
        "e.created_by",
        "e.events",
      )
      .orderBy("d.created_at")
      .limit(15);
    for (const delivery of deliveries) {
      const claimed = await db("webhook_deliveries")
        .where({ id: delivery.id, status: "queued" })
        .update({
          status: "sending",
          next_attempt: new Date(Date.now() + 120000).toISOString(),
        });
      if (!claimed) continue;
      const event = parseJson(delivery.payload),
        module = String(event.type || "").split(".")[0];
      if (
        !parseJson<string[]>(delivery.events, []).includes(module) ||
        !(await endpointCanRead(db, delivery, module, event.data?.id))
      ) {
        await db("webhook_deliveries")
          .where({ id: delivery.id })
          .update({
            status: "cancelled",
            payload: JSON.stringify({
              id: delivery.event_id,
              cancelled: "Source access revoked",
            }),
          });
        continue;
      }
      let status = 0;
      try {
        const { url, addresses } = await validateWebhookUrl(delivery.url),
          timestamp = String(Math.floor(Date.now() / 1000));
        const signature = createHmac(
          "sha256",
          decryptSecret<string>(delivery.encrypted_secret),
        )
          .update(`${timestamp}.${delivery.payload}`)
          .digest("hex");
        status = await new Promise<number>((resolve, reject) => {
          const send = url.protocol === "http:" ? httpRequest : httpsRequest;
          const req = send(
            url,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(delivery.payload),
                "X-PartnerHub-Id": delivery.event_id,
                "X-PartnerHub-Timestamp": timestamp,
                "X-PartnerHub-Signature": `sha256=${signature}`,
              },
              lookup: ((_hostname: any, options: any, callback: any) =>
                options?.all
                  ? callback(null, addresses)
                  : callback(
                      null,
                      addresses[0].address,
                      addresses[0].family,
                    )) as any,
            },
            (res) => {
              res.resume();
              resolve(res.statusCode || 0);
            },
          );
          req.setTimeout(15000, () =>
            req.destroy(new Error("Webhook timed out.")),
          );
          req.on("error", reject);
          req.end(delivery.payload);
        });
      } catch {}
      const success = status >= 200 && status < 300;
      await db("webhook_deliveries")
        .where({ id: delivery.id })
        .update({
          status: success
            ? "delivered"
            : delivery.attempts >= 4
              ? "failed"
              : "queued",
          attempts: delivery.attempts + 1,
          http_status: status || null,
          delivered_at: success ? now() : null,
          next_attempt: new Date(
            Date.now() + Math.pow(2, delivery.attempts) * 60000,
          ).toISOString(),
        });
    }
  } finally {
    delivering = false;
  }
}
