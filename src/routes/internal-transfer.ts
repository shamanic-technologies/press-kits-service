import { Router } from "express";
import { eq, and, sql as drizzleSql } from "drizzle-orm";
import { db } from "../db/index.js";
import { mediaKits } from "../db/schema.js";
import { TransferBrandRequestSchema } from "../schemas.js";

const router = Router();

// POST /internal/transfer-brand — re-assign solo-brand rows to a new org
router.post("/internal/transfer-brand", async (req, res) => {
  try {
    const { brandId, sourceOrgId, targetOrgId } = TransferBrandRequestSchema.parse(req.body);

    // Update media_kits where org_id = sourceOrgId AND brand_ids has exactly one element AND that element is brandId
    const result = await db
      .update(mediaKits)
      .set({ orgId: targetOrgId, updatedAt: new Date() })
      .where(
        and(
          eq(mediaKits.orgId, sourceOrgId),
          drizzleSql`array_length(${mediaKits.brandIds}, 1) = 1`,
          drizzleSql`${mediaKits.brandIds}[1] = ${brandId}`
        )
      )
      .returning({ id: mediaKits.id });

    console.log(`[press-kits-service] transfer-brand: updated ${result.length} media_kits rows (brand=${brandId}, ${sourceOrgId} -> ${targetOrgId})`);

    res.json({
      updatedTables: [{ tableName: "media_kits", count: result.length }],
    });
  } catch (err) {
    console.error("[press-kits-service] POST /internal/transfer-brand error:", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Bad request" });
  }
});

export default router;
