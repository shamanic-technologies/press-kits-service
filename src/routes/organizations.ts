import { Router } from "express";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { organizations } from "../db/schema.js";
import { UpsertOrganizationRequestSchema } from "../schemas.js";

const router = Router();

// POST /organizations — upsert org by clerk_organization_id
router.post("/organizations", async (req, res) => {
  try {
    const body = UpsertOrganizationRequestSchema.parse(req.body);

    const [org] = await db
      .insert(organizations)
      .values({
        clerkOrganizationId: body.clerkOrganizationId,
        name: body.name ?? null,
      })
      .onConflictDoUpdate({
        target: organizations.clerkOrganizationId,
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

// GET /organizations/share-token/:clerkOrgId
router.get("/organizations/share-token/:clerkOrgId", async (req, res) => {
  try {
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.clerkOrganizationId, req.params.clerkOrgId),
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
    const clerkOrgIdsParam = req.query.clerkOrgIds as string;
    if (!clerkOrgIdsParam) {
      res.status(400).json({ error: "clerkOrgIds query parameter is required" });
      return;
    }

    const clerkOrgIds = clerkOrgIdsParam.split(",").map((s) => s.trim()).filter(Boolean);

    const existingOrgs = await db
      .select({ clerkOrganizationId: organizations.clerkOrganizationId })
      .from(organizations)
      .where(inArray(organizations.clerkOrganizationId, clerkOrgIds));

    const existingSet = new Set(existingOrgs.map((o) => o.clerkOrganizationId));

    res.json({
      organizations: clerkOrgIds.map((id) => ({
        clerkOrganizationId: id,
        exists: existingSet.has(id),
      })),
    });
  } catch (err) {
    console.error("GET /organizations/exists error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
