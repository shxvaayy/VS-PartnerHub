import { Router } from "express";
import { db, now, parseJson } from "./db.js";
import { authenticated, assertActive, can, permit } from "./security.js";
import { scopeRecords } from "./record-service.js";
import { operationalOutlook } from "./operational-insights.js";

export const insightsRouter = Router();
insightsRouter.use(authenticated, permit("reports"), (req, _res, next) => {
  assertActive(req.user);
  next();
});
insightsRouter.get("/", async (req, res) => {
  res.json(await operationalOutlook(req.user));
});
insightsRouter.get("/performance", async (req, res) => {
  const kinds = ["orders", "deliveries", "performance"].filter((k) =>
    can(req.user, k),
  );
  const records: any[] = await scopeRecords(
    db("records").whereIn("kind", kinds),
    req.user,
  )
    .orderBy("created_at", "desc")
    .limit(10000);
  const partners = [
    ...new Set(records.map((r) => r.partner_org_id).filter(Boolean)),
  ] as string[];
  const organizations = partners.length
    ? await db("organizations")
        .whereIn("id", partners)
        .select("id", "legal_name", "type")
    : [];
  const results = [];
  for (const org of organizations) {
    const related = records.filter((r) => r.partner_org_id === org.id),
      orders = related.filter(
        (r) =>
          r.kind === "orders" &&
          !["draft", "pending_approval"].includes(r.status),
      );
    const confirmed = related.filter(
      (r) => r.kind === "deliveries" && r.status === "confirmed",
    );
    const samples = [];
    for (const delivery of confirmed) {
      const order = orders.find((r) => r.id === delivery.parent_id),
        promised = order && parseJson(order.payload).delivery_date;
      if (!promised) continue;
      const event = await db("audit_logs")
        .where({
          record_id: delivery.id,
          module: "deliveries",
          new_status: "delivered",
        })
        .orderBy("created_at")
        .first();
      if (event) samples.push(event.created_at.slice(0, 10) <= promised);
    }
    const reviews = related
      .filter((r) => r.kind === "performance" && r.status === "published")
      .map((r) => parseJson(r.payload));
    const ratings = reviews
      .map((p) => [p.quality, p.delivery, p.communication, p.value].map(Number))
      .filter((values) => values.every((n) => n >= 1 && n <= 5))
      .map((values) => values.reduce((sum, n) => sum + n, 0) / 4);
    results.push({
      ...org,
      totalOrders: orders.length,
      completedOrders: orders.filter((r) =>
        ["fulfilled", "closed"].includes(r.status),
      ).length,
      openOrders: orders.filter(
        (r) => !["fulfilled", "closed"].includes(r.status),
      ).length,
      onTimeSamples: samples.length,
      onTimeDeliveries: samples.filter(Boolean).length,
      onTimeRate: samples.length
        ? Math.round((samples.filter(Boolean).length / samples.length) * 100)
        : null,
      rating: ratings.length
        ? Math.round(
            (ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10,
          ) / 10
        : null,
      reviews: ratings.length,
    });
  }
  res.json({
    items: results,
    method:
      "On-time performance compares recorded delivered timestamps against the order’s promised delivery date, using confirmed deliveries only. Ratings use published reviews. A dash means there is no qualifying evidence. Calculations cover the latest 10,000 accessible orders, deliveries and reviews.",
  });
});
