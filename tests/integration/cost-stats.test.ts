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
import { resolveWorkflowDynastySlugs } from "../../src/lib/dynasty-client.js";

const mockBatchGetCosts = vi.mocked(batchGetCosts);
const mockResolveWorkflow = vi.mocked(resolveWorkflowDynastySlugs);

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
      const kit1 = await insertTestMediaKit({ orgId: "test-org-id", status: "validated", brandIds: ["brand-1"] });
      const kit2 = await insertTestMediaKit({ orgId: "test-org-id", status: "validated", brandIds: ["brand-2"] });

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

    it("filters by featureSlug", async () => {
      const kit1 = await insertTestMediaKit({ orgId: "test-org-id", status: "validated", featureSlug: "press-kit-v2" });
      const kit2 = await insertTestMediaKit({ orgId: "test-org-id", status: "validated", featureSlug: "press-kit-v1" });

      await insertTestMediaKitRun({ mediaKitId: kit1.id, runId: "run-f1", runType: "generation" });
      await insertTestMediaKitRun({ mediaKitId: kit2.id, runId: "run-f2", runType: "generation" });

      mockBatchGetCosts.mockResolvedValue([
        { runId: "run-f1", totalCostInUsdCents: "200", actualCostInUsdCents: "200", provisionedCostInUsdCents: "0" },
      ]);

      const res = await request(app)
        .get("/media-kits/stats/costs?featureSlug=press-kit-v2")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.groups[0].runCount).toBe(1);
      expect(mockBatchGetCosts).toHaveBeenCalledWith(["run-f1"], expect.anything());
    });

    it("filters by workflowSlug", async () => {
      const kit1 = await insertTestMediaKit({ orgId: "test-org-id", status: "validated", workflowSlug: "wf-gen" });
      const kit2 = await insertTestMediaKit({ orgId: "test-org-id", status: "validated", workflowSlug: "wf-other" });

      await insertTestMediaKitRun({ mediaKitId: kit1.id, runId: "run-w1", runType: "generation" });
      await insertTestMediaKitRun({ mediaKitId: kit2.id, runId: "run-w2", runType: "generation" });

      mockBatchGetCosts.mockResolvedValue([
        { runId: "run-w1", totalCostInUsdCents: "300", actualCostInUsdCents: "300", provisionedCostInUsdCents: "0" },
      ]);

      const res = await request(app)
        .get("/media-kits/stats/costs?workflowSlug=wf-gen")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.groups[0].runCount).toBe(1);
      expect(mockBatchGetCosts).toHaveBeenCalledWith(["run-w1"], expect.anything());
    });

    it("groups costs by brandId", async () => {
      const kit1 = await insertTestMediaKit({ orgId: "test-org-id", status: "validated", brandIds: ["brand-x"] });
      const kit2 = await insertTestMediaKit({ orgId: "test-org-id", status: "validated", brandIds: ["brand-y"] });

      await insertTestMediaKitRun({ mediaKitId: kit1.id, runId: "run-bx", runType: "generation" });
      await insertTestMediaKitRun({ mediaKitId: kit2.id, runId: "run-by", runType: "generation" });

      mockBatchGetCosts.mockResolvedValue([
        { runId: "run-bx", totalCostInUsdCents: "400", actualCostInUsdCents: "400", provisionedCostInUsdCents: "0" },
        { runId: "run-by", totalCostInUsdCents: "600", actualCostInUsdCents: "600", provisionedCostInUsdCents: "0" },
      ]);

      const res = await request(app)
        .get("/media-kits/stats/costs?groupBy=brandId")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.groups).toHaveLength(2);

      const gx = res.body.groups.find((g: { dimensions: { brandId: string } }) => g.dimensions.brandId === "brand-x");
      const gy = res.body.groups.find((g: { dimensions: { brandId: string } }) => g.dimensions.brandId === "brand-y");
      expect(gx.totalCostInUsdCents).toBe(400);
      expect(gx.runCount).toBe(1);
      expect(gy.totalCostInUsdCents).toBe(600);
      expect(gy.runCount).toBe(1);
    });

    it("groups costs by campaignId", async () => {
      const kit1 = await insertTestMediaKit({ orgId: "test-org-id", status: "validated", campaignId: "camp-x" });
      const kit2 = await insertTestMediaKit({ orgId: "test-org-id", status: "validated", campaignId: "camp-y" });

      await insertTestMediaKitRun({ mediaKitId: kit1.id, runId: "run-cx", runType: "generation" });
      await insertTestMediaKitRun({ mediaKitId: kit2.id, runId: "run-cy", runType: "generation" });

      mockBatchGetCosts.mockResolvedValue([
        { runId: "run-cx", totalCostInUsdCents: "150", actualCostInUsdCents: "150", provisionedCostInUsdCents: "0" },
        { runId: "run-cy", totalCostInUsdCents: "250", actualCostInUsdCents: "250", provisionedCostInUsdCents: "0" },
      ]);

      const res = await request(app)
        .get("/media-kits/stats/costs?groupBy=campaignId")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.groups).toHaveLength(2);

      const gx = res.body.groups.find((g: { dimensions: { campaignId: string } }) => g.dimensions.campaignId === "camp-x");
      const gy = res.body.groups.find((g: { dimensions: { campaignId: string } }) => g.dimensions.campaignId === "camp-y");
      expect(gx.totalCostInUsdCents).toBe(150);
      expect(gy.totalCostInUsdCents).toBe(250);
    });

    it("groups costs by featureSlug", async () => {
      const kit1 = await insertTestMediaKit({ orgId: "test-org-id", status: "validated", featureSlug: "feat-a" });
      const kit2 = await insertTestMediaKit({ orgId: "test-org-id", status: "validated", featureSlug: "feat-b" });

      await insertTestMediaKitRun({ mediaKitId: kit1.id, runId: "run-fa", runType: "generation" });
      await insertTestMediaKitRun({ mediaKitId: kit2.id, runId: "run-fb", runType: "generation" });

      mockBatchGetCosts.mockResolvedValue([
        { runId: "run-fa", totalCostInUsdCents: "500", actualCostInUsdCents: "500", provisionedCostInUsdCents: "0" },
        { runId: "run-fb", totalCostInUsdCents: "300", actualCostInUsdCents: "300", provisionedCostInUsdCents: "0" },
      ]);

      const res = await request(app)
        .get("/media-kits/stats/costs?groupBy=featureSlug")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.groups).toHaveLength(2);

      const ga = res.body.groups.find((g: { dimensions: { featureSlug: string } }) => g.dimensions.featureSlug === "feat-a");
      const gb = res.body.groups.find((g: { dimensions: { featureSlug: string } }) => g.dimensions.featureSlug === "feat-b");
      expect(ga.totalCostInUsdCents).toBe(500);
      expect(gb.totalCostInUsdCents).toBe(300);
    });

    it("groups costs by workflowSlug", async () => {
      const kit1 = await insertTestMediaKit({ orgId: "test-org-id", status: "validated", workflowSlug: "wf-1" });
      const kit2 = await insertTestMediaKit({ orgId: "test-org-id", status: "validated", workflowSlug: "wf-2" });

      await insertTestMediaKitRun({ mediaKitId: kit1.id, runId: "run-wf1", runType: "generation" });
      await insertTestMediaKitRun({ mediaKitId: kit2.id, runId: "run-wf2", runType: "generation" });

      mockBatchGetCosts.mockResolvedValue([
        { runId: "run-wf1", totalCostInUsdCents: "800", actualCostInUsdCents: "800", provisionedCostInUsdCents: "0" },
        { runId: "run-wf2", totalCostInUsdCents: "200", actualCostInUsdCents: "200", provisionedCostInUsdCents: "0" },
      ]);

      const res = await request(app)
        .get("/media-kits/stats/costs?groupBy=workflowSlug")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.groups).toHaveLength(2);

      const g1 = res.body.groups.find((g: { dimensions: { workflowSlug: string } }) => g.dimensions.workflowSlug === "wf-1");
      const g2 = res.body.groups.find((g: { dimensions: { workflowSlug: string } }) => g.dimensions.workflowSlug === "wf-2");
      expect(g1.totalCostInUsdCents).toBe(800);
      expect(g2.totalCostInUsdCents).toBe(200);
    });

    it("filters by workflowDynastySlug via service resolution", async () => {
      mockResolveWorkflow.mockResolvedValue(["wf-gen", "wf-gen-v2"]);

      const kit1 = await insertTestMediaKit({ orgId: "test-org-id", status: "validated", workflowSlug: "wf-gen" });
      const kit2 = await insertTestMediaKit({ orgId: "test-org-id", status: "validated", workflowSlug: "wf-other" });

      await insertTestMediaKitRun({ mediaKitId: kit1.id, runId: "run-wd1", runType: "generation" });
      await insertTestMediaKitRun({ mediaKitId: kit2.id, runId: "run-wd2", runType: "generation" });

      mockBatchGetCosts.mockResolvedValue([
        { runId: "run-wd1", totalCostInUsdCents: "350", actualCostInUsdCents: "350", provisionedCostInUsdCents: "0" },
      ]);

      const res = await request(app)
        .get("/media-kits/stats/costs?workflowDynastySlug=wf-dynasty")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.groups[0].runCount).toBe(1);
      expect(mockBatchGetCosts).toHaveBeenCalledWith(["run-wd1"], expect.anything());
      expect(mockResolveWorkflow).toHaveBeenCalledWith("wf-dynasty", expect.anything());
    });

    it("returns empty groups when groupBy=brandId and no runs", async () => {
      const res = await request(app)
        .get("/media-kits/stats/costs?groupBy=brandId")
        .set(headers);

      expect(res.status).toBe(200);
      expect(res.body.groups).toEqual([]);
    });
  });
});
