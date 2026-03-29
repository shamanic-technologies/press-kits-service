import type { ContextHeaders } from "../middleware/auth.js";
import { buildForwardHeaders } from "../middleware/auth.js";

const CONTENT_GENERATION_SERVICE_URL =
  process.env.CONTENT_GENERATION_SERVICE_URL || "http://localhost:3006";
const CONTENT_GENERATION_SERVICE_API_KEY =
  process.env.CONTENT_GENERATION_SERVICE_API_KEY || "";

interface GenerateResponse {
  id: string;
  subject: string;
  sequence: Array<{
    step: number;
    bodyHtml: string;
    bodyText: string;
    daysSinceLastStep: number;
  }>;
  tokensInput: number;
  tokensOutput: number;
}

export async function deployPrompts(
  prompts: Array<{ type: string; prompt: string; variables: string[] }>
): Promise<void> {
  for (const p of prompts) {
    const response = await fetch(
      `${CONTENT_GENERATION_SERVICE_URL}/platform-prompts`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": CONTENT_GENERATION_SERVICE_API_KEY,
        },
        body: JSON.stringify(p),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Content generation service deploy prompt "${p.type}" failed (${response.status}): ${text}`
      );
    }
  }
}

export async function generate(
  params: {
    type: string;
    variables: Record<string, string | null>;
    brandId?: string;
    campaignId?: string;
    featureSlug?: string;
  },
  ctx?: ContextHeaders
): Promise<GenerateResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": CONTENT_GENERATION_SERVICE_API_KEY,
  };
  if (ctx) {
    Object.assign(headers, buildForwardHeaders(ctx));
  }

  const response = await fetch(
    `${CONTENT_GENERATION_SERVICE_URL}/generate`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: params.type,
        variables: params.variables,
        brandId: params.brandId,
        campaignId: params.campaignId,
        featureSlug: params.featureSlug,
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Content generation service POST /generate failed (${response.status}): ${text}`
    );
  }

  return response.json() as Promise<GenerateResponse>;
}
