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
        clerkOrganizationId: org.clerkOrganizationId,
      },
      mediaKit: kit ?? null,
    });
  } catch (err) {
    console.error("GET /public/:token error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /public-media-kit/:token — same with legacy org lookup fallback
router.get("/public-media-kit/:token", async (req, res) => {
  try {
    const token = req.params.token;

    // Try share_token first
    let org = await db.query.organizations.findFirst({
      where: eq(organizations.shareToken, token),
    });

    // Fallback: try as organization id
    if (!org) {
      org = await db.query.organizations.findFirst({
        where: eq(organizations.id, token),
      });
    }

    if (!org) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }

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
        clerkOrganizationId: org.clerkOrganizationId,
      },
      mediaKit: kit ?? null,
    });
  } catch (err) {
    console.error("GET /public-media-kit/:token error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /email-data/press-kit/:clerkOrgId
router.get("/email-data/press-kit/:clerkOrgId", async (req, res) => {
  try {
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.clerkOrganizationId, req.params.clerkOrgId),
    });

    if (!org) {
      res.json({
        companyName: null,
        status: null,
        title: null,
        pressKitUrl: null,
        content: null,
        contentType: null,
      });
      return;
    }

    const kit = await db.query.mediaKits.findFirst({
      where: and(
        eq(mediaKits.organizationId, org.id),
        inArray(mediaKits.status, ["validated", "drafted"])
      ),
      orderBy: desc(mediaKits.updatedAt),
    });

    const pressKitUrl = org.shareToken ? `/public/${org.shareToken}` : null;

    res.json({
      companyName: org.name,
      status: kit?.status ?? null,
      title: kit?.title ?? null,
      pressKitUrl,
      content: kit?.mdxPageContent ?? kit?.jsxPageContent ?? null,
      contentType: kit?.mdxPageContent ? "mdx" : kit?.jsxPageContent ? "jsx" : null,
    });
  } catch (err) {
    console.error("GET /email-data/press-kit error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
