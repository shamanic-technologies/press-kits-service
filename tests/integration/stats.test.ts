import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, getAuthHeaders } from "../helpers/test-app.js";
import { cleanTestData, insertTestMediaKit, insertTestView, closeDb } from "../helpers/test-db.js";

const app = createTestApp();
const headers = getAuthHeaders();

describe("Stats", () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  describe("GET /media-kits/stats/views", () => {
    it("returns flat stats with no groupBy", async () => {
      const kit = await insertTestMediaKit({
        orgId: "test-org-id",
        status: "validated",
        title: "Test Kit",
      });

      await insertTestView({ mediaKitId: kit.id, ipAddress: "1.2.3.4", country: "US" });
      await insertTestView({ mediaKitId: kit.id, ipAddress: "1.2.3.4", country: "US" });
      await insertTestView({ mediaKitId: kit.id, ipAddress: "5.6.7.8", country: "FR" });

      const res = await request(app)
        .get("/media-kits/stats/views")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.totalViews).toBe(3);
      expect(res.body.uniqueVisitors).toBe(2);
      expect(res.body.lastViewedAt).toBeTruthy();
      expect(res.body.firstViewedAt).toBeTruthy();
    });

    it("returns grouped stats by country", async () => {
      const kit = await insertTestMediaKit({
        orgId: "test-org-id",
        status: "validated",
      });

      await insertTestView({ mediaKitId: kit.id, ipAddress: "1.2.3.4", country: "US" });
      await insertTestView({ mediaKitId: kit.id, ipAddress: "5.6.7.8", country: "US" });
      await insertTestView({ mediaKitId: kit.id, ipAddress: "9.0.1.2", country: "FR" });

      const res = await request(app)
        .get("/media-kits/stats/views?groupBy=country")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.groups).toHaveLength(2);

      const us = res.body.groups.find((g: { key: string }) => g.key === "US");
      const fr = res.body.groups.find((g: { key: string }) => g.key === "FR");
      expect(us.totalViews).toBe(2);
      expect(fr.totalViews).toBe(1);
    });

    it("returns grouped stats by day", async () => {
      const kit = await insertTestMediaKit({
        orgId: "test-org-id",
        status: "validated",
      });

      const day1 = new Date("2026-03-28T10:00:00Z");
      const day2 = new Date("2026-03-29T10:00:00Z");

      await insertTestView({ mediaKitId: kit.id, viewedAt: day1, country: "US" });
      await insertTestView({ mediaKitId: kit.id, viewedAt: day2, country: "US" });
      await insertTestView({ mediaKitId: kit.id, viewedAt: day2, country: "FR" });

      const res = await request(app)
        .get("/media-kits/stats/views?groupBy=day")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.groups).toHaveLength(2);

      const d1 = res.body.groups.find((g: { key: string }) => g.key === "2026-03-28");
      const d2 = res.body.groups.find((g: { key: string }) => g.key === "2026-03-29");
      expect(d1.totalViews).toBe(1);
      expect(d2.totalViews).toBe(2);
    });

    it("returns grouped stats by mediaKitId", async () => {
      const kit1 = await insertTestMediaKit({
        orgId: "test-org-id",
        status: "validated",
        title: "Kit A",
      });
      const kit2 = await insertTestMediaKit({
        orgId: "test-org-id",
        status: "validated",
        title: "Kit B",
      });

      await insertTestView({ mediaKitId: kit1.id, country: "US" });
      await insertTestView({ mediaKitId: kit2.id, country: "FR" });
      await insertTestView({ mediaKitId: kit2.id, country: "DE" });

      const res = await request(app)
        .get("/media-kits/stats/views?groupBy=mediaKitId")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.groups).toHaveLength(2);

      const g1 = res.body.groups.find((g: { key: string }) => g.key === kit1.id);
      const g2 = res.body.groups.find((g: { key: string }) => g.key === kit2.id);
      expect(g1.totalViews).toBe(1);
      expect(g2.totalViews).toBe(2);
    });

    it("filters by mediaKitId", async () => {
      const kit1 = await insertTestMediaKit({ orgId: "test-org-id", status: "validated" });
      const kit2 = await insertTestMediaKit({ orgId: "test-org-id", status: "validated" });

      await insertTestView({ mediaKitId: kit1.id, country: "US" });
      await insertTestView({ mediaKitId: kit2.id, country: "US" });

      const res = await request(app)
        .get(`/media-kits/stats/views?mediaKitId=${kit1.id}`)
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.totalViews).toBe(1);
    });

    it("filters by brandId", async () => {
      const kit1 = await insertTestMediaKit({ orgId: "test-org-id", status: "validated", brandId: "brand-1" });
      const kit2 = await insertTestMediaKit({ orgId: "test-org-id", status: "validated", brandId: "brand-2" });

      await insertTestView({ mediaKitId: kit1.id, country: "US" });
      await insertTestView({ mediaKitId: kit2.id, country: "US" });

      const res = await request(app)
        .get("/media-kits/stats/views?brandId=brand-1")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.totalViews).toBe(1);
    });

    it("filters by campaignId", async () => {
      const kit1 = await insertTestMediaKit({ orgId: "test-org-id", status: "validated", campaignId: "camp-1" });
      const kit2 = await insertTestMediaKit({ orgId: "test-org-id", status: "validated", campaignId: "camp-2" });

      await insertTestView({ mediaKitId: kit1.id, country: "US" });
      await insertTestView({ mediaKitId: kit2.id, country: "FR" });
      await insertTestView({ mediaKitId: kit2.id, country: "DE" });

      const res = await request(app)
        .get("/media-kits/stats/views?campaignId=camp-2")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.totalViews).toBe(2);
    });

    it("filters by date range", async () => {
      const kit = await insertTestMediaKit({ orgId: "test-org-id", status: "validated" });

      await insertTestView({ mediaKitId: kit.id, viewedAt: new Date("2026-03-01T10:00:00Z"), country: "US" });
      await insertTestView({ mediaKitId: kit.id, viewedAt: new Date("2026-03-15T10:00:00Z"), country: "US" });
      await insertTestView({ mediaKitId: kit.id, viewedAt: new Date("2026-03-28T10:00:00Z"), country: "US" });

      const res = await request(app)
        .get("/media-kits/stats/views?from=2026-03-10T00:00:00Z&to=2026-03-20T00:00:00Z")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.totalViews).toBe(1);
    });

    it("returns zero stats when no views exist", async () => {
      await insertTestMediaKit({ orgId: "test-org-id", status: "validated" });

      const res = await request(app)
        .get("/media-kits/stats/views")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.totalViews).toBe(0);
      expect(res.body.uniqueVisitors).toBe(0);
      expect(res.body.lastViewedAt).toBeNull();
    });

    it("scopes stats to the requesting org", async () => {
      const kit1 = await insertTestMediaKit({ orgId: "test-org-id", status: "validated" });
      const kit2 = await insertTestMediaKit({ orgId: "other-org", status: "validated" });

      await insertTestView({ mediaKitId: kit1.id, country: "US" });
      await insertTestView({ mediaKitId: kit2.id, country: "US" });

      const res = await request(app)
        .get("/media-kits/stats/views")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.totalViews).toBe(1);
    });
  });
});
