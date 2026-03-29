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
    it("returns rendered HTML page with kit content", async () => {
      const kit = await insertTestMediaKit({
        orgId: "org_pub",
        title: "Public Kit",
        mdxPageContent: "# Hello World\n\nThis is a press kit.",
        status: "validated",
      });

      const res = await request(app).get(`/public/${kit.shareToken}`);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.text).toContain("<!DOCTYPE html>");
      expect(res.text).toContain("<title>Public Kit</title>");
      expect(res.text).toContain("<h1>Hello World</h1>");
      expect(res.text).toContain("This is a press kit.");
    });

    it("escapes HTML in the title to prevent XSS", async () => {
      const kit = await insertTestMediaKit({
        orgId: "org_xss",
        title: '<script>alert("xss")</script>',
        mdxPageContent: "# Safe Content",
        status: "validated",
      });

      const res = await request(app).get(`/public/${kit.shareToken}`);

      expect(res.status).toBe(200);
      expect(res.text).not.toContain('<script>alert("xss")</script>');
      expect(res.text).toContain("&lt;script&gt;");
    });

    it("renders with default title when kit title is null", async () => {
      const kit = await insertTestMediaKit({
        orgId: "org_notitle",
        title: null,
        mdxPageContent: "# No Title Kit",
        status: "validated",
      });

      const res = await request(app).get(`/public/${kit.shareToken}`);

      expect(res.status).toBe(200);
      expect(res.text).toContain("<title>Press Kit</title>");
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
      expect(res.headers["content-type"]).toMatch(/text\/html/);
    });

    it("includes favicon link when iconUrl is set", async () => {
      const kit = await insertTestMediaKit({
        orgId: "org_icon",
        title: "Icon Kit",
        iconUrl: "https://cdn.example.com/icon.png",
        mdxPageContent: "# With Icon",
        status: "validated",
      });

      const res = await request(app).get(`/public/${kit.shareToken}`);

      expect(res.status).toBe(200);
      expect(res.text).toContain('rel="icon"');
      expect(res.text).toContain("https://cdn.example.com/icon.png");
    });
  });
});
