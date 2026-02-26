import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, getAuthHeaders } from "../helpers/test-app.js";
import { cleanTestData, insertTestOrganization, closeDb } from "../helpers/test-db.js";

const app = createTestApp();
const headers = getAuthHeaders();

describe("Organizations", () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  describe("POST /organizations", () => {
    it("creates a new organization", async () => {
      const res = await request(app)
        .post("/organizations")
        .set(headers)
        .send({ orgId: "org_123", name: "Test Org" });

      expect(res.status).toBe(200);
      expect(res.body.orgId).toBe("org_123");
      expect(res.body.name).toBe("Test Org");
      expect(res.body.shareToken).toBeDefined();
      expect(res.body.id).toBeDefined();
    });

    it("upserts existing organization", async () => {
      await request(app)
        .post("/organizations")
        .set(headers)
        .send({ orgId: "org_123", name: "Old Name" });

      const res = await request(app)
        .post("/organizations")
        .set(headers)
        .send({ orgId: "org_123", name: "New Name" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("New Name");
    });

    it("requires auth", async () => {
      const res = await request(app)
        .post("/organizations")
        .send({ orgId: "org_123" });

      expect(res.status).toBe(401);
    });
  });

  describe("GET /organizations/share-token/:orgId", () => {
    it("returns share token", async () => {
      const org = await insertTestOrganization({ orgId: "org_456" });

      const res = await request(app)
        .get("/organizations/share-token/org_456")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.shareToken).toBe(org.shareToken);
    });

    it("returns 404 for unknown org", async () => {
      const res = await request(app)
        .get("/organizations/share-token/org_unknown")
        .set(headers);

      expect(res.status).toBe(404);
    });
  });

  describe("GET /organizations/exists", () => {
    it("batch checks existence", async () => {
      await insertTestOrganization({ orgId: "org_a" });

      const res = await request(app)
        .get("/organizations/exists?orgIds=org_a,org_b")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.organizations).toHaveLength(2);
      expect(res.body.organizations[0]).toEqual({ orgId: "org_a", exists: true });
      expect(res.body.organizations[1]).toEqual({ orgId: "org_b", exists: false });
    });

    it("returns 400 without query param", async () => {
      const res = await request(app)
        .get("/organizations/exists")
        .set(headers);

      expect(res.status).toBe(400);
    });
  });
});
