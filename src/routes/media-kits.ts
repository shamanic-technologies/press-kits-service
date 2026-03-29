import { Router } from "express";
import { eq, and, inArray, ilike, sql as drizzleSql, desc, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { mediaKits, mediaKitInstructions } from "../db/schema.js";
import {
  UpdateMdxRequestSchema,
  UpdateStatusRequestSchema,
  CreateMediaKitRequestSchema,
} from "../schemas.js";
import { createRun } from "../lib/runs-client.js";
import { executeWorkflowBySlug } from "../lib/windmill-client.js";
import { sendEmail } from "../lib/email-client.js";
import { getContextHeaders } from "../middleware/auth.js";

const router = Router();

const ACTIVE_STATUSES = ["validated", "drafted", "generating"] as const;

const EXCERPT_LENGTH = 200;

/** Strip MDX/Markdown markup and return first ~200 chars of plain text. */
function extractContentExcerpt(mdx: string | null): string | null {
  if (!mdx) return null;
  const plain = mdx
    .replace(/^import\s.*$/gm, "")      // import statements
    .replace(/<[^>]+>/g, "")             // JSX/HTML tags
    .replace(/!\[.*?\]\(.*?\)/g, "")     // images
    .replace(/\[([^\]]*)\]\(.*?\)/g, "$1") // links → text
    .replace(/^#{1,6}\s+/gm, "")        // headings
    .replace(/[*_~`>]/g, "")            // inline formatting
    .replace(/\n{2,}/g, " ")            // collapse blank lines
    .replace(/\n/g, " ")                // remaining newlines
    .replace(/ {2,}/g, " ")             // collapse multiple spaces
    .trim();
  if (!plain) return null;
  return plain.length <= EXCERPT_LENGTH
    ? plain
    : plain.slice(0, EXCERPT_LENGTH).replace(/\s\S*$/, "...");
}

// GET /media-kits — list kits for an org
router.get("/media-kits", async (req, res) => {
  try {
    const orgIdParam = req.query.org_id as string | undefined;
    const titleFilter = req.query.title as string | undefined;
    const campaignIdFilter = req.query.campaign_id as string | undefined;
    const brandIdFilter = req.query.brand_id as string | undefined;

    if (!orgIdParam && !campaignIdFilter && !brandIdFilter) {
      res.status(400).json({ error: "org_id, campaign_id, or brand_id required" });
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
    if (brandIdFilter) {
      conditions.push(eq(mediaKits.brandId, brandIdFilter));
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

    const summaries = results.map(({ mdxPageContent, ...rest }) => ({
      ...rest,
      contentExcerpt: extractContentExcerpt(mdxPageContent),
    }));

    res.json({ mediaKits: summaries });
  } catch (err) {
    console.error("[press-kits-service] GET /media-kits error:", err);
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

// PATCH /media-kits/:id/status — update status (replaces update_media_kit_status SQL function)
router.patch("/media-kits/:id/status", async (req, res) => {
  try {
    const body = UpdateStatusRequestSchema.parse(req.body);

    const [updated] = await db
      .update(mediaKits)
      .set({
        status: body.status,
        denialReason: body.denialReason ?? null,
        updatedAt: new Date(),
      })
      .where(eq(mediaKits.id, req.params.id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Media kit not found" });
      return;
    }

    res.json(updated);
  } catch (err) {
    console.error("PATCH /media-kits/:id/status error:", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Bad request" });
  }
});

/** Build scope conditions for orgId + optional brandId + campaignId */
function buildScopeConditions(orgId: string, brandId?: string | null, campaignId?: string | null) {
  const conditions = [eq(mediaKits.orgId, orgId)];
  if (brandId) {
    conditions.push(eq(mediaKits.brandId, brandId));
  } else {
    conditions.push(isNull(mediaKits.brandId));
  }
  if (campaignId) {
    conditions.push(eq(mediaKits.campaignId, campaignId));
  } else {
    conditions.push(isNull(mediaKits.campaignId));
  }
  return conditions;
}

// POST /media-kits — create or edit a media kit
router.post("/media-kits", async (req, res) => {
  try {
    const body = CreateMediaKitRequestSchema.parse(req.body);
    const ctx = getContextHeaders(req);
    const orgId = req.orgId;

    // Resolve the current kit: by ID or by org+brand+campaign scope
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
      // Find latest active kit scoped by org + brand + campaign
      const scopeConditions = buildScopeConditions(orgId, ctx.brandId, ctx.campaignId);
      currentKit = await db.query.mediaKits.findFirst({
        where: and(
          ...scopeConditions,
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
      // First kit for this scope — create from scratch
      const [newKit] = await db
        .insert(mediaKits)
        .values({
          orgId,
          status: "generating",
          workflowSlug: ctx.workflowSlug ?? null,
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
          workflowSlug: ctx.workflowSlug ?? null,
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
          workflowSlug: ctx.workflowSlug ?? currentKit.workflowSlug,
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

    createRun({
      orgId: kitOrgId,
      userId: req.userId,
      serviceName: "press-kits-service",
      taskName: "generate-press-kit",
      parentRunId: req.runId,
      ctx,
    })
      .then((run) =>
        executeWorkflowBySlug("generate-press-kit", {
          orgId: kitOrgId,
          mediaKitId: generatingKit.id,
        }, run.id, ctx)
      )
      .catch((err) => console.error("Workflow trigger failed:", err));

    res.json(generatingKit);
  } catch (err) {
    console.error("POST /media-kits error:", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Bad request" });
  }
});

// POST /media-kits/:id/validate — replaces validate_media_kit_with_archive SQL function
router.post("/media-kits/:id/validate", async (req, res) => {
  try {
    const ctx = getContextHeaders(req);

    const kit = await db.transaction(async (tx) => {
      // Find the kit to validate
      const [target] = await tx
        .select()
        .from(mediaKits)
        .where(eq(mediaKits.id, req.params.id));

      if (!target) return null;

      // Archive existing validated kits in same scope (org + campaign)
      const archiveConditions = [
        eq(mediaKits.orgId, target.orgId),
        eq(mediaKits.status, "validated"),
        drizzleSql`${mediaKits.id} != ${target.id}`,
      ];
      if (target.campaignId) {
        archiveConditions.push(eq(mediaKits.campaignId, target.campaignId));
      } else {
        archiveConditions.push(isNull(mediaKits.campaignId));
      }

      await tx
        .update(mediaKits)
        .set({ status: "archived", updatedAt: new Date() })
        .where(and(...archiveConditions));

      // Set this kit to validated
      const [validated] = await tx
        .update(mediaKits)
        .set({ status: "validated", updatedAt: new Date() })
        .where(eq(mediaKits.id, target.id))
        .returning();

      return validated;
    });

    if (!kit) {
      res.status(404).json({ error: "Media kit not found" });
      return;
    }

    // Send press_kit_ready email (fire-and-forget)
    sendEmail({
      eventType: "press_kit_ready",
      orgId: kit.orgId,
      metadata: { title: kit.title || "Press Kit" },
    }, ctx).catch((err) => console.error("Email send failed:", err));

    res.json(kit);
  } catch (err) {
    console.error("POST /media-kits/:id/validate error:", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Bad request" });
  }
});

// POST /media-kits/:id/cancel — replaces cancel_draft_media_kit SQL function
router.post("/media-kits/:id/cancel", async (req, res) => {
  try {
    const result = await db.transaction(async (tx) => {
      // Find the kit to cancel
      const [target] = await tx
        .select()
        .from(mediaKits)
        .where(eq(mediaKits.id, req.params.id));

      if (!target) return null;

      // If it has a parent, restore the parent to "drafted"
      if (target.parentMediaKitId) {
        await tx
          .update(mediaKits)
          .set({ status: "drafted", updatedAt: new Date() })
          .where(eq(mediaKits.id, target.parentMediaKitId));
      }

      // Delete the cancelled kit (cascade deletes instructions)
      await tx.delete(mediaKits).where(eq(mediaKits.id, target.id));

      return { parentId: target.parentMediaKitId };
    });

    if (!result) {
      res.status(404).json({ error: "Media kit not found" });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    console.error("POST /media-kits/:id/cancel error:", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Bad request" });
  }
});

export default router;
