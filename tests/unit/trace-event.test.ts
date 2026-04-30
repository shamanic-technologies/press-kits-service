import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.unmock("../../src/lib/trace-event.js");

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("traceEvent", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    fetchMock.mockReset();
    process.env.RUNS_SERVICE_URL = "http://runs-service";
    process.env.RUNS_SERVICE_API_KEY = "test-api-key";
  });

  afterEach(() => {
    process.env.RUNS_SERVICE_URL = originalEnv.RUNS_SERVICE_URL;
    process.env.RUNS_SERVICE_API_KEY = originalEnv.RUNS_SERVICE_API_KEY;
  });

  async function loadModule() {
    // Dynamic import to pick up env changes
    const mod = await import("../../src/lib/trace-event.js");
    return mod.traceEvent;
  }

  it("POSTs to runs-service with correct URL, headers, and body", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });
    const traceEvent = await loadModule();

    await traceEvent(
      "run-123",
      {
        service: "press-kits-service",
        event: "generate-start",
        detail: "Starting generation",
        level: "info",
        data: { kitId: "kit-1" },
      },
      {
        "x-org-id": "org-1",
        "x-user-id": "user-1",
        "x-brand-id": "brand-1,brand-2",
        "x-campaign-id": "camp-1",
        "x-workflow-slug": "wf-1",
        "x-feature-slug": "feat-1",
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("http://runs-service/v1/runs/run-123/events");
    expect(opts.method).toBe("POST");

    const headers = opts.headers;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["x-api-key"]).toBe("test-api-key");
    expect(headers["x-org-id"]).toBe("org-1");
    expect(headers["x-user-id"]).toBe("user-1");
    expect(headers["x-brand-id"]).toBe("brand-1,brand-2");
    expect(headers["x-campaign-id"]).toBe("camp-1");
    expect(headers["x-workflow-slug"]).toBe("wf-1");
    expect(headers["x-feature-slug"]).toBe("feat-1");

    const body = JSON.parse(opts.body);
    expect(body).toEqual({
      service: "press-kits-service",
      event: "generate-start",
      detail: "Starting generation",
      level: "info",
      data: { kitId: "kit-1" },
    });
  });

  it("never throws on fetch failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network error"));
    const traceEvent = await loadModule();

    await expect(
      traceEvent(
        "run-123",
        { service: "press-kits-service", event: "test" },
        { "x-org-id": "org-1" },
      ),
    ).resolves.toBeUndefined();
  });

  it("skips silently when RUNS_SERVICE_URL is missing", async () => {
    delete process.env.RUNS_SERVICE_URL;
    const traceEvent = await loadModule();

    await traceEvent(
      "run-123",
      { service: "press-kits-service", event: "test" },
      {},
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips silently when RUNS_SERVICE_API_KEY is missing", async () => {
    delete process.env.RUNS_SERVICE_API_KEY;
    const traceEvent = await loadModule();

    await traceEvent(
      "run-123",
      { service: "press-kits-service", event: "test" },
      {},
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards only present headers, omits undefined ones", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });
    const traceEvent = await loadModule();

    await traceEvent(
      "run-456",
      { service: "press-kits-service", event: "test" },
      { "x-org-id": "org-1" },
    );

    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers["x-org-id"]).toBe("org-1");
    expect(headers).not.toHaveProperty("x-campaign-id");
    expect(headers).not.toHaveProperty("x-user-id");
    expect(headers).not.toHaveProperty("x-brand-id");
    expect(headers).not.toHaveProperty("x-workflow-slug");
    expect(headers).not.toHaveProperty("x-feature-slug");
  });
});
