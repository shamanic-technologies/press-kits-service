import { Router } from "express";
import { eq, and, inArray, desc, lt } from "drizzle-orm";
import { db, sql } from "../db/index.js";
import { organizations, mediaKits, mediaKitInstructions } from "../db/schema.js";
import { UpsertGenerationResultRequestSchema } from "../schemas.js";

const router = Router();

// GET /internal/media-kit/by-org/:orgId — latest kit for an org
router.get("/internal/media-kit/by-org/:orgId", async (req, res) => {
  try {
    const kit = await db.query.mediaKits.findFirst({
      where: eq(mediaKits.orgId, req.params.orgId),
      orderBy: desc(mediaKits.updatedAt),
    });

    res.json(kit ?? null);
  } catch (err) {
    console.error("GET /internal/media-kit/by-org error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /internal/generation-data — data for generation workflow
router.get("/internal/generation-data", async (req, res) => {
  try {
    const orgId = req.query.orgId as string;
    if (!orgId) {
      res.status(400).json({ error: "orgId query parameter required" });
      return;
    }

    // Current generating kit
    const currentKit = await db.query.mediaKits.findFirst({
      where: and(
        eq(mediaKits.orgId, orgId),
        eq(mediaKits.status, "generating")
      ),
    });

    // All instructions for this org's kits
    const instructionResults = await sql`
      SELECT mki.id, mki.instruction, mki.instruction_type, mki.created_at
      FROM media_kit_instructions mki
      JOIN media_kits mk ON mki.media_kit_id = mk.id
      WHERE mk.org_id = ${orgId}
      ORDER BY mki.created_at
    `;

    // All feedbacks (denial reasons)
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
    console.error("GET /internal/generation-data error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /internal/upsert-generation-result — workflow callback
router.post("/internal/upsert-generation-result", async (req, res) => {
  try {
    const body = UpsertGenerationResultRequestSchema.parse(req.body);

    const result = await sql`
      SELECT * FROM upsert_generating_media_kit_by_org(
        ${JSON.stringify({
          mdx_page_content: body.mdxContent,
          title: body.title ?? null,
          icon_url: body.iconUrl ?? null,
        })}::jsonb,
        ${body.orgId}::varchar
      )
    `;

    if (result.length === 0) {
      res.status(404).json({ error: "No generating kit found for org" });
      return;
    }

    res.json(result[0]);
  } catch (err) {
    console.error("POST /internal/upsert-generation-result error:", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Bad request" });
  }
});

// GET /clients-media-kits-need-update — orgs with stale kits (>1 month old)
router.get("/clients-media-kits-need-update", async (req, res) => {
  try {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    const results = await db
      .select({
        orgId: organizations.orgId,
        name: organizations.name,
        lastUpdated: mediaKits.updatedAt,
      })
      .from(organizations)
      .innerJoin(mediaKits, eq(mediaKits.organizationId, organizations.id))
      .where(
        and(
          inArray(mediaKits.status, ["validated", "drafted"]),
          lt(mediaKits.updatedAt, oneMonthAgo)
        )
      )
      .orderBy(mediaKits.updatedAt);

    // Deduplicate by org (keep oldest)
    const seen = new Set<string>();
    const deduped = results.filter((r) => {
      if (seen.has(r.orgId)) return false;
      seen.add(r.orgId);
      return true;
    });

    res.json({
      organizations: deduped.map((r) => ({
        orgId: r.orgId,
        name: r.name,
        lastUpdated: r.lastUpdated.toISOString(),
      })),
    });
  } catch (err) {
    console.error("GET /clients-media-kits-need-update error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /media-kit-setup — setup status for all orgs
router.get("/media-kit-setup", async (req, res) => {
  try {
    const orgs = await db.select().from(organizations);

    const result = await Promise.all(
      orgs.map(async (org) => {
        const kit = await db.query.mediaKits.findFirst({
          where: and(
            eq(mediaKits.organizationId, org.id),
            inArray(mediaKits.status, ["validated", "drafted", "generating"])
          ),
          orderBy: desc(mediaKits.updatedAt),
        });

        return {
          orgId: org.orgId,
          hasKit: !!kit,
          status: kit?.status ?? null,
          isSetup: kit?.status === "validated" || kit?.status === "drafted",
        };
      })
    );

    res.json({ organizations: result });
  } catch (err) {
    console.error("GET /media-kit-setup error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /health/bulk — health per org
router.get("/health/bulk", async (req, res) => {
  try {
    const orgs = await db.select().from(organizations);

    const result = await Promise.all(
      orgs.map(async (org) => {
        const kits = await db
          .select()
          .from(mediaKits)
          .where(eq(mediaKits.organizationId, org.id));

        return {
          orgId: org.orgId,
          hasValidated: kits.some((k) => k.status === "validated"),
          hasDrafted: kits.some((k) => k.status === "drafted"),
          totalKits: kits.length,
        };
      })
    );

    res.json({ organizations: result });
  } catch (err) {
    console.error("GET /health/bulk error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
