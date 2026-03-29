import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp } from "../helpers/test-app.js";
import { cleanTestData, insertTestMediaKit, closeDb } from "../helpers/test-db.js";
import { db } from "../../src/db/index.js";
import { mediaKitViews } from "../../src/db/schema.js";
import { eq } from "drizzle-orm";

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

    it("tracks a view on successful access", async () => {
      const kit = await insertTestMediaKit({
        orgId: "org_pub_views",
        status: "validated",
      });

      await request(app).get(`/public/${kit.shareToken}`);

      // Give the fire-and-forget insert a moment to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      const views = await db
        .select()
        .from(mediaKitViews)
        .where(eq(mediaKitViews.mediaKitId, kit.id));

      expect(views).toHaveLength(1);
      expect(views[0].mediaKitId).toBe(kit.id);
    });

    it("returns 404 for unknown token", async () => {
      const res = await request(app).get("/public/00000000-0000-0000-0000-000000000000");
      expect(res.status).toBe(404);
    });

    it("returns 400 for non-UUID token", async () => {
      const res = await request(app).get("/public/.env.staging");
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid token format");
    });

    it("does not require auth", async () => {
      const kit = await insertTestMediaKit({ orgId: "org_pub_3", status: "drafted" });
      const res = await request(app).get(`/public/${kit.shareToken}`);
      expect(res.status).toBe(200);
    });
  });
});
