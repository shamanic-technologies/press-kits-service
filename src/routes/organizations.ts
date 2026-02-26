import { Router } from "express";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { organizations } from "../db/schema.js";
import { UpsertOrganizationRequestSchema } from "../schemas.js";

const router = Router();

// POST /organizations — upsert org by org_id
router.post("/organizations", async (req, res) => {
  try {
    const body = UpsertOrganizationRequestSchema.parse(req.body);

    const [org] = await db
      .insert(organizations)
      .values({
        orgId: body.orgId,
        name: body.name ?? null,
      })
      .onConflictDoUpdate({
        target: organizations.orgId,
        set: {
          name: body.name ?? undefined,
          updatedAt: new Date(),
        },
      })
      .returning();

    res.json(org);
  } catch (err) {
    console.error("POST /organizations error:", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Bad request" });
  }
});

// GET /organizations/share-token/:orgId
router.get("/organizations/share-token/:orgId", async (req, res) => {
  try {
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.orgId, req.params.orgId),
    });

    if (!org) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }

    res.json({ shareToken: org.shareToken });
  } catch (err) {
    console.error("GET /organizations/share-token error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /organizations/exists — batch check
router.get("/organizations/exists", async (req, res) => {
  try {
    const orgIdsParam = req.query.orgIds as string;
    if (!orgIdsParam) {
      res.status(400).json({ error: "orgIds query parameter is required" });
      return;
    }

    const orgIds = orgIdsParam.split(",").map((s) => s.trim()).filter(Boolean);

    const existingOrgs = await db
      .select({ orgId: organizations.orgId })
      .from(organizations)
      .where(inArray(organizations.orgId, orgIds));

    const existingSet = new Set(existingOrgs.map((o) => o.orgId));

    res.json({
      organizations: orgIds.map((id) => ({
        orgId: id,
        exists: existingSet.has(id),
      })),
    });
  } catch (err) {
    console.error("GET /organizations/exists error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
