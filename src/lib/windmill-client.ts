const WORKFLOW_SERVICE_URL = process.env.WORKFLOW_SERVICE_URL || "http://localhost:3002";
const WORKFLOW_SERVICE_API_KEY = process.env.WORKFLOW_SERVICE_API_KEY || "";

async function workflowRequest<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const { method = "GET", body } = options;
  const response = await fetch(`${WORKFLOW_SERVICE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": WORKFLOW_SERVICE_API_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Workflow service ${method} ${path} failed (${response.status}): ${text}`);
  }
  return response.json() as Promise<T>;
}

export async function deployWorkflows(appId: string, workflows: unknown[]): Promise<void> {
  await workflowRequest("/workflows/deploy", {
    method: "PUT",
    body: { appId, workflows },
  });
}

export async function executeWorkflowByName(
  name: string,
  appId: string,
  inputs: Record<string, unknown>,
  runId?: string
): Promise<{ workflowRunId: string }> {
  return workflowRequest(`/workflows/by-name/${encodeURIComponent(name)}/execute`, {
    method: "POST",
    body: { appId, inputs, runId },
  });
}
