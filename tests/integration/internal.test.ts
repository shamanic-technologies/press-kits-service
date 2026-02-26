import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, getAuthHeaders } from "../helpers/test-app.js";
import {
  cleanTestData,
  insertTestOrganization,
  insertTestMediaKit,
  insertTestInstruction,
  closeDb,
} from "../helpers/test-db.js";

const app = createTestApp();
const headers = getAuthHeaders();

describe("Internal Endpoints", () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  describe("GET /internal/media-kit/by-org/:orgId", () => {
    it("returns latest kit for org", async () => {
      const org = await insertTestOrganization({ orgId: "org_int_1" });
      await insertTestMediaKit({
        orgId: "org_int_1",
        organizationId: org.id,
        title: "Old Kit",
        status: "archived",
      });
      await insertTestMediaKit({
        orgId: "org_int_1",
        organizationId: org.id,
        title: "New Kit",
        status: "drafted",
      });

      const res = await request(app)
        .get("/internal/media-kit/by-org/org_int_1")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.title).toBe("New Kit");
    });

    it("returns null for org with no kits", async () => {
      const res = await request(app)
        .get("/internal/media-kit/by-org/org_none")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body).toBeNull();
    });
  });

  describe("GET /internal/generation-data", () => {
    it("returns kit, instructions, and feedbacks", async () => {
      const org = await insertTestOrganization({ orgId: "org_gen_1" });
      const kit = await insertTestMediaKit({
        orgId: "org_gen_1",
        organizationId: org.id,
        status: "generating",
        title: "Generating Kit",
      });
      await insertTestInstruction({
        mediaKitId: kit.id,
        instruction: "Make it better",
        instructionType: "edit",
      });
      await insertTestMediaKit({
        orgId: "org_gen_1",
        organizationId: org.id,
        status: "denied",
        denialReason: "Too short",
      });

      const res = await request(app)
        .get("/internal/generation-data?orgId=org_gen_1")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.currentKit).not.toBeNull();
      expect(res.body.currentKit.title).toBe("Generating Kit");
      expect(res.body.instructions).toHaveLength(1);
      expect(res.body.instructions[0].instruction).toBe("Make it better");
      expect(res.body.feedbacks).toHaveLength(1);
      expect(res.body.feedbacks[0].denialReason).toBe("Too short");
    });
  });

  describe("POST /internal/upsert-generation-result", () => {
    it("updates generating kit to drafted with content", async () => {
      const org = await insertTestOrganization({ orgId: "org_upsert_1" });
      await insertTestMediaKit({
        orgId: "org_upsert_1",
        organizationId: org.id,
        status: "generating",
      });

      const res = await request(app)
        .post("/internal/upsert-generation-result")
        .set(headers)
        .send({
          orgId: "org_upsert_1",
          mdxContent: "# Generated Content",
          title: "Generated Kit",
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("drafted");
      expect(res.body.mdx_page_content).toBe("# Generated Content");
      expect(res.body.title).toBe("Generated Kit");
    });
  });

  describe("GET /media-kit-setup", () => {
    it("returns setup status for all orgs", async () => {
      const org1 = await insertTestOrganization({ orgId: "org_setup_1" });
      await insertTestMediaKit({
        orgId: "org_setup_1",
        organizationId: org1.id,
        status: "validated",
      });

      const org2 = await insertTestOrganization({ orgId: "org_setup_2" });

      const res = await request(app)
        .get("/media-kit-setup")
        .set(headers);

      expect(res.status).toBe(200);
      const orgs = res.body.organizations;
      const setup1 = orgs.find((o: { orgId: string }) => o.orgId === "org_setup_1");
      const setup2 = orgs.find((o: { orgId: string }) => o.orgId === "org_setup_2");

      expect(setup1.hasKit).toBe(true);
      expect(setup1.isSetup).toBe(true);
      expect(setup2.hasKit).toBe(false);
      expect(setup2.isSetup).toBe(false);
    });
  });

  describe("GET /health/bulk", () => {
    it("returns health per org", async () => {
      const org = await insertTestOrganization({ orgId: "org_health_1" });
      await insertTestMediaKit({
        orgId: "org_health_1",
        organizationId: org.id,
        status: "validated",
      });
      await insertTestMediaKit({
        orgId: "org_health_1",
        organizationId: org.id,
        status: "drafted",
      });

      const res = await request(app)
        .get("/health/bulk")
        .set(headers);

      expect(res.status).toBe(200);
      const item = res.body.organizations.find(
        (o: { orgId: string }) => o.orgId === "org_health_1"
      );
      expect(item.hasValidated).toBe(true);
      expect(item.hasDrafted).toBe(true);
      expect(item.totalKits).toBe(2);
    });
  });
});
