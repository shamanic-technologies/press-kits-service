import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import { createTestApp, getAuthHeaders } from "../helpers/test-app.js";
import { cleanTestData, closeDb } from "../helpers/test-db.js";
import { createRun, updateRunStatus } from "../../src/lib/runs-client.js";

const app = createTestApp();
const headers = getAuthHeaders();

const mockCreateRun = vi.mocked(createRun);
const mockUpdateRunStatus = vi.mocked(updateRunStatus);

describe("Run Tracking Middleware", () => {
  beforeEach(async () => {
    await cleanTestData();
    vi.clearAllMocks();
    mockCreateRun.mockResolvedValue({ id: "test-run-id" });
    mockUpdateRunStatus.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  it("creates a run for every authenticated request", async () => {
    await request(app).get("/organizations/exists?orgIds=foo").set(headers);

    expect(mockCreateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "test-org-id",
        userId: "test-user-id",
        serviceName: "press-kits-service",
        parentRunId: "test-run-id",
      })
    );
  });

  it("closes the run on response finish", async () => {
    await request(app).get("/organizations/exists?orgIds=foo").set(headers);

    // Wait for async finish handler
    await new Promise((r) => setTimeout(r, 50));

    expect(mockUpdateRunStatus).toHaveBeenCalledWith(
      "test-run-id",
      "completed",
      expect.anything()
    );
  });

  it("returns 502 when runs-service is unavailable", async () => {
    mockCreateRun.mockRejectedValue(new Error("connection refused"));

    const res = await request(app)
      .get("/organizations/exists?orgIds=foo")
      .set(headers);

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("Run tracking unavailable");
  });

  it("does not track runs for public routes", async () => {
    await request(app).get("/health");

    expect(mockCreateRun).not.toHaveBeenCalled();
  });
});
