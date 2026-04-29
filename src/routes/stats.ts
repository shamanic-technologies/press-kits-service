import { Router } from "express";
import { sql as pgSql } from "../db/index.js";
import { batchGetCosts } from "../lib/runs-client.js";
import { resolveWorkflowDynastySlugs } from "../lib/dynasty-client.js";
import { getContextHeaders } from "../middleware/auth.js";

const router = Router();

const VALID_GROUP_BY = new Set(["country", "mediaKitId", "day", "brandId", "campaignId", "featureSlug", "workflowSlug", "workflowDynastySlug"]);

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
  brandId: {
    select: "unnest(mk.brand_ids)",
    groupBy: "unnest(mk.brand_ids)",
  },
  campaignId: {
    select: "mk.campaign_id",
    groupBy: "mk.campaign_id",
  },
  featureSlug: {
    select: "mk.feature_slug",
    groupBy: "mk.feature_slug",
  },
  workflowSlug: {
    select: "mk.workflow_slug",
    groupBy: "mk.workflow_slug",
  },
  // Dynasty groupBy: we group by the versioned slug in SQL, then re-aggregate in JS
  workflowDynastySlug: {
    select: "mk.workflow_slug",
    groupBy: "mk.workflow_slug",
  },
};

/**
 * Resolve dynasty slug filters into IN clauses on versioned slug columns.
 * Returns the additional SQL conditions and params.
 */
async function resolveDynastyFilters(
  q: Record<string, string | undefined>,
  idx: number,
  ctx: ReturnType<typeof getContextHeaders>
): Promise<{ conditions: string[]; params: string[]; nextIdx: number }> {
  const conditions: string[] = [];
  const params: string[] = [];
  let nextIdx = idx;

  if (q.workflowDynastySlug) {
    const slugs = await resolveWorkflowDynastySlugs(q.workflowDynastySlug, ctx);
    if (slugs.length === 0) {
      conditions.push("FALSE");
    } else {
      const placeholders = slugs.map(() => `$${nextIdx++}`);
      conditions.push(`mk.workflow_slug IN (${placeholders.join(", ")})`);
      params.push(...slugs);
    }
  }

  return { conditions, params, nextIdx };
}

/**
 * For dynasty groupBy: resolve all versioned slugs back to their dynasty slug,
 * then re-aggregate the SQL groups that share the same dynasty.
 */
async function buildDynastySlugMap(
  groupBy: string,
  versionedKeys: string[],
  ctx: ReturnType<typeof getContextHeaders>
): Promise<Map<string, string>> {
  // Map from versioned slug → dynasty slug
  const map = new Map<string, string>();

  if (groupBy === "workflowDynastySlug") {
    // workflow-service has GET /workflows/dynasty?slug=X (reverse lookup)
    const WORKFLOW_SERVICE_URL = process.env.WORKFLOW_SERVICE_URL || "http://localhost:3004";
    const WORKFLOW_SERVICE_API_KEY = process.env.WORKFLOW_SERVICE_API_KEY || "";
    const { buildForwardHeaders } = await import("../middleware/auth.js");
    const headers: Record<string, string> = { "X-API-Key": WORKFLOW_SERVICE_API_KEY };
    if (ctx) Object.assign(headers, buildForwardHeaders(ctx));

    await Promise.all(
      versionedKeys.map(async (slug) => {
        try {
          const url = `${WORKFLOW_SERVICE_URL}/workflows/dynasty?slug=${encodeURIComponent(slug)}`;
          const res = await fetch(url, { headers });
          if (res.ok) {
            const body = (await res.json()) as { workflowDynastySlug: string };
            map.set(slug, body.workflowDynastySlug);
          } else {
            map.set(slug, slug);
          }
        } catch {
          map.set(slug, slug);
        }
      })
    );
  }

  return map;
}

