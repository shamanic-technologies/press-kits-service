import { Router } from "express";
import { eq, ilike, desc, sql as drizzleSql } from "drizzle-orm";
import { db } from "../db/index.js";
import { mediaKits, mediaKitInstructions } from "../db/schema.js";

const router = Router();

// GET /admin/media-kits — list all kits with optional search
router.get("/admin/media-kits", async (req, res) => {
  try {
    const search = req.query.search as string | undefined;

    const conditions = search
      ? ilike(mediaKits.title, `%${search}%`)
      : undefined;

    const results = await db
      .select()
      .from(mediaKits)
      .where(conditions)
      .orderBy(desc(mediaKits.updatedAt));

    res.json({ mediaKits: results });
  } catch (err) {
    console.error("GET /admin/media-kits error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /admin/media-kits/:id — delete a media kit
router.delete("/admin/media-kits/:id", async (req, res) => {
  try {
    const kit = await db.query.mediaKits.findFirst({
      where: eq(mediaKits.id, req.params.id),
    });

    if (!kit) {
      res.status(404).json({ error: "Media kit not found" });
      return;
    }

    await db.delete(mediaKitInstructions).where(eq(mediaKitInstructions.mediaKitId, kit.id));
    await db.delete(mediaKits).where(eq(mediaKits.id, kit.id));

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /admin/media-kits error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
