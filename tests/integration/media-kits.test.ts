import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import { createTestApp, getAuthHeaders } from "../helpers/test-app.js";
import {
  cleanTestData,
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
      await insertTestMediaKit({ orgId: "org_1", title: "Kit 1", status: "validated" });
      await insertTestMediaKit({ orgId: "org_1", title: "Kit 2", status: "drafted" });

      const res = await request(app).get("/media-kits?org_id=org_1").set(headers);

      expect(res.status).toBe(200);
      expect(res.body.mediaKits).toHaveLength(2);
      expect(res.body.mediaKits[0].status).toBe("validated");
      expect(res.body.mediaKits[1].status).toBe("drafted");
    });

    it("excludes archived and denied kits", async () => {
      await insertTestMediaKit({ orgId: "org_2", status: "archived" });
      await insertTestMediaKit({ orgId: "org_2", status: "denied" });
      await insertTestMediaKit({ orgId: "org_2", status: "drafted" });

      const res = await request(app).get("/media-kits?org_id=org_2").set(headers);

      expect(res.status).toBe(200);
      expect(res.body.mediaKits).toHaveLength(1);
      expect(res.body.mediaKits[0].status).toBe("drafted");
    });

    it("filters by campaign_id", async () => {
      await insertTestMediaKit({ orgId: "org_c", status: "validated", campaignId: "camp-123" });
      await insertTestMediaKit({ orgId: "org_c", status: "validated", campaignId: "camp-456" });

      const res = await request(app).get("/media-kits?campaign_id=camp-123").set(headers);

      expect(res.status).toBe(200);
      expect(res.body.mediaKits).toHaveLength(1);
      expect(res.body.mediaKits[0].campaignId).toBe("camp-123");
    });

    it("requires at least one filter", async () => {
      const res = await request(app).get("/media-kits").set(headers);
      expect(res.status).toBe(400);
    });
  });

  describe("GET /media-kits/:id", () => {
    it("returns kit by id", async () => {
      const kit = await insertTestMediaKit({ orgId: "org_3", title: "My Kit", status: "drafted" });
      const res = await request(app).get(`/media-kits/${kit.id}`).set(headers);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(kit.id);
      expect(res.body.title).toBe("My Kit");
      expect(res.body.shareToken).toBeDefined();
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
      const kit = await insertTestMediaKit({ orgId: "org_4", status: "drafted" });

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
      const kit = await insertTestMediaKit({ orgId: "org_5", status: "drafted" });

      const res = await request(app)
        .patch(`/media-kits/${kit.id}/status`)
        .set(headers)
        .send({ status: "denied", denialReason: "Needs more info" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("denied");
      expect(res.body.denialReason).toBe("Needs more info");
    });

    it("returns 404 for unknown kit", async () => {
      const res = await request(app)
        .patch("/media-kits/00000000-0000-0000-0000-000000000000/status")
        .set(headers)
        .send({ status: "denied" });
      expect(res.status).toBe(404);
    });
  });

  describe("POST /media-kits", () => {
    it("creates new kit with shareToken when no existing kit", async () => {
      const res = await request(app)
        .post("/media-kits")
        .set(headers)
        .send({ instruction: "Create my first press kit" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("generating");
      expect(res.body.orgId).toBe("test-org-id");
      expect(res.body.shareToken).toBeDefined();
      expect(res.body.parentMediaKitId).toBeNull();
    });

    it("creates generating copy from validated kit", async () => {
      const kit = await insertTestMediaKit({
        orgId: "org_6",
        title: "Validated Kit",
        mdxPageContent: "# Content",
        status: "validated",
      });

      const res = await request(app)
        .post("/media-kits")
        .set({ ...headers, "x-org-id": "org_6" })
        .send({ mediaKitId: kit.id, instruction: "Add more details" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("generating");
      expect(res.body.parentMediaKitId).toBe(kit.id);
      expect(res.body.mdxPageContent).toBe("# Content");
    });

    it("reuses existing generating kit within same scope", async () => {
      const kit = await insertTestMediaKit({ orgId: "test-org-id", status: "generating" });

      const res = await request(app)
        .post("/media-kits")
        .set(headers)
        .send({ instruction: "Try again" });

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(kit.id);
    });

    it("scopes kit lookup by org + brand + campaign", async () => {
      // Kit in brand-1/camp-1
      await insertTestMediaKit({
        orgId: "test-org-id",
        brandId: "brand-1",
        campaignId: "camp-1",
        status: "validated",
        title: "Brand 1 Kit",
      });
      // Kit in brand-2/camp-2
      await insertTestMediaKit({
        orgId: "test-org-id",
        brandId: "brand-2",
        campaignId: "camp-2",
        status: "validated",
        title: "Brand 2 Kit",
      });

      // Create for brand-1/camp-1 should base off Brand 1 Kit
      const res = await request(app)
        .post("/media-kits")
        .set({
          ...headers,
          "x-brand-id": "brand-1",
          "x-campaign-id": "camp-1",
        })
        .send({ instruction: "Improve this" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("generating");
      expect(res.body.brandId).toBe("brand-1");
      expect(res.body.campaignId).toBe("camp-1");
      expect(res.body.mdxPageContent).toBeNull(); // new kit created from "validated" copies content
      // Actually with the scope fix, it should find Brand 1 Kit and copy from it
    });

    it("creates fresh kit for new brand+campaign scope", async () => {
      // Existing kit in different scope
      await insertTestMediaKit({
        orgId: "test-org-id",
        brandId: "brand-1",
        campaignId: "camp-1",
        status: "validated",
      });

      // New scope — should NOT find the existing kit
      const res = await request(app)
        .post("/media-kits")
        .set({
          ...headers,
          "x-brand-id": "brand-new",
          "x-campaign-id": "camp-new",
        })
        .send({ instruction: "Brand new kit" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("generating");
      expect(res.body.parentMediaKitId).toBeNull();
      expect(res.body.brandId).toBe("brand-new");
      expect(res.body.campaignId).toBe("camp-new");
    });

    it("stores context headers on new kit", async () => {
      const res = await request(app)
        .post("/media-kits")
        .set({
          ...headers,
          "x-org-id": "org_ctx",
          "x-feature-slug": "press-kit-v2",
          "x-brand-id": "brand-123",
          "x-campaign-id": "camp-789",
        })
        .send({ instruction: "Create kit with context" });

      expect(res.status).toBe(200);
      expect(res.body.featureSlug).toBe("press-kit-v2");
      expect(res.body.brandId).toBe("brand-123");
      expect(res.body.campaignId).toBe("camp-789");
    });

    it("passes x-run-id as parentRunId to createRun", async () => {
      const { createRun } = await import("../../src/lib/runs-client.js");

      await request(app)
        .post("/media-kits")
        .set({ ...headers, "x-run-id": "00000000-0000-0000-0000-000000000001" })
        .send({ instruction: "Test run tracking" });

      expect(createRun).toHaveBeenCalledWith(
        expect.objectContaining({
          parentRunId: "00000000-0000-0000-0000-000000000001",
        })
      );
    });
  });

  describe("POST /media-kits/:id/validate", () => {
    it("validates kit and archives previous within same campaign", async () => {
      const old = await insertTestMediaKit({
        orgId: "org_8",
        status: "validated",
        campaignId: "camp-v",
      });
      const draft = await insertTestMediaKit({
        orgId: "org_8",
        status: "drafted",
        campaignId: "camp-v",
      });

      const res = await request(app)
        .post(`/media-kits/${draft.id}/validate`)
        .set(headers)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("validated");

      const oldRes = await request(app).get(`/media-kits/${old.id}`).set(headers);
      expect(oldRes.body.status).toBe("archived");
    });

    it("does not archive validated kits from different campaign", async () => {
      const otherCampaignKit = await insertTestMediaKit({
        orgId: "org_8b",
        status: "validated",
        campaignId: "camp-other",
      });
      const draft = await insertTestMediaKit({
        orgId: "org_8b",
        status: "drafted",
        campaignId: "camp-v",
      });

      const res = await request(app)
        .post(`/media-kits/${draft.id}/validate`)
        .set(headers)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("validated");

      const otherRes = await request(app).get(`/media-kits/${otherCampaignKit.id}`).set(headers);
      expect(otherRes.body.status).toBe("validated");
    });

    it("returns 404 for unknown kit", async () => {
      const res = await request(app)
        .post("/media-kits/00000000-0000-0000-0000-000000000000/validate")
        .set(headers)
        .send({});
      expect(res.status).toBe(404);
    });
  });

  describe("POST /media-kits/:id/cancel", () => {
    it("cancels draft and restores parent", async () => {
      const parent = await insertTestMediaKit({
        orgId: "org_9",
        status: "archived",
        title: "Parent Kit",
      });
      const draft = await insertTestMediaKit({
        orgId: "org_9",
        status: "drafted",
        parentMediaKitId: parent.id,
      });

      const res = await request(app)
        .post(`/media-kits/${draft.id}/cancel`)
        .set(headers)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const parentRes = await request(app).get(`/media-kits/${parent.id}`).set(headers);
      expect(parentRes.body.status).toBe("drafted");

      // Draft should be deleted
      const draftRes = await request(app).get(`/media-kits/${draft.id}`).set(headers);
      expect(draftRes.status).toBe(404);
    });

    it("returns 404 for unknown kit", async () => {
      const res = await request(app)
        .post("/media-kits/00000000-0000-0000-0000-000000000000/cancel")
        .set(headers)
        .send({});
      expect(res.status).toBe(404);
    });
  });
});
