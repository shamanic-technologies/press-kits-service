import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, getAuthHeaders } from "../helpers/test-app.js";
import {
  cleanTestData,
  insertTestMediaKit,
  insertTestInstruction,
  closeDb,
} from "../helpers/test-db.js";

const app = createTestApp();
const headers = getAuthHeaders();

describe("Internal", () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  describe("GET /internal/media-kits/current", () => {
    it("returns latest kit for org", async () => {
      await insertTestMediaKit({
        orgId: "test-org-id",
        title: "Latest Kit",
        status: "validated",
      });

      const res = await request(app)
        .get("/internal/media-kits/current")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.title).toBe("Latest Kit");
    });

    it("returns null when no kits exist", async () => {
      const res = await request(app)
        .get("/internal/media-kits/current")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body).toBeNull();
    });
  });

  describe("GET /internal/media-kits/generation-data", () => {
    it("returns generating kit with instructions and feedbacks", async () => {
      const kit = await insertTestMediaKit({
        orgId: "test-org-id",
        status: "generating",
      });

      await insertTestInstruction({
        mediaKitId: kit.id,
        instruction: "Make it professional",
        instructionType: "initial",
      });

      const denied = await insertTestMediaKit({
        orgId: "test-org-id",
        status: "denied",
        denialReason: "Too informal",
      });

      const res = await request(app)
        .get("/internal/media-kits/generation-data")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.currentKit).toBeDefined();
      expect(res.body.currentKit.id).toBe(kit.id);
      expect(res.body.instructions).toHaveLength(1);
      expect(res.body.instructions[0].instruction).toBe("Make it professional");
      expect(res.body.feedbacks).toHaveLength(1);
      expect(res.body.feedbacks[0].denialReason).toBe("Too informal");
    });
  });

  describe("POST /internal/media-kits/generation-result", () => {
    it("upserts generating kit to drafted with content", async () => {
      await insertTestMediaKit({
        orgId: "test-org-id",
        status: "generating",
      });

      const res = await request(app)
        .post("/internal/media-kits/generation-result")
        .set(headers)
        .send({
          mdxContent: "# Generated Content",
          title: "My Press Kit",
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("drafted");
      expect(res.body.mdx_page_content).toBe("# Generated Content");
      expect(res.body.title).toBe("My Press Kit");
    });

    it("returns 404 when no generating kit exists", async () => {
      const res = await request(app)
        .post("/internal/media-kits/generation-result")
        .set(headers)
        .send({ mdxContent: "# Content" });

      expect(res.status).toBe(404);
    });
  });

  describe("GET /internal/media-kits/stale", () => {
    it("returns stale kits", async () => {
      // This test just verifies the endpoint works
      const res = await request(app)
        .get("/internal/media-kits/stale")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.mediaKits).toBeDefined();
    });
  });

  describe("GET /internal/media-kits/setup", () => {
    it("returns setup status per org", async () => {
      await insertTestMediaKit({ orgId: "org_setup_1", status: "validated" });
      await insertTestMediaKit({ orgId: "org_setup_2", status: "generating" });

      const res = await request(app)
        .get("/internal/media-kits/setup")
        .set(headers);

      expect(res.status).toBe(200);
      const orgs = res.body.organizations;
      expect(orgs.length).toBeGreaterThanOrEqual(2);

      const org1 = orgs.find((o: { orgId: string }) => o.orgId === "org_setup_1");
      expect(org1).toBeDefined();
      expect(org1.isSetup).toBe(true);

      const org2 = orgs.find((o: { orgId: string }) => o.orgId === "org_setup_2");
      expect(org2).toBeDefined();
      expect(org2.isSetup).toBe(false);
    });
  });

  describe("GET /internal/health/bulk", () => {
    it("returns health per org", async () => {
      await insertTestMediaKit({ orgId: "org_health", status: "validated" });
      await insertTestMediaKit({ orgId: "org_health", status: "drafted" });

      const res = await request(app)
        .get("/internal/health/bulk")
        .set(headers);

      expect(res.status).toBe(200);
      const org = res.body.organizations.find((o: { orgId: string }) => o.orgId === "org_health");
      expect(org).toBeDefined();
      expect(org.hasValidated).toBe(true);
      expect(org.hasDrafted).toBe(true);
      expect(org.totalKits).toBe(2);
    });
  });

  describe("GET /internal/email-data/:orgId", () => {
    it("returns email data with press kit URL", async () => {
      const kit = await insertTestMediaKit({
        orgId: "org_email",
        title: "Email Kit",
        mdxPageContent: "# Content",
        status: "validated",
      });

      const res = await request(app)
        .get("/internal/email-data/org_email")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.title).toBe("Email Kit");
      expect(res.body.pressKitUrl).toBe(`/public/${kit.shareToken}`);
      expect(res.body.content).toBe("# Content");
    });

    it("returns nulls when no kit exists", async () => {
      const res = await request(app)
        .get("/internal/email-data/org_none")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.status).toBeNull();
      expect(res.body.title).toBeNull();
    });
  });
});
