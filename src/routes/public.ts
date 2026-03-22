import { Router } from "express";
import { eq, and, inArray, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { organizations, mediaKits } from "../db/schema.js";

const router = Router();

// GET /public/:token — get validated kit by share_token (fallback to drafted)
router.get("/public/:token", async (req, res) => {
  try {
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.shareToken, req.params.token),
    });

    if (!org) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }

    // Try validated first, fallback to drafted
    let kit = await db.query.mediaKits.findFirst({
      where: and(
        eq(mediaKits.organizationId, org.id),
        eq(mediaKits.status, "validated")
      ),
      orderBy: desc(mediaKits.updatedAt),
    });

    if (!kit) {
      kit = await db.query.mediaKits.findFirst({
        where: and(
          eq(mediaKits.organizationId, org.id),
          eq(mediaKits.status, "drafted")
        ),
        orderBy: desc(mediaKits.updatedAt),
      });
    }

    res.json({
      organization: {
        id: org.id,
        name: org.name,
        orgId: org.orgId,
      },
      mediaKit: kit ?? null,
    });
  } catch (err) {
    console.error("GET /public/:token error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
