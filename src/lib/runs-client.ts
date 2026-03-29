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

export async function createRun(params: {
  orgId: string;
  userId?: string;
  serviceName: string;
  taskName: string;
  parentRunId?: string;
  ctx?: ContextHeaders;
}): Promise<{ id: string }> {
  const { ctx, ...body } = params;
  return runsRequest("/v1/runs", { method: "POST", body, ctx });
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

export async function batchGetCosts(
  runIds: string[],
  ctx?: ContextHeaders
): Promise<RunCost[]> {
  if (runIds.length === 0) return [];
  const result = await runsRequest<{ costs: RunCost[] }>(
    "/v1/runs/costs/batch",
    { method: "POST", body: { runIds }, ctx }
  );
  return result.costs;
}
