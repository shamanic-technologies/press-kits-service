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

    it("filters by brand_id and campaign_id query params", async () => {
      await insertTestMediaKit({
        orgId: "test-org-id",
        brandId: "brand-1",
        campaignId: "camp-1",
        title: "Scoped Kit",
        status: "validated",
      });
      await insertTestMediaKit({
        orgId: "test-org-id",
        brandId: "brand-2",
        title: "Other Kit",
        status: "validated",
      });

      const res = await request(app)
        .get("/internal/media-kits/current?brand_id=brand-1&campaign_id=camp-1")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.title).toBe("Scoped Kit");
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

      await insertTestMediaKit({
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

    it("accepts media_kit_id query param", async () => {
      const kit = await insertTestMediaKit({
        orgId: "test-org-id",
        status: "generating",
      });

      await insertTestInstruction({
        mediaKitId: kit.id,
        instruction: "Targeted instruction",
        instructionType: "initial",
      });

      const res = await request(app)
        .get(`/internal/media-kits/generation-data?media_kit_id=${kit.id}`)
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.currentKit.id).toBe(kit.id);
      expect(res.body.instructions).toHaveLength(1);
    });
  });

  describe("POST /internal/media-kits/generation-result", () => {
    it("upserts generating kit to drafted with content", async () => {
      const kit = await insertTestMediaKit({
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
      expect(res.body.mdxPageContent).toBe("# Generated Content");
      expect(res.body.title).toBe("My Press Kit");
    });

    it("accepts mediaKitId to target specific kit", async () => {
      const kit = await insertTestMediaKit({
        orgId: "test-org-id",
        status: "generating",
      });

      const res = await request(app)
        .post("/internal/media-kits/generation-result")
        .set(headers)
        .send({
          mediaKitId: kit.id,
          mdxContent: "# Targeted Content",
        });

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(kit.id);
      expect(res.body.status).toBe("drafted");
    });

    it("returns 404 when no generating kit exists", async () => {
      const res = await request(app)
        .post("/internal/media-kits/generation-result")
        .set(headers)
        .send({ mdxContent: "# Content" });

      expect(res.status).toBe(404);
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
      expect(res.body.pressKitUrl).toBe(`https://press-kits.distribute.you/public/${kit.shareToken}`);
      expect(res.body.content).toBe("# Content");
    });

    it("uses PRESS_KITS_SERVICE_URL env var for press kit URL", async () => {
      process.env.PRESS_KITS_SERVICE_URL = "https://custom.example.com";
      const kit = await insertTestMediaKit({
        orgId: "org_custom_url",
        title: "Custom URL Kit",
        mdxPageContent: "# Content",
        status: "validated",
      });

      const res = await request(app)
        .get("/internal/email-data/org_custom_url")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.pressKitUrl).toBe(`https://custom.example.com/public/${kit.shareToken}`);
      delete process.env.PRESS_KITS_SERVICE_URL;
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
