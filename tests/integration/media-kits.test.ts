import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import { createTestApp, getAuthHeaders } from "../helpers/test-app.js";
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

  describe("GET /media-kit", () => {
    it("lists kits by clerk_organization_id", async () => {
      const org = await insertTestOrganization({ clerkOrganizationId: "org_1" });
      await insertTestMediaKit({
        clerkOrganizationId: "org_1",
        organizationId: org.id,
        title: "Kit 1",
        status: "validated",
      });
      await insertTestMediaKit({
        clerkOrganizationId: "org_1",
        organizationId: org.id,
        title: "Kit 2",
        status: "drafted",
      });

      const res = await request(app)
        .get("/media-kit?clerk_organization_id=org_1")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.mediaKits).toHaveLength(2);
      // validated should be first (priority ordering)
      expect(res.body.mediaKits[0].status).toBe("validated");
      expect(res.body.mediaKits[1].status).toBe("drafted");
    });

    it("excludes archived and denied kits", async () => {
      const org = await insertTestOrganization({ clerkOrganizationId: "org_2" });
      await insertTestMediaKit({
        clerkOrganizationId: "org_2",
        organizationId: org.id,
        status: "archived",
      });
      await insertTestMediaKit({
        clerkOrganizationId: "org_2",
        organizationId: org.id,
        status: "denied",
      });
      await insertTestMediaKit({
        clerkOrganizationId: "org_2",
        organizationId: org.id,
        status: "drafted",
      });

      const res = await request(app)
        .get("/media-kit?clerk_organization_id=org_2")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.mediaKits).toHaveLength(1);
      expect(res.body.mediaKits[0].status).toBe("drafted");
    });

    it("requires organization filter", async () => {
      const res = await request(app).get("/media-kit").set(headers);

      expect(res.status).toBe(400);
    });
  });

  describe("GET /media-kit/:id", () => {
    it("returns kit by id", async () => {
      const org = await insertTestOrganization({ clerkOrganizationId: "org_3" });
      const kit = await insertTestMediaKit({
        clerkOrganizationId: "org_3",
        organizationId: org.id,
        title: "My Kit",
        status: "drafted",
      });

      const res = await request(app).get(`/media-kit/${kit.id}`).set(headers);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(kit.id);
      expect(res.body.title).toBe("My Kit");
    });

    it("returns 404 for unknown id", async () => {
      const res = await request(app)
        .get("/media-kit/00000000-0000-0000-0000-000000000000")
        .set(headers);

      expect(res.status).toBe(404);
    });
  });

  describe("POST /update-mdx", () => {
    it("updates mdx content", async () => {
      const org = await insertTestOrganization({ clerkOrganizationId: "org_4" });
      const kit = await insertTestMediaKit({
        clerkOrganizationId: "org_4",
        organizationId: org.id,
        status: "drafted",
      });

      const res = await request(app)
        .post("/update-mdx")
        .set(headers)
        .send({ mediaKitId: kit.id, mdxContent: "# New Content" });

      expect(res.status).toBe(200);
      expect(res.body.mdxPageContent).toBe("# New Content");
    });
  });

  describe("POST /update-status", () => {
    it("updates status to denied with reason", async () => {
      const org = await insertTestOrganization({ clerkOrganizationId: "org_5" });
      const kit = await insertTestMediaKit({
        clerkOrganizationId: "org_5",
        organizationId: org.id,
        status: "drafted",
      });

      const res = await request(app)
        .post("/update-status")
        .set(headers)
        .send({
          mediaKitId: kit.id,
          status: "denied",
          denialReason: "Needs more info",
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("denied");
      expect(res.body.denial_reason).toBe("Needs more info");
    });
  });

  describe("POST /edit-media-kit", () => {
    it("creates generating copy from validated kit", async () => {
      const org = await insertTestOrganization({ clerkOrganizationId: "org_6" });
      const kit = await insertTestMediaKit({
        clerkOrganizationId: "org_6",
        organizationId: org.id,
        title: "Validated Kit",
        mdxPageContent: "# Content",
        status: "validated",
      });

      const res = await request(app)
        .post("/edit-media-kit")
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

    it("updates timestamp for already generating kit", async () => {
      const org = await insertTestOrganization({ clerkOrganizationId: "org_7" });
      const kit = await insertTestMediaKit({
        clerkOrganizationId: "org_7",
        organizationId: org.id,
        status: "generating",
      });

      const res = await request(app)
        .post("/edit-media-kit")
        .set(headers)
        .send({ mediaKitId: kit.id, instruction: "Try again" });

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(kit.id);
      expect(res.body.status).toBe("generating");
    });
  });

  describe("POST /validate", () => {
    it("validates kit and archives previous", async () => {
      const org = await insertTestOrganization({ clerkOrganizationId: "org_8" });
      const validatedKit = await insertTestMediaKit({
        clerkOrganizationId: "org_8",
        organizationId: org.id,
        status: "validated",
        title: "Old Kit",
      });
      const draftedKit = await insertTestMediaKit({
        clerkOrganizationId: "org_8",
        organizationId: org.id,
        status: "drafted",
        title: "New Kit",
      });

      const res = await request(app)
        .post("/validate")
        .set(headers)
        .send({ mediaKitId: draftedKit.id });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("validated");

      // Check old kit is archived
      const oldKitRes = await request(app)
        .get(`/media-kit/${validatedKit.id}`)
        .set(headers);

      expect(oldKitRes.body.status).toBe("archived");
    });
  });

  describe("POST /cancel-draft", () => {
    it("cancels draft and restores parent", async () => {
      const org = await insertTestOrganization({ clerkOrganizationId: "org_9" });
      const parent = await insertTestMediaKit({
        clerkOrganizationId: "org_9",
        organizationId: org.id,
        status: "archived",
        title: "Parent Kit",
      });
      await insertTestMediaKit({
        clerkOrganizationId: "org_9",
        organizationId: org.id,
        status: "drafted",
        title: "Draft Kit",
        parentMediaKitId: parent.id,
      });

      const draft = await insertTestMediaKit({
        clerkOrganizationId: "org_9",
        organizationId: org.id,
        status: "drafted",
        title: "New Draft",
        parentMediaKitId: parent.id,
      });

      const res = await request(app)
        .post("/cancel-draft")
        .set(headers)
        .send({ mediaKitId: draft.id });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Parent should be restored to drafted
      const parentRes = await request(app)
        .get(`/media-kit/${parent.id}`)
        .set(headers);

      expect(parentRes.body.status).toBe("drafted");
    });
  });
});
