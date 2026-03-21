import type { ContextHeaders } from "../middleware/auth.js";
import { buildForwardHeaders } from "../middleware/auth.js";

const WORKFLOW_SERVICE_URL = process.env.WORKFLOW_SERVICE_URL || "http://localhost:3002";
const WORKFLOW_SERVICE_API_KEY = process.env.WORKFLOW_SERVICE_API_KEY || "";

async function workflowRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; ctx?: ContextHeaders } = {}
): Promise<T> {
  const { method = "GET", body, ctx } = options;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": WORKFLOW_SERVICE_API_KEY,
  };
  if (ctx) {
    Object.assign(headers, buildForwardHeaders(ctx));
  }

  const response = await fetch(`${WORKFLOW_SERVICE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Workflow service ${method} ${path} failed (${response.status}): ${text}`);
  }
  return response.json() as Promise<T>;
}

export async function deployWorkflows(workflows: unknown[]): Promise<void> {
  await workflowRequest("/workflows/deploy", {
    method: "PUT",
    body: { workflows },
  });
}

export async function executeWorkflowByName(
  name: string,
  inputs: Record<string, unknown>,
  runId?: string,
  ctx?: ContextHeaders
): Promise<{ workflowRunId: string }> {
  return workflowRequest(`/workflows/by-name/${encodeURIComponent(name)}/execute`, {
    method: "POST",
    body: { inputs, runId },
    ctx,
  });
}
