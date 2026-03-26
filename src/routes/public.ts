import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { mediaKits } from "../db/schema.js";

const router = Router();

// GET /public/:token — get media kit by its share_token
router.get("/public/:token", async (req, res) => {
  try {
    const kit = await db.query.mediaKits.findFirst({
      where: eq(mediaKits.shareToken, req.params.token),
    });

    if (!kit) {
      res.status(404).json({ error: "Media kit not found" });
      return;
    }

    res.json({ mediaKit: kit });
  } catch (err) {
    console.error("GET /public/:token error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
