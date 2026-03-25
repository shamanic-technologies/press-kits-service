import { vi } from "vitest";

process.env.PRESS_KITS_SERVICE_DATABASE_URL =
  process.env.PRESS_KITS_SERVICE_DATABASE_URL ?? "postgresql://test:test@localhost:5432/press_kits_test";
process.env.PRESS_KITS_SERVICE_API_KEY = "test-api-key";
process.env.NODE_ENV = "test";

vi.mock("../src/lib/runs-client.js", () => ({
  createRun: vi.fn().mockResolvedValue({ id: "test-run-id" }),
  updateRunStatus: vi.fn().mockResolvedValue(undefined),
  addCosts: vi.fn().mockResolvedValue(undefined),
}));
