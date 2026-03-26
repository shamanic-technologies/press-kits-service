import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp } from "../helpers/test-app.js";
import { cleanTestData, insertTestMediaKit, closeDb } from "../helpers/test-db.js";

const app = createTestApp();

describe("Public", () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  describe("GET /public/:token", () => {
    it("returns media kit by share token", async () => {
      const kit = await insertTestMediaKit({
        orgId: "org_pub",
        title: "Public Kit",
        mdxPageContent: "# Hello",
        status: "validated",
      });

      const res = await request(app).get(`/public/${kit.shareToken}`);

      expect(res.status).toBe(200);
      expect(res.body.mediaKit.id).toBe(kit.id);
      expect(res.body.mediaKit.title).toBe("Public Kit");
    });

    it("returns 404 for unknown token", async () => {
      const res = await request(app).get("/public/00000000-0000-0000-0000-000000000000");
      expect(res.status).toBe(404);
    });

    it("does not require auth", async () => {
      const kit = await insertTestMediaKit({ orgId: "org_pub_3", status: "drafted" });
      const res = await request(app).get(`/public/${kit.shareToken}`);
      expect(res.status).toBe(200);
    });
  });
});
