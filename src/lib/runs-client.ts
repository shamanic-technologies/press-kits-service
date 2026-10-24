import type { ContextHeaders } from "../middleware/auth.js";
import { buildForwardHeaders } from "../middleware/auth.js";

const RUNS_SERVICE_URL = process.env.RUNS_SERVICE_URL || "http://localhost:3003";
const RUNS_SERVICE_API_KEY = process.env.RUNS_SERVICE_API_KEY || "";

async function runsRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; ctx?: ContextHeaders } = {}
): Promise<T> {
  const { method = "GET", body, ctx } = options;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-API-Key": RUNS_SERVICE_API_KEY,
  };
  if (ctx) {
    Object.assign(headers, buildForwardHeaders(ctx));
  }

  const response = await fetch(`${RUNS_SERVICE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Runs service ${method} ${path} failed (${response.status}): ${text}`);
  }
  return response.json() as Promise<T>;
}

/**
 * Every run this service opens is SUPPORT spend, marked at creation (LEDGER-HISTORY-1024, cost-accounting doctrine):
 * a press kit is consumed by no catalogue pipe, so it is no outcome occurrence (a new outcome is a feature request built
 * with the pipe that consumes it, never a bare catalogue row). The runs' spend is stated apart as `product_feature`
 * instead of riding any outcome. Past runs were marked `retired_product` through runs-service's owner support-mark door
 * (the service has had no container since the 2026-08 migration). Marking twice is idempotent at runs-service.
 */
export const RUN_SUPPORT = {
  kind: "product_feature",
  reason: "Press kit page generation: a press kit is consumed by no catalogue pipe, so its spend is support (LEDGER-HISTORY-1024).",
} as const;

export async function createRun(params: {
  orgId: string;
  userId?: string;
  serviceName: string;
  taskName: string;
  parentRunId?: string;
  ctx?: ContextHeaders;
}): Promise<{ id: string }> {
  const { ctx, ...rest } = params;
  return runsRequest("/v1/runs", { method: "POST", body: { ...rest, support: RUN_SUPPORT }, ctx });
}

export async function updateRunStatus(
  runId: string,
  status: "completed" | "failed",
  ctx?: ContextHeaders
): Promise<void> {
  await runsRequest(`/v1/runs/${runId}`, { method: "PATCH", body: { status }, ctx });
}

export async function addCosts(
  runId: string,
  items: Array<{ costName: string; quantity: number; costSource: "platform" | "org"; status?: string }>,
  ctx?: ContextHeaders
): Promise<void> {
  await runsRequest(`/v1/runs/${runId}/costs`, { method: "POST", body: { items }, ctx });
}

export interface RunCost {
  runId: string;
  totalCostInUsdCents: string;
  actualCostInUsdCents: string;
  provisionedCostInUsdCents: string;
}

const BATCH_CHUNK_SIZE = 500;

export async function batchGetCosts(
  runIds: string[],
  ctx?: ContextHeaders
): Promise<RunCost[]> {
  if (runIds.length === 0) return [];

  const allCosts: RunCost[] = [];
  for (let i = 0; i < runIds.length; i += BATCH_CHUNK_SIZE) {
    const chunk = runIds.slice(i, i + BATCH_CHUNK_SIZE);
    const result = await runsRequest<{ costs: RunCost[] }>(
      "/v1/runs/costs/batch",
      { method: "POST", body: { runIds: chunk }, ctx }
    );
    allCosts.push(...result.costs);
  }
  return allCosts;
}
