import { describe, it, expect, vi, beforeEach } from "vitest";

// LEDGER-HISTORY-1024: every run this service opens is marked support at creation (no catalogue pipe consumes a press kit).
vi.unmock("../../src/lib/runs-client.js");

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
process.env.RUNS_SERVICE_URL = "http://runs-service";
process.env.RUNS_SERVICE_API_KEY = "test-key";

const { createRun, RUN_SUPPORT } = await import("../../src/lib/runs-client.js");

describe("createRun support mark (LEDGER-HISTORY-1024)", () => {
  beforeEach(() => fetchMock.mockReset());

  it("states the support function on every run it opens", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: "run-1" }) });
    await createRun({ orgId: "org-1", serviceName: "press-kits-service", taskName: "generate-press-kit", parentRunId: "parent-1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://runs-service/v1/runs");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ orgId: "org-1", serviceName: "press-kits-service", taskName: "generate-press-kit", parentRunId: "parent-1" });
    expect(body.support).toEqual({ kind: "product_feature", reason: RUN_SUPPORT.reason });
    expect(body.ctx).toBeUndefined();
  });
});
