import { Router } from "express";
import { eq, and, inArray, ilike, sql as drizzleSql, desc } from "drizzle-orm";
import { db, sql } from "../db/index.js";
import { mediaKits, mediaKitInstructions } from "../db/schema.js";
import {
  UpdateMdxRequestSchema,
  UpdateStatusRequestSchema,
  EditMediaKitRequestSchema,
  ValidateMediaKitRequestSchema,
  CancelDraftRequestSchema,
} from "../schemas.js";
import { createRun } from "../lib/runs-client.js";
import { executeWorkflowByName } from "../lib/windmill-client.js";
import { sendEmail } from "../lib/email-client.js";

const router = Router();

const ACTIVE_STATUSES = ["validated", "drafted", "generating"] as const;

// GET /media-kit — list kits for an org
router.get("/media-kit", async (req, res) => {
  try {
    const clerkOrgId = req.query.clerk_organization_id as string | undefined;
    const orgId = req.query.organization_id as string | undefined;
    const titleFilter = req.query.title as string | undefined;

    if (!clerkOrgId && !orgId) {
      res.status(400).json({ error: "clerk_organization_id or organization_id required" });
      return;
    }

    const conditions = [
      inArray(mediaKits.status, [...ACTIVE_STATUSES]),
    ];

    if (clerkOrgId) {
      conditions.push(eq(mediaKits.clerkOrganizationId, clerkOrgId));
    }
    if (orgId) {
      conditions.push(eq(mediaKits.organizationId, orgId));
    }
    if (titleFilter) {
      conditions.push(ilike(mediaKits.title, `%${titleFilter}%`));
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
    console.error("GET /media-kit error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /media-kit/:id
router.get("/media-kit/:id", async (req, res) => {
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
    console.error("GET /media-kit/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /update-mdx
router.post("/update-mdx", async (req, res) => {
  try {
    const body = UpdateMdxRequestSchema.parse(req.body);

    const [updated] = await db
      .update(mediaKits)
      .set({ mdxPageContent: body.mdxContent, updatedAt: new Date() })
      .where(eq(mediaKits.id, body.mediaKitId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Media kit not found" });
      return;
    }

    res.json(updated);
  } catch (err) {
    console.error("POST /update-mdx error:", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Bad request" });
  }
});

// POST /update-status
router.post("/update-status", async (req, res) => {
  try {
    const body = UpdateStatusRequestSchema.parse(req.body);

    const result = await sql`
      SELECT * FROM update_media_kit_status(
        ${body.mediaKitId}::uuid,
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
    console.error("POST /update-status error:", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Bad request" });
  }
});

// POST /edit-media-kit
router.post("/edit-media-kit", async (req, res) => {
  try {
    const body = EditMediaKitRequestSchema.parse(req.body);

    // Fetch current kit
    const currentKit = await db.query.mediaKits.findFirst({
      where: eq(mediaKits.id, body.mediaKitId),
    });

    if (!currentKit) {
      res.status(404).json({ error: "Media kit not found" });
      return;
    }

    let generatingKit;

    if (currentKit.status === "validated" || currentKit.status === "drafted") {
      // Create copy with status=generating
      const [newKit] = await db
        .insert(mediaKits)
        .values({
          clientOrganizationId: currentKit.clientOrganizationId,
          clerkOrganizationId: currentKit.clerkOrganizationId,
          organizationId: currentKit.organizationId,
          title: currentKit.title,
          iconUrl: currentKit.iconUrl,
          mdxPageContent: currentKit.mdxPageContent,
          jsxPageContent: currentKit.jsxPageContent,
          jsonPageContent: currentKit.jsonPageContent,
          notionPageContent: currentKit.notionPageContent,
          parentMediaKitId: currentKit.id,
          status: "generating",
        })
        .returning();
      generatingKit = newKit;
    } else if (currentKit.status === "generating") {
      // Update timestamp
      const [updated] = await db
        .update(mediaKits)
        .set({ updatedAt: new Date() })
        .where(eq(mediaKits.id, currentKit.id))
        .returning();
      generatingKit = updated;
    } else {
      res.status(400).json({ error: `Cannot edit kit with status: ${currentKit.status}` });
      return;
    }

    // Store instruction
    await db.insert(mediaKitInstructions).values({
      mediaKitId: generatingKit.id,
      instruction: body.instruction,
      instructionType: currentKit.status === "generating" ? "edit" : "initial",
    });

    // Create run + trigger workflow (fire-and-forget)
    const clerkOrgId = generatingKit.clerkOrganizationId;
    if (clerkOrgId) {
      createRun({
        clerkOrgId,
        appId: "press-kits-service",
        serviceName: "press-kits-service",
        taskName: "generate-press-kit",
      })
        .then((run) =>
          executeWorkflowByName("generate-press-kit", "press-kits-service", {
            clerkOrgId,
            mediaKitId: generatingKit.id,
            organizationUrl: body.organizationUrl,
          }, run.id)
        )
        .catch((err) => console.error("Workflow trigger failed:", err));
    }

    res.json(generatingKit);
  } catch (err) {
    console.error("POST /edit-media-kit error:", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Bad request" });
  }
});

// POST /validate
router.post("/validate", async (req, res) => {
  try {
    const body = ValidateMediaKitRequestSchema.parse(req.body);

    const result = await sql`
      SELECT * FROM validate_media_kit_with_archive(${body.mediaKitId}::uuid)
    `;

    if (result.length === 0) {
      res.status(404).json({ error: "Media kit not found" });
      return;
    }

    const kit = result[0];

    // Send press_kit_ready email (fire-and-forget)
    if (kit.clerk_organization_id) {
      sendEmail({
        appId: "press-kits-service",
        eventType: "press_kit_ready",
        clerkOrgId: kit.clerk_organization_id as string,
        metadata: {
          title: (kit.title as string) || "Press Kit",
        },
      }).catch((err) => console.error("Email send failed:", err));
    }

    res.json(kit);
  } catch (err) {
    console.error("POST /validate error:", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Bad request" });
  }
});

// POST /cancel-draft
router.post("/cancel-draft", async (req, res) => {
  try {
    const body = CancelDraftRequestSchema.parse(req.body);

    const result = await sql`
      SELECT * FROM cancel_draft_media_kit(${body.mediaKitId}::uuid)
    `;

    res.json({ success: true, result: result[0] ?? null });
  } catch (err) {
    console.error("POST /cancel-draft error:", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Bad request" });
  }
});

export default router;
