import { Router } from "express";
import { eq, and, sql as drizzleSql } from "drizzle-orm";
import { db } from "../db/index.js";
import { mediaKits } from "../db/schema.js";
import { TransferBrandRequestSchema } from "../schemas.js";

const router = Router();

// POST /internal/transfer-brand — re-assign solo-brand rows to a new org
router.post("/internal/transfer-brand", async (req, res) => {
  try {
    const { sourceBrandId, sourceOrgId, targetOrgId, targetBrandId } = TransferBrandRequestSchema.parse(req.body);

    const soloSourceFilter = and(
      drizzleSql`array_length(${mediaKits.brandIds}, 1) = 1`,
      drizzleSql`${mediaKits.brandIds}[1] = ${sourceBrandId}`
    );

    // Step 1: Move org_id for solo-brand rows in sourceOrg
    const step1 = await db
      .update(mediaKits)
      .set({ orgId: targetOrgId, updatedAt: new Date() })
      .where(and(eq(mediaKits.orgId, sourceOrgId), soloSourceFilter))
      .returning({ id: mediaKits.id });

    // Step 2: Rewrite brand_ids everywhere (no org filter) — only when targetBrandId is provided
    let step2Count = 0;
    if (targetBrandId) {
      const step2 = await db
        .update(mediaKits)
        .set({ brandIds: [targetBrandId], updatedAt: new Date() })
        .where(soloSourceFilter)
        .returning({ id: mediaKits.id });
      step2Count = step2.length;
    }

    const totalUpdated = Math.max(step1.length, step2Count);
    console.log(`[press-kits-service] transfer-brand: updated ${totalUpdated} media_kits rows (brand=${sourceBrandId}${targetBrandId ? ` -> ${targetBrandId}` : ""}, ${sourceOrgId} -> ${targetOrgId})`);

    res.json({
      updatedTables: [{ tableName: "media_kits", count: totalUpdated }],
    });
  } catch (err) {
    console.error("[press-kits-service] POST /internal/transfer-brand error:", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Bad request" });
  }
});

export default router;
