import { describe, it, expect, vi, beforeEach } from "vitest";

// We need to bypass the global mock from setup.ts, so we re-mock fetch
// and import the real module.
vi.unmock("../../src/lib/runs-client.js");

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// Set env vars before importing the module
process.env.RUNS_SERVICE_URL = "http://runs-service";
process.env.RUNS_SERVICE_API_KEY = "test-key";

const { batchGetCosts } = await import("../../src/lib/runs-client.js");

describe("batchGetCosts chunking", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("returns empty array for empty input", async () => {
    const result = await batchGetCosts([]);
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a single request for <= 500 run IDs", async () => {
    const runIds = Array.from({ length: 100 }, (_, i) => `run-${i}`);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        costs: [{ runId: "run-0", totalCostInUsdCents: "100", actualCostInUsdCents: "100", provisionedCostInUsdCents: "0" }],
      }),
    });

    const result = await batchGetCosts(runIds);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.runIds).toHaveLength(100);
    expect(result).toHaveLength(1);
  });

  it("chunks into multiple requests for > 500 run IDs", async () => {
    const runIds = Array.from({ length: 1200 }, (_, i) => `run-${i}`);

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          costs: [{ runId: "run-0", totalCostInUsdCents: "10", actualCostInUsdCents: "10", provisionedCostInUsdCents: "0" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          costs: [{ runId: "run-500", totalCostInUsdCents: "20", actualCostInUsdCents: "20", provisionedCostInUsdCents: "0" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          costs: [{ runId: "run-1000", totalCostInUsdCents: "30", actualCostInUsdCents: "30", provisionedCostInUsdCents: "0" }],
        }),
      });

    const result = await batchGetCosts(runIds);

    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Verify chunk sizes
    const chunk1 = JSON.parse(fetchMock.mock.calls[0][1].body).runIds;
    const chunk2 = JSON.parse(fetchMock.mock.calls[1][1].body).runIds;
    const chunk3 = JSON.parse(fetchMock.mock.calls[2][1].body).runIds;
    expect(chunk1).toHaveLength(500);
    expect(chunk2).toHaveLength(500);
    expect(chunk3).toHaveLength(200);

    // Results from all chunks are merged
    expect(result).toHaveLength(3);
    expect(result.map((c) => c.runId)).toEqual(["run-0", "run-500", "run-1000"]);
  });

  it("propagates errors from any chunk", async () => {
    const runIds = Array.from({ length: 600 }, (_, i) => `run-${i}`);

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ costs: [] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

    await expect(batchGetCosts(runIds)).rejects.toThrow("Runs service POST /v1/runs/costs/batch failed (500)");
  });
});
