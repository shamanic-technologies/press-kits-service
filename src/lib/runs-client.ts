const RUNS_SERVICE_URL = process.env.RUNS_SERVICE_URL || "http://localhost:3003";
const RUNS_SERVICE_API_KEY = process.env.RUNS_SERVICE_API_KEY || "";

async function runsRequest<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const { method = "GET", body } = options;
  const response = await fetch(`${RUNS_SERVICE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": RUNS_SERVICE_API_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Runs service ${method} ${path} failed (${response.status}): ${text}`);
  }
  return response.json() as Promise<T>;
}

export async function createRun(params: {
  clerkOrgId: string;
  appId: string;
  serviceName: string;
  taskName: string;
}): Promise<{ id: string }> {
  return runsRequest("/v1/runs", { method: "POST", body: params });
}

export async function updateRunStatus(runId: string, status: "completed" | "failed"): Promise<void> {
  await runsRequest(`/v1/runs/${runId}`, { method: "PATCH", body: { status } });
}

export async function addCosts(
  runId: string,
  items: Array<{ costName: string; quantity: number; status?: string }>
): Promise<void> {
  await runsRequest(`/v1/runs/${runId}/costs`, { method: "POST", body: { items } });
}
