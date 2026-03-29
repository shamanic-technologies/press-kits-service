import { Router } from "express";
import { sql as pgSql } from "../db/index.js";

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
    const params: unknown[] = [orgId];
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

export default router;
