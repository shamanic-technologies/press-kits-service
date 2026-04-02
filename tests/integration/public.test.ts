import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp } from "../helpers/test-app.js";
import { cleanTestData, insertTestMediaKit, closeDb } from "../helpers/test-db.js";
import { db } from "../../src/db/index.js";
import { mediaKitViews } from "../../src/db/schema.js";
import { eq } from "drizzle-orm";

const app = createTestApp();

/** Minimal valid HTML page for tests */
function htmlPage(opts: { title?: string; body?: string } = {}): string {
  const title = opts.title ?? "Test Kit";
  const body = opts.body ?? "<h1>Hello World</h1><p>This is a press kit.</p>";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body>${body}</body>
</html>`;
}

describe("Public", () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  describe("GET /public/:token", () => {
    it("returns the HTML page directly as stored", async () => {
      const content = htmlPage({ title: "Public Kit", body: "<h1>Hello World</h1><p>This is a press kit.</p>" });
      const kit = await insertTestMediaKit({
        orgId: "org_pub",
        title: "Public Kit",
        mdxPageContent: content,
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

    it("serves Tailwind CDN page without transformation", async () => {
      const content = htmlPage({
        title: "Tailwind Kit",
        body: '<div class="max-w-4xl mx-auto py-16"><h1 class="text-4xl font-bold">Modern Kit</h1><p class="text-gray-600">Intro paragraph.</p></div>',
      });
      const kit = await insertTestMediaKit({
        orgId: "org_modern",
        title: "Modern Kit",
        mdxPageContent: content,
        status: "validated",
      });

      const res = await request(app).get(`/public/${kit.shareToken}`);

      expect(res.status).toBe(200);
      expect(res.text).toContain("cdn.tailwindcss.com");
      expect(res.text).toContain('class="max-w-4xl mx-auto py-16"');
      expect(res.text).toContain('class="text-4xl font-bold"');
      expect(res.text).toContain('class="text-gray-600"');
    });

    it("injects favicon when iconUrl is set", async () => {
      const content = htmlPage({ title: "Icon Kit" });
      const kit = await insertTestMediaKit({
        orgId: "org_icon",
        title: "Icon Kit",
        iconUrl: "https://cdn.example.com/icon.png",
        mdxPageContent: content,
        status: "validated",
      });

      const res = await request(app).get(`/public/${kit.shareToken}`);

      expect(res.status).toBe(200);
      expect(res.text).toContain('rel="icon"');
      expect(res.text).toContain("https://cdn.example.com/icon.png");
    });

    it("does not inject favicon when iconUrl is null", async () => {
      const content = htmlPage();
      const kit = await insertTestMediaKit({
        orgId: "org_noicon",
        title: "No Icon",
        mdxPageContent: content,
        status: "validated",
      });

      const res = await request(app).get(`/public/${kit.shareToken}`);

      expect(res.status).toBe(200);
      expect(res.text).not.toContain('rel="icon"');
    });

    it("injects logo.dev token into img.logo.dev URLs", async () => {
      const content = htmlPage({
        body: '<img src="https://img.logo.dev/acme.com?format=png&size=80" alt="Acme" />',
      });
      const kit = await insertTestMediaKit({
        orgId: "org_logo",
        title: "Logo Kit",
        mdxPageContent: content,
        status: "validated",
      });

      const res = await request(app).get(`/public/${kit.shareToken}`);

      expect(res.status).toBe(200);
      expect(res.text).toContain("https://img.logo.dev/acme.com?format=png&size=80&token=test-logo-dev-token");
    });

    it("does not double-inject token if already present", async () => {
      const content = htmlPage({
        body: '<img src="https://img.logo.dev/acme.com?token=existing" alt="Acme" />',
      });
      const kit = await insertTestMediaKit({
        orgId: "org_token",
        title: "Token Kit",
        mdxPageContent: content,
        status: "validated",
      });

      const res = await request(app).get(`/public/${kit.shareToken}`);

      expect(res.status).toBe(200);
      // Should keep the existing token, not add another
      expect(res.text).toContain("token=existing");
      expect(res.text).not.toContain("test-logo-dev-token");
    });

    it("handles empty content gracefully", async () => {
      const kit = await insertTestMediaKit({
        orgId: "org_empty",
        title: "Empty Kit",
        mdxPageContent: null,
        status: "validated",
      });

      const res = await request(app).get(`/public/${kit.shareToken}`);

      expect(res.status).toBe(200);
      expect(res.text).toBe("");
    });

    it("tracks a view on successful access", async () => {
      const kit = await insertTestMediaKit({
        orgId: "org_pub_views",
        mdxPageContent: htmlPage(),
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
      const kit = await insertTestMediaKit({
        orgId: "org_pub_3",
        mdxPageContent: htmlPage(),
        status: "drafted",
      });
      const res = await request(app).get(`/public/${kit.shareToken}`);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
    });

    it("escapes HTML in favicon iconUrl to prevent XSS", async () => {
      const content = htmlPage();
      const kit = await insertTestMediaKit({
        orgId: "org_xss",
        title: "XSS Kit",
        iconUrl: '"><script>alert("xss")</script>',
        mdxPageContent: content,
        status: "validated",
      });

      const res = await request(app).get(`/public/${kit.shareToken}`);

      expect(res.status).toBe(200);
      expect(res.text).not.toContain('<script>alert("xss")</script>');
      expect(res.text).toContain("&quot;");
    });
  });
});
