import { Router } from "express";
import { eq, and, inArray, desc, lt } from "drizzle-orm";
import { db, sql } from "../db/index.js";
import { mediaKits, mediaKitInstructions } from "../db/schema.js";
import { UpsertGenerationResultRequestSchema } from "../schemas.js";

const router = Router();

// GET /internal/media-kits/current — latest kit for the org (from x-org-id header)
router.get("/internal/media-kits/current", async (req, res) => {
  try {
    const kit = await db.query.mediaKits.findFirst({
      where: eq(mediaKits.orgId, req.orgId),
      orderBy: desc(mediaKits.updatedAt),
    });

    res.json(kit ?? null);
  } catch (err) {
    console.error("GET /internal/media-kits/current error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /internal/media-kits/generation-data — data for generation workflow (orgId from header)
router.get("/internal/media-kits/generation-data", async (req, res) => {
  try {
    const orgId = req.orgId;

    const currentKit = await db.query.mediaKits.findFirst({
      where: and(
        eq(mediaKits.orgId, orgId),
        eq(mediaKits.status, "generating")
      ),
    });

    const instructionResults = await sql`
      SELECT mki.id, mki.instruction, mki.instruction_type, mki.created_at
      FROM media_kit_instructions mki
      JOIN media_kits mk ON mki.media_kit_id = mk.id
      WHERE mk.org_id = ${orgId}
      ORDER BY mki.created_at
    `;

    const feedbackResults = await sql`
      SELECT id, denial_reason
      FROM media_kits
      WHERE org_id = ${orgId}
        AND denial_reason IS NOT NULL
      ORDER BY updated_at
    `;

    res.json({
      currentKit: currentKit ?? null,
      instructions: instructionResults.map((r: Record<string, unknown>) => ({
        id: r.id,
        instruction: r.instruction,
        instructionType: r.instruction_type,
        createdAt: String(r.created_at),
      })),
      feedbacks: feedbackResults.map((r: Record<string, unknown>) => ({
        id: r.id,
        denialReason: r.denial_reason,
      })),
    });
  } catch (err) {
    console.error("GET /internal/media-kits/generation-data error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /internal/media-kits/generation-result — workflow callback
router.post("/internal/media-kits/generation-result", async (req, res) => {
  try {
    const body = UpsertGenerationResultRequestSchema.parse(req.body);
    const orgId = body.orgId ?? req.orgId;

    const result = await sql`
      SELECT * FROM upsert_generating_media_kit_by_org(
        ${JSON.stringify({
          mdx_page_content: body.mdxContent,
          title: body.title ?? null,
          icon_url: body.iconUrl ?? null,
        })}::jsonb,
        ${orgId}::varchar
      )
    `;

    if (result.length === 0) {
      res.status(404).json({ error: "No generating kit found for org" });
      return;
    }

    res.json(result[0]);
  } catch (err) {
    console.error("POST /internal/media-kits/generation-result error:", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Bad request" });
  }
});

// GET /internal/media-kits/stale — kits not updated in >1 month
router.get("/internal/media-kits/stale", async (req, res) => {
  try {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    const results = await db
      .select()
      .from(mediaKits)
      .where(
        and(
          inArray(mediaKits.status, ["validated", "drafted"]),
          lt(mediaKits.updatedAt, oneMonthAgo)
        )
      )
      .orderBy(mediaKits.updatedAt);

    res.json({ mediaKits: results });
  } catch (err) {
    console.error("GET /internal/media-kits/stale error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /internal/media-kits/setup — setup status per org
router.get("/internal/media-kits/setup", async (req, res) => {
  try {
    // Get distinct org_ids with their best kit status
    const results = await sql`
      SELECT DISTINCT ON (org_id)
        org_id,
        status,
        CASE WHEN status IN ('validated', 'drafted', 'generating') THEN true ELSE false END as has_kit,
        CASE WHEN status IN ('validated', 'drafted') THEN true ELSE false END as is_setup
      FROM media_kits
      WHERE status IN ('validated', 'drafted', 'generating')
      ORDER BY org_id, CASE status
        WHEN 'validated' THEN 1
        WHEN 'drafted' THEN 2
        WHEN 'generating' THEN 3
      END
    `;

    res.json({
      organizations: results.map((r: Record<string, unknown>) => ({
        orgId: r.org_id,
        hasKit: r.has_kit,
        status: r.status,
        isSetup: r.is_setup,
      })),
    });
  } catch (err) {
    console.error("GET /internal/media-kits/setup error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /internal/health/bulk — health per org
router.get("/internal/health/bulk", async (req, res) => {
  try {
    const results = await sql`
      SELECT
        org_id,
        COUNT(*)::int as total_kits,
        bool_or(status = 'validated') as has_validated,
        bool_or(status = 'drafted') as has_drafted
      FROM media_kits
      GROUP BY org_id
    `;

    res.json({
      organizations: results.map((r: Record<string, unknown>) => ({
        orgId: r.org_id,
        hasValidated: r.has_validated,
        hasDrafted: r.has_drafted,
        totalKits: r.total_kits,
      })),
    });
  } catch (err) {
    console.error("GET /internal/health/bulk error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /internal/email-data/:orgId — press kit data for email templates
router.get("/internal/email-data/:orgId", async (req, res) => {
  try {
    const kit = await db.query.mediaKits.findFirst({
      where: and(
        eq(mediaKits.orgId, req.params.orgId),
        inArray(mediaKits.status, ["validated", "drafted"])
      ),
      orderBy: desc(mediaKits.updatedAt),
    });

    if (!kit) {
      res.json({
        status: null,
        title: null,
        pressKitUrl: null,
        content: null,
      });
      return;
    }

    const pressKitUrl = kit.shareToken ? `/public/${kit.shareToken}` : null;

    res.json({
      status: kit.status,
      title: kit.title,
      pressKitUrl,
      content: kit.mdxPageContent,
    });
  } catch (err) {
    console.error("GET /internal/email-data error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
