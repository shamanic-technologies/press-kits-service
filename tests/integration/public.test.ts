import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp } from "../helpers/test-app.js";
import {
  cleanTestData,
  insertTestOrganization,
  insertTestMediaKit,
  closeDb,
} from "../helpers/test-db.js";

const app = createTestApp();

describe("Public Endpoints", () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  describe("GET /public/:token", () => {
    it("returns validated kit by share token", async () => {
      const org = await insertTestOrganization({
        orgId: "org_pub_1",
        name: "Public Org",
      });
      await insertTestMediaKit({
        orgId: "org_pub_1",
        organizationId: org.id,
        title: "Public Kit",
        mdxPageContent: "# Hello",
        status: "validated",
      });

      const res = await request(app).get(`/public/${org.shareToken}`);

      expect(res.status).toBe(200);
      expect(res.body.organization.name).toBe("Public Org");
      expect(res.body.mediaKit).not.toBeNull();
      expect(res.body.mediaKit.title).toBe("Public Kit");
    });

    it("falls back to drafted if no validated", async () => {
      const org = await insertTestOrganization({ orgId: "org_pub_2" });
      await insertTestMediaKit({
        orgId: "org_pub_2",
        organizationId: org.id,
        title: "Draft Kit",
        status: "drafted",
      });

      const res = await request(app).get(`/public/${org.shareToken}`);

      expect(res.status).toBe(200);
      expect(res.body.mediaKit).not.toBeNull();
      expect(res.body.mediaKit.status).toBe("drafted");
    });

    it("returns 404 for unknown token", async () => {
      const res = await request(app).get(
        "/public/00000000-0000-0000-0000-000000000000"
      );

      expect(res.status).toBe(404);
    });

    it("requires no auth", async () => {
      const org = await insertTestOrganization({ orgId: "org_pub_3" });
      const res = await request(app).get(`/public/${org.shareToken}`);

      // Should work without auth headers (200, not 401)
      expect(res.status).toBe(200);
    });
  });

  describe("GET /email-data/press-kit/:orgId", () => {
    it("returns email data for org with kit", async () => {
      const org = await insertTestOrganization({
        orgId: "org_email_1",
        name: "Email Org",
      });
      await insertTestMediaKit({
        orgId: "org_email_1",
        organizationId: org.id,
        title: "Email Kit",
        mdxPageContent: "# Email Content",
        status: "validated",
      });

      const res = await request(app).get("/email-data/press-kit/org_email_1");

      expect(res.status).toBe(200);
      expect(res.body.companyName).toBe("Email Org");
      expect(res.body.status).toBe("validated");
      expect(res.body.title).toBe("Email Kit");
      expect(res.body.content).toBe("# Email Content");
      expect(res.body.contentType).toBe("mdx");
    });

    it("returns nulls for unknown org", async () => {
      const res = await request(app).get("/email-data/press-kit/org_unknown");

      expect(res.status).toBe(200);
      expect(res.body.companyName).toBeNull();
    });
  });
});
