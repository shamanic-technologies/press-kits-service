import type { ContextHeaders } from "../middleware/auth.js";
import { buildForwardHeaders } from "../middleware/auth.js";

const BILLING_SERVICE_URL = process.env.BILLING_SERVICE_URL || "http://localhost:3012";
const BILLING_SERVICE_API_KEY = process.env.BILLING_SERVICE_API_KEY || "";

export interface AuthorizeResult {
  sufficient: boolean;
  balance_cents: number;
  required_cents: number;
}

export async function authorizeBilling(
  items: Array<{ costName: string; quantity: number }>,
  ctx: ContextHeaders
): Promise<AuthorizeResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": BILLING_SERVICE_API_KEY,
    ...buildForwardHeaders(ctx),
  };

  const response = await fetch(`${BILLING_SERVICE_URL}/v1/credits/authorize`, {
    method: "POST",
    headers,
    body: JSON.stringify({ items }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Billing service authorize failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<AuthorizeResult>;
}
