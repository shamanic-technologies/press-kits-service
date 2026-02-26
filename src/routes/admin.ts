import { Router } from "express";
import { eq, ilike, sql as drizzleSql } from "drizzle-orm";
import { db } from "../db/index.js";
import { organizations, mediaKits } from "../db/schema.js";

const router = Router();

// GET /admin/organizations — list orgs with kit counts
router.get("/admin/organizations", async (req, res) => {
  try {
    const search = req.query.search as string | undefined;

    const conditions = search
      ? ilike(organizations.name, `%${search}%`)
      : undefined;

    const results = await db
      .select({
        id: organizations.id,
        orgId: organizations.orgId,
        name: organizations.name,
        shareToken: organizations.shareToken,
        createdAt: organizations.createdAt,
        updatedAt: organizations.updatedAt,
        mediaKitCount: drizzleSql<number>`(
          SELECT COUNT(*)::int FROM media_kits
          WHERE media_kits.organization_id = organizations.id
        )`.mapWith(Number),
      })
      .from(organizations)
      .where(conditions)
      .orderBy(organizations.createdAt);

    res.json({ organizations: results });
  } catch (err) {
    console.error("GET /admin/organizations error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /admin/organizations/:id — delete org (requires confirmName)
router.delete("/admin/organizations/:id", async (req, res) => {
  try {
    const confirmName = req.query.confirmName as string;
    if (!confirmName) {
      res.status(400).json({ error: "confirmName query parameter is required" });
      return;
    }

    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, req.params.id),
    });

    if (!org) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }

    if (org.name !== confirmName) {
      res.status(400).json({ error: "confirmName does not match organization name" });
      return;
    }

    // Delete all media kits for this org first, then the org
    await db.delete(mediaKits).where(eq(mediaKits.organizationId, org.id));
    await db.delete(organizations).where(eq(organizations.id, org.id));

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /admin/organizations error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
