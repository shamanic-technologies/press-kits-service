import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import { createTestApp, getAuthHeaders } from "../helpers/test-app.js";
import {
  cleanTestData,
  insertTestMediaKit,
  insertTestMediaKitRun,
  closeDb,
} from "../helpers/test-db.js";
import { batchGetCosts } from "../../src/lib/runs-client.js";

const mockBatchGetCosts = vi.mocked(batchGetCosts);

const app = createTestApp();
const headers = getAuthHeaders();

describe("Cost Stats", () => {
  beforeEach(async () => {
    await cleanTestData();
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  describe("GET /media-kits/stats/costs", () => {
    it("returns zero stats when no runs exist", async () => {
      const res = await request(app)
        .get("/media-kits/stats/costs")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.groups).toHaveLength(1);
      expect(res.body.groups[0].totalCostInUsdCents).toBe(0);
      expect(res.body.groups[0].runCount).toBe(0);
    });

    it("returns flat aggregated costs across all kits", async () => {
      const kit1 = await insertTestMediaKit({ orgId: "test-org-id", status: "validated" });
      const kit2 = await insertTestMediaKit({ orgId: "test-org-id", status: "drafted" });

      await insertTestMediaKitRun({ mediaKitId: kit1.id, runId: "run-1", runType: "generation" });
      await insertTestMediaKitRun({ mediaKitId: kit2.id, runId: "run-2", runType: "generation" });

      mockBatchGetCosts.mockResolvedValue([
        { runId: "run-1", totalCostInUsdCents: "1000", actualCostInUsdCents: "1000", provisionedCostInUsdCents: "0" },
        { runId: "run-2", totalCostInUsdCents: "500", actualCostInUsdCents: "500", provisionedCostInUsdCents: "0" },
      ]);

      const res = await request(app)
        .get("/media-kits/stats/costs")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.groups).toHaveLength(1);
      expect(res.body.groups[0].totalCostInUsdCents).toBe(1500);
      expect(res.body.groups[0].actualCostInUsdCents).toBe(1500);
      expect(res.body.groups[0].runCount).toBe(2);
    });

    it("groups costs by mediaKitId", async () => {
      const kit1 = await insertTestMediaKit({ orgId: "test-org-id", status: "validated" });
      const kit2 = await insertTestMediaKit({ orgId: "test-org-id", status: "drafted" });

      await insertTestMediaKitRun({ mediaKitId: kit1.id, runId: "run-a", runType: "generation" });
      await insertTestMediaKitRun({ mediaKitId: kit1.id, runId: "run-b", runType: "edit" });
      await insertTestMediaKitRun({ mediaKitId: kit2.id, runId: "run-c", runType: "generation" });

      mockBatchGetCosts.mockResolvedValue([
        { runId: "run-a", totalCostInUsdCents: "800", actualCostInUsdCents: "800", provisionedCostInUsdCents: "0" },
        { runId: "run-b", totalCostInUsdCents: "200", actualCostInUsdCents: "200", provisionedCostInUsdCents: "0" },
        { runId: "run-c", totalCostInUsdCents: "600", actualCostInUsdCents: "600", provisionedCostInUsdCents: "0" },
      ]);

      const res = await request(app)
        .get("/media-kits/stats/costs?groupBy=mediaKitId")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.groups).toHaveLength(2);

      const g1 = res.body.groups.find((g: { dimensions: { mediaKitId: string } }) => g.dimensions.mediaKitId === kit1.id);
      const g2 = res.body.groups.find((g: { dimensions: { mediaKitId: string } }) => g.dimensions.mediaKitId === kit2.id);

      expect(g1.totalCostInUsdCents).toBe(1000);
      expect(g1.runCount).toBe(2);
      expect(g2.totalCostInUsdCents).toBe(600);
      expect(g2.runCount).toBe(1);
    });

    it("filters by mediaKitId", async () => {
      const kit1 = await insertTestMediaKit({ orgId: "test-org-id", status: "validated" });
      const kit2 = await insertTestMediaKit({ orgId: "test-org-id", status: "drafted" });

      await insertTestMediaKitRun({ mediaKitId: kit1.id, runId: "run-x", runType: "generation" });
      await insertTestMediaKitRun({ mediaKitId: kit2.id, runId: "run-y", runType: "generation" });

      mockBatchGetCosts.mockResolvedValue([
        { runId: "run-x", totalCostInUsdCents: "300", actualCostInUsdCents: "300", provisionedCostInUsdCents: "0" },
      ]);

      const res = await request(app)
        .get(`/media-kits/stats/costs?mediaKitId=${kit1.id}`)
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.groups[0].runCount).toBe(1);
      expect(res.body.groups[0].totalCostInUsdCents).toBe(300);

      // batchGetCosts should have been called with only run-x
      expect(mockBatchGetCosts).toHaveBeenCalledWith(["run-x"], expect.anything());
    });

    it("filters by brandId", async () => {
      const kit1 = await insertTestMediaKit({ orgId: "test-org-id", status: "validated", brandId: "brand-1" });
      const kit2 = await insertTestMediaKit({ orgId: "test-org-id", status: "validated", brandId: "brand-2" });

      await insertTestMediaKitRun({ mediaKitId: kit1.id, runId: "run-b1", runType: "generation" });
      await insertTestMediaKitRun({ mediaKitId: kit2.id, runId: "run-b2", runType: "generation" });

      mockBatchGetCosts.mockResolvedValue([
        { runId: "run-b1", totalCostInUsdCents: "400", actualCostInUsdCents: "400", provisionedCostInUsdCents: "0" },
      ]);

      const res = await request(app)
        .get("/media-kits/stats/costs?brandId=brand-1")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.groups[0].runCount).toBe(1);
      expect(mockBatchGetCosts).toHaveBeenCalledWith(["run-b1"], expect.anything());
    });

    it("filters by campaignId", async () => {
      const kit1 = await insertTestMediaKit({ orgId: "test-org-id", status: "validated", campaignId: "camp-1" });
      const kit2 = await insertTestMediaKit({ orgId: "test-org-id", status: "validated", campaignId: "camp-2" });

      await insertTestMediaKitRun({ mediaKitId: kit1.id, runId: "run-c1", runType: "generation" });
      await insertTestMediaKitRun({ mediaKitId: kit2.id, runId: "run-c2", runType: "generation" });

      mockBatchGetCosts.mockResolvedValue([
        { runId: "run-c1", totalCostInUsdCents: "700", actualCostInUsdCents: "700", provisionedCostInUsdCents: "0" },
      ]);

      const res = await request(app)
        .get("/media-kits/stats/costs?campaignId=camp-1")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.groups[0].runCount).toBe(1);
      expect(mockBatchGetCosts).toHaveBeenCalledWith(["run-c1"], expect.anything());
    });

    it("scopes stats to the requesting org", async () => {
      const kit1 = await insertTestMediaKit({ orgId: "test-org-id", status: "validated" });
      const kit2 = await insertTestMediaKit({ orgId: "other-org", status: "validated" });

      await insertTestMediaKitRun({ mediaKitId: kit1.id, runId: "run-mine", runType: "generation" });
      await insertTestMediaKitRun({ mediaKitId: kit2.id, runId: "run-theirs", runType: "generation" });

      mockBatchGetCosts.mockResolvedValue([
        { runId: "run-mine", totalCostInUsdCents: "100", actualCostInUsdCents: "100", provisionedCostInUsdCents: "0" },
      ]);

      const res = await request(app)
        .get("/media-kits/stats/costs")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.groups[0].runCount).toBe(1);
      // Should only query for run-mine, not run-theirs
      expect(mockBatchGetCosts).toHaveBeenCalledWith(["run-mine"], expect.anything());
    });

    it("returns empty groups array when groupBy=mediaKitId and no runs", async () => {
      const res = await request(app)
        .get("/media-kits/stats/costs?groupBy=mediaKitId")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.groups).toEqual([]);
    });

    it("handles runs omitted by runs-service gracefully", async () => {
      const kit = await insertTestMediaKit({ orgId: "test-org-id", status: "validated" });
      await insertTestMediaKitRun({ mediaKitId: kit.id, runId: "run-gone", runType: "generation" });

      // runs-service omits missing runs
      mockBatchGetCosts.mockResolvedValue([]);

      const res = await request(app)
        .get("/media-kits/stats/costs")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.groups[0].totalCostInUsdCents).toBe(0);
      expect(res.body.groups[0].runCount).toBe(1);
    });
  });
});
