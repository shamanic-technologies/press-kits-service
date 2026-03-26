import { Router } from "express";
import { eq, and, inArray, ilike, sql as drizzleSql, desc } from "drizzle-orm";
import { db, sql } from "../db/index.js";
import { mediaKits, mediaKitInstructions } from "../db/schema.js";
import {
  UpdateMdxRequestSchema,
  UpdateStatusRequestSchema,
  CreateMediaKitRequestSchema,
} from "../schemas.js";
import { createRun } from "../lib/runs-client.js";
import { executeWorkflowByName } from "../lib/windmill-client.js";
import { sendEmail } from "../lib/email-client.js";
import { getBrandDomain } from "../lib/brand-client.js";
import { getContextHeaders } from "../middleware/auth.js";

const router = Router();

const ACTIVE_STATUSES = ["validated", "drafted", "generating"] as const;

// GET /media-kits — list kits for an org
router.get("/media-kits", async (req, res) => {
  try {
    const orgIdParam = req.query.org_id as string | undefined;
    const titleFilter = req.query.title as string | undefined;
    const campaignIdFilter = req.query.campaign_id as string | undefined;

    if (!orgIdParam && !campaignIdFilter) {
      res.status(400).json({ error: "org_id or campaign_id required" });
      return;
    }

    const conditions = [
      inArray(mediaKits.status, [...ACTIVE_STATUSES]),
    ];

    if (orgIdParam) {
      conditions.push(eq(mediaKits.orgId, orgIdParam));
    }
    if (titleFilter) {
      conditions.push(ilike(mediaKits.title, `%${titleFilter}%`));
    }
    if (campaignIdFilter) {
      conditions.push(eq(mediaKits.campaignId, campaignIdFilter));
    }

    const results = await db
      .select()
      .from(mediaKits)
      .where(and(...conditions))
      .orderBy(
        drizzleSql`CASE status
          WHEN 'validated' THEN 1
          WHEN 'drafted' THEN 2
          WHEN 'generating' THEN 3
        END`,
        desc(mediaKits.updatedAt)
      );

    res.json({ mediaKits: results });
  } catch (err) {
    console.error("GET /media-kits error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /media-kits/:id
router.get("/media-kits/:id", async (req, res) => {
  try {
    const kit = await db.query.mediaKits.findFirst({
      where: eq(mediaKits.id, req.params.id),
    });

    if (!kit) {
      res.status(404).json({ error: "Media kit not found" });
      return;
    }

    res.json(kit);
  } catch (err) {
    console.error("GET /media-kits/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /media-kits/:id/mdx
router.patch("/media-kits/:id/mdx", async (req, res) => {
  try {
    const body = UpdateMdxRequestSchema.parse(req.body);

    const [updated] = await db
      .update(mediaKits)
      .set({ mdxPageContent: body.mdxContent, updatedAt: new Date() })
      .where(eq(mediaKits.id, req.params.id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Media kit not found" });
      return;
    }

    res.json(updated);
  } catch (err) {
    console.error("PATCH /media-kits/:id/mdx error:", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Bad request" });
  }
});

// PATCH /media-kits/:id/status
router.patch("/media-kits/:id/status", async (req, res) => {
  try {
    const body = UpdateStatusRequestSchema.parse(req.body);

    const result = await sql`
      SELECT * FROM update_media_kit_status(
        ${req.params.id}::uuid,
        ${body.status}::text,
        ${body.denialReason ?? null}::text
      )
    `;

    if (result.length === 0) {
      res.status(404).json({ error: "Media kit not found" });
      return;
    }

    res.json(result[0]);
  } catch (err) {
    console.error("PATCH /media-kits/:id/status error:", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Bad request" });
  }
});

// POST /media-kits — create or edit a media kit
router.post("/media-kits", async (req, res) => {
  try {
    const body = CreateMediaKitRequestSchema.parse(req.body);
    const ctx = getContextHeaders(req);
    const orgId = req.orgId;

    // Resolve the current kit: by ID or by org lookup
    let currentKit;
    if (body.mediaKitId) {
      currentKit = await db.query.mediaKits.findFirst({
        where: eq(mediaKits.id, body.mediaKitId),
      });
      if (!currentKit) {
        res.status(404).json({ error: "Media kit not found" });
        return;
      }
    } else {
      // Find latest active kit for this org
      currentKit = await db.query.mediaKits.findFirst({
        where: and(
          eq(mediaKits.orgId, orgId),
          inArray(mediaKits.status, ["validated", "drafted", "generating"]),
        ),
        orderBy: [
          drizzleSql`CASE status
            WHEN 'generating' THEN 1
            WHEN 'validated' THEN 2
            WHEN 'drafted' THEN 3
          END`,
          desc(mediaKits.updatedAt),
        ],
      });
    }

    let generatingKit;

    if (!currentKit) {
      // First kit for this org — create from scratch
      const [newKit] = await db
        .insert(mediaKits)
        .values({
          orgId,
          status: "generating",
          workflowName: ctx.workflowName ?? null,
          brandId: ctx.brandId ?? null,
          campaignId: ctx.campaignId ?? null,
          featureSlug: ctx.featureSlug ?? null,
        })
        .returning();
      generatingKit = newKit;

      await db.insert(mediaKitInstructions).values({
        mediaKitId: generatingKit.id,
        instruction: body.instruction,
        instructionType: "initial",
      });
    } else if (currentKit.status === "validated" || currentKit.status === "drafted") {
      // Create copy with status=generating
      const [newKit] = await db
        .insert(mediaKits)
        .values({
          orgId: currentKit.orgId,
          title: currentKit.title,
          iconUrl: currentKit.iconUrl,
          mdxPageContent: currentKit.mdxPageContent,
          parentMediaKitId: currentKit.id,
          status: "generating",
          workflowName: ctx.workflowName ?? null,
          brandId: ctx.brandId ?? currentKit.brandId,
          campaignId: ctx.campaignId ?? currentKit.campaignId,
          featureSlug: ctx.featureSlug ?? currentKit.featureSlug,
        })
        .returning();
      generatingKit = newKit;

      await db.insert(mediaKitInstructions).values({
        mediaKitId: generatingKit.id,
        instruction: body.instruction,
        instructionType: "initial",
      });
    } else if (currentKit.status === "generating") {
      // Update timestamp + context fields
      const [updated] = await db
        .update(mediaKits)
        .set({
          updatedAt: new Date(),
          workflowName: ctx.workflowName ?? currentKit.workflowName,
          brandId: ctx.brandId ?? currentKit.brandId,
          campaignId: ctx.campaignId ?? currentKit.campaignId,
          featureSlug: ctx.featureSlug ?? currentKit.featureSlug,
        })
        .where(eq(mediaKits.id, currentKit.id))
        .returning();
      generatingKit = updated;

      await db.insert(mediaKitInstructions).values({
        mediaKitId: generatingKit.id,
        instruction: body.instruction,
        instructionType: "edit",
      });
    } else {
      res.status(400).json({ error: `Cannot edit kit with status: ${currentKit.status}` });
      return;
    }

    // Create run + trigger workflow (fire-and-forget)
    const kitOrgId = generatingKit.orgId;
    const brandDomain = ctx.brandId
      ? getBrandDomain(ctx.brandId, ctx).catch(() => null)
      : Promise.resolve(null);

    Promise.all([
      createRun({
        orgId: kitOrgId,
        userId: req.userId,
        serviceName: "press-kits-service",
        taskName: "generate-press-kit",
        parentRunId: req.runId,
        ctx,
      }),
      brandDomain,
    ])
      .then(([run, domain]) =>
        executeWorkflowByName("generate-press-kit", {
          orgId: kitOrgId,
          mediaKitId: generatingKit.id,
          organizationUrl: domain,
        }, run.id, ctx)
      )
      .catch((err) => console.error("Workflow trigger failed:", err));

    res.json(generatingKit);
  } catch (err) {
    console.error("POST /media-kits error:", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Bad request" });
  }
});

// POST /media-kits/:id/validate
router.post("/media-kits/:id/validate", async (req, res) => {
  try {
    const ctx = getContextHeaders(req);

    const result = await sql`
      SELECT * FROM validate_media_kit_with_archive(${req.params.id}::uuid)
    `;

    if (result.length === 0) {
      res.status(404).json({ error: "Media kit not found" });
      return;
    }

    const kit = result[0];

    // Send press_kit_ready email (fire-and-forget)
    if (kit.org_id) {
      sendEmail({
        eventType: "press_kit_ready",
        orgId: kit.org_id as string,
        metadata: {
          title: (kit.title as string) || "Press Kit",
        },
      }, ctx).catch((err) => console.error("Email send failed:", err));
    }

    res.json(kit);
  } catch (err) {
    console.error("POST /media-kits/:id/validate error:", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Bad request" });
  }
});

// POST /media-kits/:id/cancel
router.post("/media-kits/:id/cancel", async (req, res) => {
  try {
    const result = await sql`
      SELECT * FROM cancel_draft_media_kit(${req.params.id}::uuid)
    `;

    res.json({ success: true, result: result[0] ?? null });
  } catch (err) {
    console.error("POST /media-kits/:id/cancel error:", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Bad request" });
  }
});

export default router;
