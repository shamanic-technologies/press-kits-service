import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import { createTestApp, getAuthHeaders } from "../helpers/test-app.js";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/index.js";
import { organizations } from "../../src/db/schema.js";
import {
  cleanTestData,
  insertTestOrganization,
  insertTestMediaKit,
  closeDb,
} from "../helpers/test-db.js";

// Mock external clients
vi.mock("../../src/lib/runs-client.js", () => ({
  createRun: vi.fn().mockResolvedValue({ id: "run-123" }),
  updateRunStatus: vi.fn().mockResolvedValue(undefined),
  addCosts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/lib/windmill-client.js", () => ({
  deployWorkflows: vi.fn().mockResolvedValue(undefined),
  executeWorkflowByName: vi.fn().mockResolvedValue({ workflowRunId: "wf-123" }),
}));

vi.mock("../../src/lib/email-client.js", () => ({
  deployTemplates: vi.fn().mockResolvedValue(undefined),
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/lib/brand-client.js", () => ({
  getBrandDomain: vi.fn().mockResolvedValue("example.com"),
}));


const app = createTestApp();
const headers = getAuthHeaders();

describe("Media Kits", () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  describe("GET /media-kits", () => {
    it("lists kits by org_id", async () => {
      const org = await insertTestOrganization({ orgId: "org_1" });
      await insertTestMediaKit({
        orgId: "org_1",
        organizationId: org.id,
        title: "Kit 1",
        status: "validated",
      });
      await insertTestMediaKit({
        orgId: "org_1",
        organizationId: org.id,
        title: "Kit 2",
        status: "drafted",
      });

      const res = await request(app)
        .get("/media-kits?org_id=org_1")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.mediaKits).toHaveLength(2);
      // validated should be first (priority ordering)
      expect(res.body.mediaKits[0].status).toBe("validated");
      expect(res.body.mediaKits[1].status).toBe("drafted");
    });

    it("excludes archived and denied kits", async () => {
      const org = await insertTestOrganization({ orgId: "org_2" });
      await insertTestMediaKit({
        orgId: "org_2",
        organizationId: org.id,
        status: "archived",
      });
      await insertTestMediaKit({
        orgId: "org_2",
        organizationId: org.id,
        status: "denied",
      });
      await insertTestMediaKit({
        orgId: "org_2",
        organizationId: org.id,
        status: "drafted",
      });

      const res = await request(app)
        .get("/media-kits?org_id=org_2")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.mediaKits).toHaveLength(1);
      expect(res.body.mediaKits[0].status).toBe("drafted");
    });

    it("filters by campaign_id", async () => {
      const org = await insertTestOrganization({ orgId: "org_campaign" });
      await insertTestMediaKit({
        orgId: "org_campaign",
        organizationId: org.id,
        title: "Campaign Kit",
        status: "validated",
        campaignId: "camp-123",
      });
      await insertTestMediaKit({
        orgId: "org_campaign",
        organizationId: org.id,
        title: "Other Kit",
        status: "validated",
        campaignId: "camp-456",
      });

      const res = await request(app)
        .get("/media-kits?campaign_id=camp-123")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.mediaKits).toHaveLength(1);
      expect(res.body.mediaKits[0].campaignId).toBe("camp-123");
    });

    it("allows campaign_id as sole filter (no org_id needed)", async () => {
      const org = await insertTestOrganization({ orgId: "org_campaign_solo" });
      await insertTestMediaKit({
        orgId: "org_campaign_solo",
        organizationId: org.id,
        status: "drafted",
        campaignId: "camp-solo",
      });

      const res = await request(app)
        .get("/media-kits?campaign_id=camp-solo")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.mediaKits).toHaveLength(1);
    });

    it("requires at least one filter", async () => {
      const res = await request(app).get("/media-kits").set(headers);

      expect(res.status).toBe(400);
    });
  });

  describe("GET /media-kits/:id", () => {
    it("returns kit by id", async () => {
      const org = await insertTestOrganization({ orgId: "org_3" });
      const kit = await insertTestMediaKit({
        orgId: "org_3",
        organizationId: org.id,
        title: "My Kit",
        status: "drafted",
      });

      const res = await request(app).get(`/media-kits/${kit.id}`).set(headers);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(kit.id);
      expect(res.body.title).toBe("My Kit");
    });

    it("returns 404 for unknown id", async () => {
      const res = await request(app)
        .get("/media-kits/00000000-0000-0000-0000-000000000000")
        .set(headers);

      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /media-kits/:id/mdx", () => {
    it("updates mdx content", async () => {
      const org = await insertTestOrganization({ orgId: "org_4" });
      const kit = await insertTestMediaKit({
        orgId: "org_4",
        organizationId: org.id,
        status: "drafted",
      });

      const res = await request(app)
        .patch(`/media-kits/${kit.id}/mdx`)
        .set(headers)
        .send({ mdxContent: "# New Content" });

      expect(res.status).toBe(200);
      expect(res.body.mdxPageContent).toBe("# New Content");
    });
  });

  describe("PATCH /media-kits/:id/status", () => {
    it("updates status to denied with reason", async () => {
      const org = await insertTestOrganization({ orgId: "org_5" });
      const kit = await insertTestMediaKit({
        orgId: "org_5",
        organizationId: org.id,
        status: "drafted",
      });

      const res = await request(app)
        .patch(`/media-kits/${kit.id}/status`)
        .set(headers)
        .send({
          status: "denied",
          denialReason: "Needs more info",
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("denied");
      expect(res.body.denial_reason).toBe("Needs more info");
    });
  });

  describe("POST /media-kits", () => {
    it("creates generating copy from validated kit", async () => {
      const org = await insertTestOrganization({ orgId: "org_6" });
      const kit = await insertTestMediaKit({
        orgId: "org_6",
        organizationId: org.id,
        title: "Validated Kit",
        mdxPageContent: "# Content",
        status: "validated",
      });

      const res = await request(app)
        .post("/media-kits")
        .set(headers)
        .send({
          mediaKitId: kit.id,
          instruction: "Add more details",
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("generating");
      expect(res.body.parentMediaKitId).toBe(kit.id);
      expect(res.body.mdxPageContent).toBe("# Content");
    });

    it("passes x-run-id header as parentRunId to createRun", async () => {
      const { createRun } = await import("../../src/lib/runs-client.js");
      const org = await insertTestOrganization({ orgId: "org_parent_run" });
      const kit = await insertTestMediaKit({
        orgId: "org_parent_run",
        organizationId: org.id,
        title: "Kit with parent run",
        status: "validated",
      });

      await request(app)
        .post("/media-kits")
        .set({
          ...headers,
          "x-run-id": "00000000-0000-0000-0000-000000000001",
        })
        .send({
          mediaKitId: kit.id,
          instruction: "Update content",
        });

      expect(createRun).toHaveBeenCalledWith(
        expect.objectContaining({
          parentRunId: "00000000-0000-0000-0000-000000000001",
          userId: "test-user-id",
        })
      );
    });

    it("creates new kit from scratch when org has no existing kit", async () => {
      await insertTestOrganization({ orgId: "test-org-id" });

      const res = await request(app)
        .post("/media-kits")
        .set(headers)
        .send({
          instruction: "Create my first press kit",
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("generating");
      expect(res.body.orgId).toBe("test-org-id");
      expect(res.body.parentMediaKitId).toBeNull();
    });

    it("auto-creates org with shareToken when org does not exist", async () => {
      const res = await request(app)
        .post("/media-kits")
        .set({ ...headers, "x-org-id": "org_auto_created" })
        .send({ instruction: "Build a press kit" });

      expect(res.status).toBe(200);
      expect(res.body.orgId).toBe("org_auto_created");
      expect(res.body.organizationId).toBeDefined();

      // Verify org was created with a shareToken
      const org = await db.query.organizations.findFirst({
        where: eq(organizations.orgId, "org_auto_created"),
      });
      expect(org).toBeDefined();
      expect(org!.shareToken).toBeDefined();
    });

    it("finds and edits latest validated kit via org header", async () => {
      const org = await insertTestOrganization({ orgId: "test-org-id" });
      const kit = await insertTestMediaKit({
        orgId: "test-org-id",
        organizationId: org.id,
        title: "Existing Kit",
        mdxPageContent: "# Old",
        status: "validated",
      });

      const res = await request(app)
        .post("/media-kits")
        .set(headers)
        .send({
          instruction: "Update it",
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("generating");
      expect(res.body.parentMediaKitId).toBe(kit.id);
      expect(res.body.mdxPageContent).toBe("# Old");
    });

    it("reuses existing generating kit via org header", async () => {
      const org = await insertTestOrganization({ orgId: "test-org-id" });
      const kit = await insertTestMediaKit({
        orgId: "test-org-id",
        organizationId: org.id,
        status: "generating",
      });

      const res = await request(app)
        .post("/media-kits")
        .set(headers)
        .send({
          instruction: "Try again",
        });

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(kit.id);
      expect(res.body.status).toBe("generating");
    });

    it("stores x-feature-slug header on new kit", async () => {
      await insertTestOrganization({ orgId: "org_feat" });

      const res = await request(app)
        .post("/media-kits")
        .set({
          ...headers,
          "x-org-id": "org_feat",
          "x-feature-slug": "press-kit-v2",
        })
        .send({ instruction: "Create kit with feature slug" });

      expect(res.status).toBe(200);
      expect(res.body.featureSlug).toBe("press-kit-v2");
    });

    it("updates timestamp for already generating kit", async () => {
      const org = await insertTestOrganization({ orgId: "org_7" });
      const kit = await insertTestMediaKit({
        orgId: "org_7",
        organizationId: org.id,
        status: "generating",
      });

      const res = await request(app)
        .post("/media-kits")
        .set(headers)
        .send({ mediaKitId: kit.id, instruction: "Try again" });

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(kit.id);
      expect(res.body.status).toBe("generating");
    });
  });

  describe("POST /media-kits/:id/validate", () => {
    it("validates kit and archives previous", async () => {
      const org = await insertTestOrganization({ orgId: "org_8" });
      const validatedKit = await insertTestMediaKit({
        orgId: "org_8",
        organizationId: org.id,
        status: "validated",
        title: "Old Kit",
      });
      const draftedKit = await insertTestMediaKit({
        orgId: "org_8",
        organizationId: org.id,
        status: "drafted",
        title: "New Kit",
      });

      const res = await request(app)
        .post(`/media-kits/${draftedKit.id}/validate`)
        .set(headers)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("validated");

      // Check old kit is archived
      const oldKitRes = await request(app)
        .get(`/media-kits/${validatedKit.id}`)
        .set(headers);

      expect(oldKitRes.body.status).toBe("archived");
    });
  });

  describe("POST /media-kits/:id/cancel", () => {
    it("cancels draft and restores parent", async () => {
      const org = await insertTestOrganization({ orgId: "org_9" });
      const parent = await insertTestMediaKit({
        orgId: "org_9",
        organizationId: org.id,
        status: "archived",
        title: "Parent Kit",
      });
      await insertTestMediaKit({
        orgId: "org_9",
        organizationId: org.id,
        status: "drafted",
        title: "Draft Kit",
        parentMediaKitId: parent.id,
      });

      const draft = await insertTestMediaKit({
        orgId: "org_9",
        organizationId: org.id,
        status: "drafted",
        title: "New Draft",
        parentMediaKitId: parent.id,
      });

      const res = await request(app)
        .post(`/media-kits/${draft.id}/cancel`)
        .set(headers)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Parent should be restored to drafted
      const parentRes = await request(app)
        .get(`/media-kits/${parent.id}`)
        .set(headers);

      expect(parentRes.body.status).toBe("drafted");
    });
  });
});
