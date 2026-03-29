import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { mediaKits, mediaKitInstructions } from "../db/schema.js";
import { UpsertGenerationResultRequestSchema, GenerationFailureRequestSchema } from "../schemas.js";

const router = Router();

// GET /internal/media-kits/current — latest kit for the given scope
router.get("/internal/media-kits/current", async (req, res) => {
  try {
    const orgId = req.orgId;
    const brandId = req.query.brand_id as string | undefined;
    const campaignId = req.query.campaign_id as string | undefined;

    const conditions = [eq(mediaKits.orgId, orgId)];
    if (brandId) conditions.push(eq(mediaKits.brandId, brandId));
    if (campaignId) conditions.push(eq(mediaKits.campaignId, campaignId));

    const kit = await db.query.mediaKits.findFirst({
      where: and(...conditions),
      orderBy: desc(mediaKits.updatedAt),
    });

    res.json(kit ?? null);
  } catch (err) {
    console.error("GET /internal/media-kits/current error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /internal/media-kits/generation-data — data for generation workflow
router.get("/internal/media-kits/generation-data", async (req, res) => {
  try {
    const mediaKitId = req.query.media_kit_id as string | undefined;
    const orgId = req.orgId;

    // Find the generating kit: by ID if provided, else by orgId
    let currentKit;
    if (mediaKitId) {
      currentKit = await db.query.mediaKits.findFirst({
        where: and(
          eq(mediaKits.id, mediaKitId),
          eq(mediaKits.status, "generating"),
        ),
      });
    } else {
      currentKit = await db.query.mediaKits.findFirst({
        where: and(
          eq(mediaKits.orgId, orgId),
          eq(mediaKits.status, "generating"),
        ),
      });
    }

    // Get instructions for this specific kit
    const instructions = currentKit
      ? await db
          .select()
          .from(mediaKitInstructions)
          .where(eq(mediaKitInstructions.mediaKitId, currentKit.id))
          .orderBy(mediaKitInstructions.createdAt)
      : [];

    // Get feedbacks (denied kits) scoped to same org+campaign
    const feedbackConditions = [eq(mediaKits.orgId, orgId)];
    if (currentKit?.campaignId) {
      feedbackConditions.push(eq(mediaKits.campaignId, currentKit.campaignId));
    }

    const feedbackResults = currentKit
      ? await db
          .select({ id: mediaKits.id, denialReason: mediaKits.denialReason })
          .from(mediaKits)
          .where(and(...feedbackConditions, eq(mediaKits.status, "denied")))
          .orderBy(mediaKits.updatedAt)
      : [];

    res.json({
      currentKit: currentKit ?? null,
      instructions: instructions.map((r) => ({
        id: r.id,
        instruction: r.instruction,
        instructionType: r.instructionType,
        createdAt: String(r.createdAt),
      })),
      feedbacks: feedbackResults
        .filter((r) => r.denialReason !== null)
        .map((r) => ({
          id: r.id,
          denialReason: r.denialReason,
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

    // Find generating kit: by mediaKitId if provided, else by orgId
    let condition;
    if (body.mediaKitId) {
      condition = and(
        eq(mediaKits.id, body.mediaKitId),
        eq(mediaKits.status, "generating"),
      );
    } else {
      const orgId = body.orgId ?? req.orgId;
      condition = and(
        eq(mediaKits.orgId, orgId),
        eq(mediaKits.status, "generating"),
      );
    }

    const [updated] = await db
      .update(mediaKits)
      .set({
        mdxPageContent: body.mdxContent,
        title: body.title ?? undefined,
        iconUrl: body.iconUrl ?? undefined,
        status: "drafted",
        updatedAt: new Date(),
      })
      .where(condition)
      .returning();

    if (!updated) {
      res.status(404).json({ error: "No generating kit found" });
      return;
    }

    res.json(updated);
  } catch (err) {
    console.error("POST /internal/media-kits/generation-result error:", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Bad request" });
  }
});

// POST /internal/media-kits/generation-failure — workflow failure callback
router.post("/internal/media-kits/generation-failure", async (req, res) => {
  try {
    const body = GenerationFailureRequestSchema.parse(req.body);

    let condition;
    if (body.mediaKitId) {
      condition = and(
        eq(mediaKits.id, body.mediaKitId),
        eq(mediaKits.status, "generating"),
      );
    } else {
      const orgId = body.orgId ?? req.orgId;
      condition = and(
        eq(mediaKits.orgId, orgId),
        eq(mediaKits.status, "generating"),
      );
    }

    const [updated] = await db
      .update(mediaKits)
      .set({
        status: "denied",
        denialReason: body.reason || "Generation workflow failed",
        updatedAt: new Date(),
      })
      .where(condition)
      .returning();

    if (!updated) {
      res.status(404).json({ error: "No generating kit found" });
      return;
    }

    console.log(`[press-kits-service] Kit ${updated.id} marked as denied: ${body.reason || "Generation workflow failed"}`);
    res.json(updated);
  } catch (err) {
    console.error("[press-kits-service] POST /internal/media-kits/generation-failure error:", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Bad request" });
  }
});

// GET /internal/email-data/:orgId — press kit data for email templates
router.get("/internal/email-data/:orgId", async (req, res) => {
  try {
    const kit = await db.query.mediaKits.findFirst({
      where: and(
        eq(mediaKits.orgId, req.params.orgId),
        eq(mediaKits.status, "validated"),
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
