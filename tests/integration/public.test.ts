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

    it("renders modern layout with header, Inter font, and card sections", async () => {
      const kit = await insertTestMediaKit({
        orgId: "org_modern",
        title: "Modern Kit",
        mdxPageContent: "# Modern Kit\n\nIntro paragraph.\n\n## Overview\n\nOverview content.\n\n## Team\n\nTeam content.",
        status: "validated",
      });

      const res = await request(app).get(`/public/${kit.shareToken}`);

      expect(res.status).toBe(200);
      expect(res.text).toContain("fonts.googleapis.com");
      expect(res.text).toContain("Inter");
      expect(res.text).toContain('class="header"');
      expect(res.text).toContain('class="page-title"');
      expect(res.text).toContain("Press Kit");
      // Each h2 section is wrapped in a card
      expect(res.text).toContain('<section class="card"><h2>Overview</h2>');
      expect(res.text).toContain('<section class="card"><h2>Team</h2>');
      // Intro text before first h2 is NOT in a card
      expect(res.text).toContain("<p>Intro paragraph.</p>");
      expect(res.text).not.toMatch(/<section class="card">.*<p>Intro paragraph\.<\/p>/s);
    });

    it("shows brand logo from iconUrl in header", async () => {
      const kit = await insertTestMediaKit({
        orgId: "org_logo",
        title: "Logo Kit",
        iconUrl: "https://cdn.example.com/logo.png",
        mdxPageContent: "# Logo Kit\n\nHas a logo.",
        status: "validated",
      });

      const res = await request(app).get(`/public/${kit.shareToken}`);

      expect(res.status).toBe(200);
      expect(res.text).toContain('class="brand-logo"');
      expect(res.text).toContain("https://cdn.example.com/logo.png");
    });

    it("falls back to logo.dev via brandDomain with token when iconUrl is not set", async () => {
      const kit = await insertTestMediaKit({
        orgId: "org_domain",
        title: "Domain Kit",
        brandDomain: "example.com",
        mdxPageContent: "# Domain Kit\n\nFallback logo.",
        status: "validated",
      });

      const res = await request(app).get(`/public/${kit.shareToken}`);

      expect(res.status).toBe(200);
      expect(res.text).toContain('class="brand-logo"');
      expect(res.text).toContain("https://img.logo.dev/example.com");
      expect(res.text).toContain("token=test-logo-dev-token");
      expect(res.text).toContain('onerror="this.style.display=');
    });

    it("does not render logo when neither iconUrl nor brandDomain is set", async () => {
      const kit = await insertTestMediaKit({
        orgId: "org_nologo",
        title: "No Logo Kit",
        mdxPageContent: "# No Logo\n\nContent.",
        status: "validated",
      });

      const res = await request(app).get(`/public/${kit.shareToken}`);

      expect(res.status).toBe(200);
      expect(res.text).not.toContain('class="brand-logo"');
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

    it("renders InteractiveImage as figure with img and caption", async () => {
      const kit = await insertTestMediaKit({
        orgId: "org_img",
        title: "Image Kit",
        mdxPageContent: '# Image Kit\n\n<InteractiveImage src="https://example.com/photo.jpg" alt="Team photo" caption="Our team at the summit" />',
        status: "validated",
      });

      const res = await request(app).get(`/public/${kit.shareToken}`);

      expect(res.status).toBe(200);
      expect(res.text).toContain('class="interactive-image"');
      expect(res.text).toContain('src="https://example.com/photo.jpg"');
      expect(res.text).toContain('alt="Team photo"');
      expect(res.text).toContain("Our team at the summit");
    });

    it("renders ClientLogo with logo.dev image and token", async () => {
      const kit = await insertTestMediaKit({
        orgId: "org_clogo",
        title: "Logo Kit",
        mdxPageContent: '# Logo Kit\n\n<ClientLogo domain="acme.com" name="Acme Corp" />',
        status: "validated",
      });

      const res = await request(app).get(`/public/${kit.shareToken}`);

      expect(res.status).toBe(200);
      expect(res.text).toContain('class="client-logo"');
      expect(res.text).toContain("https://img.logo.dev/acme.com");
      expect(res.text).toContain("Acme Corp");
      // Token from key-service should be included in the logo URL
      expect(res.text).toContain("token=test-logo-dev-token");
    });

    it("renders Collapsible as details/summary", async () => {
      const kit = await insertTestMediaKit({
        orgId: "org_collapse",
        title: "Collapsible Kit",
        mdxPageContent: "# Collapsible Kit\n\n<Collapsible>\n<CollapsibleTrigger>\nShow More\n</CollapsibleTrigger>\n<CollapsibleContent>\nHidden content here.\n</CollapsibleContent>\n</Collapsible>",
        status: "validated",
      });

      const res = await request(app).get(`/public/${kit.shareToken}`);

      expect(res.status).toBe(200);
      expect(res.text).toContain('class="collapsible"');
      expect(res.text).toContain("<summary>");
      expect(res.text).toContain("Show More");
      expect(res.text).toContain("Hidden content here.");
    });

    it("renders Card components as styled divs", async () => {
      const kit = await insertTestMediaKit({
        orgId: "org_card",
        title: "Card Kit",
        mdxPageContent: '# Card Kit\n\n<div className="not-prose my-6">\n<Card>\n<CardHeader>\n<CardTitle>Key Facts</CardTitle>\n</CardHeader>\n<CardContent>\nSome facts here.\n</CardContent>\n</Card>\n</div>',
        status: "validated",
      });

      const res = await request(app).get(`/public/${kit.shareToken}`);

      expect(res.status).toBe(200);
      expect(res.text).toContain('class="jsx-card"');
      expect(res.text).toContain('class="jsx-card-header"');
      expect(res.text).toContain('class="jsx-card-title"');
      expect(res.text).toContain("Key Facts");
      expect(res.text).toContain("Some facts here.");
      // className should be converted to class
      expect(res.text).not.toContain("className");
    });

    it("parses markdown inside CollapsibleContent", async () => {
      const kit = await insertTestMediaKit({
        orgId: "org_collapse_md",
        title: "Collapsible MD Kit",
        mdxPageContent: [
          "# Collapsible MD Kit",
          "",
          "<Collapsible>",
          "<CollapsibleTrigger>",
          "View Timeline",
          "</CollapsibleTrigger>",
          "<CollapsibleContent>",
          "",
          "### Project Timeline",
          "",
          "- **2025** — Phase one launch",
          "- **2026** — Phase two expansion",
          "",
          "</CollapsibleContent>",
          "</Collapsible>",
        ].join("\n"),
        status: "validated",
      });

      const res = await request(app).get(`/public/${kit.shareToken}`);

      expect(res.status).toBe(200);
      // Markdown inside collapsible should be parsed to HTML
      expect(res.text).toContain("<h3>Project Timeline</h3>");
      expect(res.text).toContain("<strong>2025</strong>");
      expect(res.text).toContain("<li>");
      // Should NOT contain raw markdown
      expect(res.text).not.toContain("### Project Timeline");
      expect(res.text).not.toContain("- **2025**");
    });

    it("strips Tailwind utility classes from wrapper divs", async () => {
      const kit = await insertTestMediaKit({
        orgId: "org_tailwind",
        title: "Tailwind Strip Kit",
        mdxPageContent: '# TW Kit\n\n<div className="not-prose my-6">\n<ClientLogo domain="test.com" name="Test" />\n</div>',
        status: "validated",
      });

      const res = await request(app).get(`/public/${kit.shareToken}`);

      expect(res.status).toBe(200);
      // Tailwind classes should be stripped
      expect(res.text).not.toContain("not-prose");
      expect(res.text).not.toContain("my-6");
      // ClientLogo should still render
      expect(res.text).toContain('class="client-logo"');
    });

    it("does not double-wrap sections that contain jsx-card", async () => {
      const kit = await insertTestMediaKit({
        orgId: "org_nodbwrap",
        title: "No Double Wrap",
        mdxPageContent: "# NDW\n\n## Facts\n\n<Card><CardContent>Inner card</CardContent></Card>",
        status: "validated",
      });

      const res = await request(app).get(`/public/${kit.shareToken}`);

      expect(res.status).toBe(200);
      // Section with jsx-card should NOT be wrapped in an outer card
      expect(res.text).not.toContain('<section class="card"><h2>Facts</h2>');
      expect(res.text).toContain('class="jsx-card"');
    });

    it("adds onerror fallback to InteractiveImage", async () => {
      const kit = await insertTestMediaKit({
        orgId: "org_imgerr",
        title: "Img Error Kit",
        mdxPageContent: '# Img Kit\n\n<InteractiveImage src="https://broken.example.com/img.jpg" alt="Broken" caption="Missing photo" />',
        status: "validated",
      });

      const res = await request(app).get(`/public/${kit.shareToken}`);

      expect(res.status).toBe(200);
      expect(res.text).toContain("img-broken");
      expect(res.text).toContain("Missing photo");
    });

    it("escapes brandDomain in logo URL to prevent XSS", async () => {
      const kit = await insertTestMediaKit({
        orgId: "org_xss_domain",
        title: "XSS Domain Kit",
        brandDomain: '"><script>alert(1)</script>',
        mdxPageContent: "# Test",
        status: "validated",
      });

      const res = await request(app).get(`/public/${kit.shareToken}`);

      expect(res.status).toBe(200);
      expect(res.text).not.toContain('<script>alert(1)</script>');
      expect(res.text).toContain("&quot;");
    });
  });
});
