import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, getAuthHeaders } from "../helpers/test-app.js";
import {
  cleanTestData,
  insertTestOrganization,
  insertTestMediaKit,
  closeDb,
} from "../helpers/test-db.js";

const app = createTestApp();
const headers = getAuthHeaders();

describe("Admin Endpoints", () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  describe("GET /admin/organizations", () => {
    it("lists orgs with kit counts", async () => {
      const org = await insertTestOrganization({
        orgId: "org_admin_1",
        name: "Admin Org",
      });
      await insertTestMediaKit({
        orgId: "org_admin_1",
        organizationId: org.id,
        status: "drafted",
      });
      await insertTestMediaKit({
        orgId: "org_admin_1",
        organizationId: org.id,
        status: "validated",
      });

      const res = await request(app)
        .get("/admin/organizations")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.organizations).toHaveLength(1);
      expect(res.body.organizations[0].name).toBe("Admin Org");
      expect(res.body.organizations[0].mediaKitCount).toBe(2);
    });

    it("supports search filter", async () => {
      await insertTestOrganization({ orgId: "org_a", name: "Alpha Corp" });
      await insertTestOrganization({ orgId: "org_b", name: "Beta Inc" });

      const res = await request(app)
        .get("/admin/organizations?search=Alpha")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.organizations).toHaveLength(1);
      expect(res.body.organizations[0].name).toBe("Alpha Corp");
    });
  });

  describe("DELETE /admin/organizations/:id", () => {
    it("deletes org with correct confirmName", async () => {
      const org = await insertTestOrganization({
        orgId: "org_del_1",
        name: "Delete Me",
      });

      const res = await request(app)
        .delete(`/admin/organizations/${org.id}?confirmName=Delete Me`)
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify deleted
      const checkRes = await request(app)
        .get("/admin/organizations")
        .set(headers);

      expect(checkRes.body.organizations).toHaveLength(0);
    });

    it("rejects with wrong confirmName", async () => {
      const org = await insertTestOrganization({
        orgId: "org_del_2",
        name: "My Org",
      });

      const res = await request(app)
        .delete(`/admin/organizations/${org.id}?confirmName=Wrong Name`)
        .set(headers);

      expect(res.status).toBe(400);
    });

    it("requires confirmName param", async () => {
      const org = await insertTestOrganization({ orgId: "org_del_3", name: "Org" });

      const res = await request(app)
        .delete(`/admin/organizations/${org.id}`)
        .set(headers);

      expect(res.status).toBe(400);
    });
  });
});
