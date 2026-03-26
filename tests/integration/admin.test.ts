import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, getAuthHeaders } from "../helpers/test-app.js";
import { cleanTestData, insertTestMediaKit, closeDb } from "../helpers/test-db.js";

const app = createTestApp();
const headers = getAuthHeaders();

describe("Admin", () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  describe("GET /admin/media-kits", () => {
    it("lists all media kits", async () => {
      await insertTestMediaKit({ orgId: "org_a", title: "Kit A", status: "validated" });
      await insertTestMediaKit({ orgId: "org_b", title: "Kit B", status: "drafted" });

      const res = await request(app).get("/admin/media-kits").set(headers);

      expect(res.status).toBe(200);
      expect(res.body.mediaKits).toHaveLength(2);
    });

    it("filters by title search", async () => {
      await insertTestMediaKit({ orgId: "org_a", title: "Alpha Corp Kit", status: "validated" });
      await insertTestMediaKit({ orgId: "org_b", title: "Beta Inc Kit", status: "drafted" });

      const res = await request(app).get("/admin/media-kits?search=Alpha").set(headers);

      expect(res.status).toBe(200);
      expect(res.body.mediaKits).toHaveLength(1);
      expect(res.body.mediaKits[0].title).toBe("Alpha Corp Kit");
    });
  });

  describe("DELETE /admin/media-kits/:id", () => {
    it("deletes a media kit", async () => {
      const kit = await insertTestMediaKit({ orgId: "org_del", title: "To Delete", status: "drafted" });

      const res = await request(app).delete(`/admin/media-kits/${kit.id}`).set(headers);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const check = await request(app).get(`/media-kits/${kit.id}`).set(headers);
      expect(check.status).toBe(404);
    });

    it("returns 404 for unknown kit", async () => {
      const res = await request(app)
        .delete("/admin/media-kits/00000000-0000-0000-0000-000000000000")
        .set(headers);
      expect(res.status).toBe(404);
    });
  });
});
