import type { ContextHeaders } from "../middleware/auth.js";
import { buildForwardHeaders } from "../middleware/auth.js";

const WORKFLOW_SERVICE_URL = process.env.WORKFLOW_SERVICE_URL || "http://localhost:3004";
const WORKFLOW_SERVICE_API_KEY = process.env.WORKFLOW_SERVICE_API_KEY || "";

/**
 * Resolve a workflow dynasty slug to all versioned workflow slugs.
 * Calls GET /workflows/dynasty/slugs?dynastySlug=X on workflow-service.
 */
export async function resolveWorkflowDynastySlugs(
  dynastySlug: string,
  ctx?: ContextHeaders
): Promise<string[]> {
  const headers: Record<string, string> = {
    "X-API-Key": WORKFLOW_SERVICE_API_KEY,
  };
  if (ctx) Object.assign(headers, buildForwardHeaders(ctx));

  const url = `${WORKFLOW_SERVICE_URL}/workflows/dynasty/slugs?workflowDynastySlug=${encodeURIComponent(dynastySlug)}`;
  const response = await fetch(url, { headers });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`[press-kits-service] workflow-service GET /workflows/dynasty/slugs failed (${response.status}): ${text}`);
  }

  const body = (await response.json()) as { workflowDynastySlug: string; workflowDynastyName: string; workflowSlugs: string[] };
  return body.workflowSlugs;
}
