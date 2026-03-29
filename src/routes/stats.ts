import { Router } from "express";
import { sql as pgSql } from "../db/index.js";
import { batchGetCosts } from "../lib/runs-client.js";
import { getContextHeaders } from "../middleware/auth.js";

const router = Router();

const VALID_GROUP_BY = new Set(["country", "mediaKitId", "day"]);

const GROUP_BY_EXPRESSION: Record<string, { select: string; groupBy: string }> = {
  country: {
    select: "mkv.country",
    groupBy: "mkv.country",
  },
  mediaKitId: {
    select: "mkv.media_kit_id",
    groupBy: "mkv.media_kit_id",
  },
  day: {
    select: "DATE(mkv.viewed_at AT TIME ZONE 'UTC')",
    groupBy: "DATE(mkv.viewed_at AT TIME ZONE 'UTC')",
  },
};

// GET /media-kits/stats/views — aggregated view metrics
router.get("/media-kits/stats/views", async (req, res) => {
  try {
    const orgId = req.orgId;
    const q = req.query as Record<string, string | undefined>;

    const conditions: string[] = ["mk.org_id = $1"];
    const params: (string | number)[] = [orgId];
    let idx = 2;

    if (q.brandId) {
      conditions.push(`mk.brand_id = $${idx++}`);
      params.push(q.brandId);
    }
    if (q.campaignId) {
      conditions.push(`mk.campaign_id = $${idx++}`);
      params.push(q.campaignId);
    }
    if (q.mediaKitId) {
      conditions.push(`mkv.media_kit_id = $${idx++}`);
      params.push(q.mediaKitId);
    }
    if (q.from) {
      conditions.push(`mkv.viewed_at >= $${idx++}`);
      params.push(q.from);
    }
    if (q.to) {
      conditions.push(`mkv.viewed_at <= $${idx++}`);
      params.push(q.to);
    }

    const where = conditions.join(" AND ");
    const groupBy = q.groupBy;

    if (groupBy && VALID_GROUP_BY.has(groupBy)) {
      const expr = GROUP_BY_EXPRESSION[groupBy];

      const rows = await pgSql.unsafe(
        `SELECT
          ${expr.select} AS group_key,
          COUNT(*)::int AS total_views,
          COUNT(DISTINCT mkv.ip_address)::int AS unique_visitors,
          MAX(mkv.viewed_at) AS last_viewed_at
         FROM media_kit_views mkv
         JOIN media_kits mk ON mk.id = mkv.media_kit_id
         WHERE ${where}
         GROUP BY ${expr.groupBy}
         ORDER BY total_views DESC`,
        params
      );

      res.json({
        groups: rows.map((r: Record<string, unknown>) => ({
          key: r.group_key != null ? String(r.group_key) : null,
          totalViews: Number(r.total_views),
          uniqueVisitors: Number(r.unique_visitors),
          lastViewedAt: r.last_viewed_at ? String(r.last_viewed_at) : null,
        })),
      });
    } else {
      const rows = await pgSql.unsafe(
        `SELECT
          COUNT(*)::int AS total_views,
          COUNT(DISTINCT mkv.ip_address)::int AS unique_visitors,
          MAX(mkv.viewed_at) AS last_viewed_at,
          MIN(mkv.viewed_at) AS first_viewed_at
         FROM media_kit_views mkv
         JOIN media_kits mk ON mk.id = mkv.media_kit_id
         WHERE ${where}`,
        params
      );

      const row = rows[0] ?? {};
      res.json({
        totalViews: Number(row.total_views ?? 0),
        uniqueVisitors: Number(row.unique_visitors ?? 0),
        lastViewedAt: row.last_viewed_at ? String(row.last_viewed_at) : null,
        firstViewedAt: row.first_viewed_at ? String(row.first_viewed_at) : null,
      });
    }
  } catch (err) {
    console.error("[press-kits-service] GET /media-kits/stats/views error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /media-kits/stats/costs — aggregated generation/edit costs via runs-service
router.get("/media-kits/stats/costs", async (req, res) => {
  try {
    const orgId = req.orgId;
    const ctx = getContextHeaders(req);
    const q = req.query as Record<string, string | undefined>;

    const conditions: string[] = ["mk.org_id = $1"];
    const params: (string | number)[] = [orgId];
    let idx = 2;

    if (q.mediaKitId) {
      conditions.push(`mkr.media_kit_id = $${idx++}`);
      params.push(q.mediaKitId);
    }
    if (q.brandId) {
      conditions.push(`mk.brand_id = $${idx++}`);
      params.push(q.brandId);
    }
    if (q.campaignId) {
      conditions.push(`mk.campaign_id = $${idx++}`);
      params.push(q.campaignId);
    }

    const where = conditions.join(" AND ");

    const rows = await pgSql.unsafe(
      `SELECT mkr.run_id, mkr.media_kit_id
       FROM media_kit_runs mkr
       JOIN media_kits mk ON mk.id = mkr.media_kit_id
       WHERE ${where}`,
      params
    );

    if (rows.length === 0) {
      res.json({
        groups: q.groupBy === "mediaKitId"
          ? []
          : [{
              dimensions: {},
              totalCostInUsdCents: 0,
              actualCostInUsdCents: 0,
              provisionedCostInUsdCents: 0,
              runCount: 0,
            }],
      });
      return;
    }

    const runIds = rows.map((r: Record<string, unknown>) => String(r.run_id));
    const costs = await batchGetCosts(runIds, ctx);
    const costMap = new Map(costs.map((c) => [c.runId, c]));

    if (q.groupBy === "mediaKitId") {
      const grouped = new Map<string, { total: number; actual: number; provisioned: number; count: number }>();

      for (const row of rows) {
        const mkId = String(row.media_kit_id);
        const cost = costMap.get(String(row.run_id));
        const entry = grouped.get(mkId) ?? { total: 0, actual: 0, provisioned: 0, count: 0 };
        entry.count++;
        if (cost) {
          entry.total += parseFloat(cost.totalCostInUsdCents);
          entry.actual += parseFloat(cost.actualCostInUsdCents);
          entry.provisioned += parseFloat(cost.provisionedCostInUsdCents);
        }
        grouped.set(mkId, entry);
      }

      res.json({
        groups: Array.from(grouped.entries()).map(([mkId, v]) => ({
          dimensions: { mediaKitId: mkId },
          totalCostInUsdCents: v.total,
          actualCostInUsdCents: v.actual,
          provisionedCostInUsdCents: v.provisioned,
          runCount: v.count,
        })),
      });
    } else {
      let total = 0, actual = 0, provisioned = 0;
      for (const cost of costs) {
        total += parseFloat(cost.totalCostInUsdCents);
        actual += parseFloat(cost.actualCostInUsdCents);
        provisioned += parseFloat(cost.provisionedCostInUsdCents);
      }

      res.json({
        groups: [{
          dimensions: {},
          totalCostInUsdCents: total,
          actualCostInUsdCents: actual,
          provisionedCostInUsdCents: provisioned,
          runCount: rows.length,
        }],
      });
    }
  } catch (err) {
    console.error("[press-kits-service] GET /media-kits/stats/costs error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
