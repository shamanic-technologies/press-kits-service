import { Router } from "express";
import { eq, and, inArray, desc, lt } from "drizzle-orm";
import { db, sql } from "../db/index.js";
import { organizations, mediaKits, mediaKitInstructions } from "../db/schema.js";
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

// GET /internal/media-kits/stale — orgs with stale kits (>1 month old)
router.get("/internal/media-kits/stale", async (req, res) => {
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
    console.error("GET /internal/media-kits/stale error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /internal/media-kits/setup — setup status for all orgs
router.get("/internal/media-kits/setup", async (req, res) => {
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
    console.error("GET /internal/media-kits/setup error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /internal/health/bulk — health per org
router.get("/internal/health/bulk", async (req, res) => {
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
    console.error("GET /internal/health/bulk error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /internal/email-data/:orgId — press kit data for email templates
router.get("/internal/email-data/:orgId", async (req, res) => {
  try {
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.orgId, req.params.orgId),
    });

    if (!org) {
      res.json({
        companyName: null,
        status: null,
        title: null,
        pressKitUrl: null,
        content: null,
        contentType: null,
      });
      return;
    }

    const kit = await db.query.mediaKits.findFirst({
      where: and(
        eq(mediaKits.organizationId, org.id),
        inArray(mediaKits.status, ["validated", "drafted"])
      ),
      orderBy: desc(mediaKits.updatedAt),
    });

    const pressKitUrl = org.shareToken ? `/public/${org.shareToken}` : null;

    res.json({
      companyName: org.name,
      status: kit?.status ?? null,
      title: kit?.title ?? null,
      pressKitUrl,
      content: kit?.mdxPageContent ?? kit?.jsxPageContent ?? null,
      contentType: kit?.mdxPageContent ? "mdx" : kit?.jsxPageContent ? "jsx" : null,
    });
  } catch (err) {
    console.error("GET /internal/email-data error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