// GET /media-kits/stats/views — aggregated view metrics
router.get("/media-kits/stats/views", async (req, res) => {
  try {
    const orgId = req.orgId;
    const ctx = getContextHeaders(req);
    const q = req.query as Record<string, string | undefined>;

    const conditions: string[] = ["mk.org_id = $1"];
    const params: (string | number)[] = [orgId];
    let idx = 2;

    if (q.brandId) {
      conditions.push(`$${idx++} = ANY(mk.brand_ids)`);
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
    if (q.featureSlug) {
      conditions.push(`mk.feature_slug = $${idx++}`);
      params.push(q.featureSlug);
    }
    if (q.workflowSlug) {
      conditions.push(`mk.workflow_slug = $${idx++}`);
      params.push(q.workflowSlug);
    }
    if (q.from) {
      conditions.push(`mkv.viewed_at >= $${idx++}`);
      params.push(q.from);
    }
    if (q.to) {
      conditions.push(`mkv.viewed_at <= $${idx++}`);
      params.push(q.to);
    }

    // Resolve dynasty slug filters via service calls
    const dynasty = await resolveDynastyFilters(q, idx, ctx);
    conditions.push(...dynasty.conditions);
    params.push(...dynasty.params);
    idx = dynasty.nextIdx;

    const where = conditions.join(" AND ");
    const groupBy = q.groupBy;

    if (groupBy && VALID_GROUP_BY.has(groupBy)) {
      const expr = GROUP_BY_EXPRESSION[groupBy];
      const isDynastyGroupBy = groupBy === "workflowDynastySlug";

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

      if (isDynastyGroupBy) {
        // Re-aggregate by dynasty slug
        const versionedKeys = rows
          .map((r: Record<string, unknown>) => r.group_key != null ? String(r.group_key) : null)
          .filter((k): k is string => k !== null);

        const dynastyMap = await buildDynastySlugMap(groupBy, versionedKeys, ctx);

        const merged = new Map<string, { totalViews: number; uniqueVisitors: number; lastViewedAt: string | null }>();
        for (const r of rows) {
          const versionedSlug = r.group_key != null ? String(r.group_key) : null;
          const dynastyKey = versionedSlug ? (dynastyMap.get(versionedSlug) ?? versionedSlug) : null;
          const key = dynastyKey ?? "__null__";
          const existing = merged.get(key);
          if (existing) {
            existing.totalViews += Number(r.total_views);
            existing.uniqueVisitors += Number(r.unique_visitors);
            if (r.last_viewed_at && (!existing.lastViewedAt || String(r.last_viewed_at) > existing.lastViewedAt)) {
              existing.lastViewedAt = String(r.last_viewed_at);
            }
          } else {
            merged.set(key, {
              totalViews: Number(r.total_views),
              uniqueVisitors: Number(r.unique_visitors),
              lastViewedAt: r.last_viewed_at ? String(r.last_viewed_at) : null,
            });
          }
        }

        res.json({
          groups: Array.from(merged.entries()).map(([key, v]) => ({
            key: key === "__null__" ? null : key,
            totalViews: v.totalViews,
            uniqueVisitors: v.uniqueVisitors,
            lastViewedAt: v.lastViewedAt,
          })),
        });
      } else {
        res.json({
          groups: rows.map((r: Record<string, unknown>) => ({
            key: r.group_key != null ? String(r.group_key) : null,
            totalViews: Number(r.total_views),
            uniqueVisitors: Number(r.unique_visitors),
            lastViewedAt: r.last_viewed_at ? String(r.last_viewed_at) : null,
          })),
        });
      }
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
      conditions.push(`$${idx++} = ANY(mk.brand_ids)`);
      params.push(q.brandId);
    }
    if (q.campaignId) {
      conditions.push(`mk.campaign_id = $${idx++}`);
      params.push(q.campaignId);
    }
    if (q.featureSlug) {
      conditions.push(`mk.feature_slug = $${idx++}`);
      params.push(q.featureSlug);
    }
    if (q.workflowSlug) {
      conditions.push(`mk.workflow_slug = $${idx++}`);
      params.push(q.workflowSlug);
    }

    // Resolve dynasty slug filters via service calls
    const dynasty = await resolveDynastyFilters(q, idx, ctx);
    conditions.push(...dynasty.conditions);
    params.push(...dynasty.params);
    idx = dynasty.nextIdx;

    const where = conditions.join(" AND ");

    const COST_GROUP_BY_COLUMN: Record<string, string> = {
      mediaKitId: "media_kit_id",
      brandId: "brand_ids",
      campaignId: "campaign_id",
      featureSlug: "feature_slug",
      workflowSlug: "workflow_slug",
      // Dynasty groupBy: group by versioned slug in SQL, re-aggregate in JS
      workflowDynastySlug: "workflow_slug",
    };

    const costGroupBy = q.groupBy as string | undefined;
    const groupByColumn = costGroupBy ? COST_GROUP_BY_COLUMN[costGroupBy] : undefined;
    const isDynastyGroupBy = costGroupBy === "workflowDynastySlug";

    // When grouping, we need the group column from the right table
    const groupBySelectExpr = groupByColumn
      ? groupByColumn === "media_kit_id"
        ? "mkr.media_kit_id"
        : groupByColumn === "brand_ids"
          ? "unnest(mk.brand_ids)"
          : `mk.${groupByColumn}`
      : undefined;

    const selectFields = groupBySelectExpr
      ? `mkr.run_id, mkr.media_kit_id, ${groupBySelectExpr} AS group_key`
      : "mkr.run_id, mkr.media_kit_id";

    const rows = await pgSql.unsafe(
      `SELECT ${selectFields}
       FROM media_kit_runs mkr
       JOIN media_kits mk ON mk.id = mkr.media_kit_id
       WHERE ${where}`,
      params
    );

    if (rows.length === 0) {
      res.json({
        groups: groupByColumn
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

    if (costGroupBy && groupByColumn) {
      // Build initial groups by versioned slug
      const grouped = new Map<string, { total: number; actual: number; provisioned: number; count: number }>();

      for (const row of rows) {
        const key = row.group_key != null ? String(row.group_key) : "__null__";
        const cost = costMap.get(String(row.run_id));
        const entry = grouped.get(key) ?? { total: 0, actual: 0, provisioned: 0, count: 0 };
        entry.count++;
        if (cost) {
          entry.total += parseFloat(cost.totalCostInUsdCents);
          entry.actual += parseFloat(cost.actualCostInUsdCents);
          entry.provisioned += parseFloat(cost.provisionedCostInUsdCents);
        }
        grouped.set(key, entry);
      }

      if (isDynastyGroupBy) {
        // Re-aggregate by dynasty slug
        const versionedKeys = Array.from(grouped.keys()).filter((k) => k !== "__null__");
        const dynastyMap = await buildDynastySlugMap(costGroupBy, versionedKeys, ctx);

        const merged = new Map<string, { total: number; actual: number; provisioned: number; count: number }>();
        for (const [versionedKey, entry] of grouped.entries()) {
          const dynastyKey = versionedKey === "__null__"
            ? "__null__"
            : (dynastyMap.get(versionedKey) ?? versionedKey);
          const existing = merged.get(dynastyKey);
          if (existing) {
            existing.total += entry.total;
            existing.actual += entry.actual;
            existing.provisioned += entry.provisioned;
            existing.count += entry.count;
          } else {
            merged.set(dynastyKey, { ...entry });
          }
        }

        res.json({
          groups: Array.from(merged.entries()).map(([key, v]) => ({
            dimensions: { [costGroupBy]: key === "__null__" ? null : key },
            totalCostInUsdCents: v.total,
            actualCostInUsdCents: v.actual,
            provisionedCostInUsdCents: v.provisioned,
            runCount: v.count,
          })),
        });
      } else {
        res.json({
          groups: Array.from(grouped.entries()).map(([key, v]) => ({
            dimensions: { [costGroupBy]: key === "__null__" ? null : key },
            totalCostInUsdCents: v.total,
            actualCostInUsdCents: v.actual,
            provisionedCostInUsdCents: v.provisioned,
            runCount: v.count,
          })),
        });
      }
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
