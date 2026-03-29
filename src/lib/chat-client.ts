import type { ContextHeaders } from "../middleware/auth.js";
import { buildForwardHeaders } from "../middleware/auth.js";

const CHAT_SERVICE_URL = process.env.CHAT_SERVICE_URL || "http://localhost:3007";
const CHAT_SERVICE_API_KEY = process.env.CHAT_SERVICE_API_KEY || "";

interface CompleteResponse {
  content: string;
  tokensInput: number;
  tokensOutput: number;
  model: string;
}

export async function complete(
  params: {
    message: string;
    systemPrompt: string;
    maxTokens?: number;
    temperature?: number;
  },
  ctx?: ContextHeaders
): Promise<CompleteResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": CHAT_SERVICE_API_KEY,
  };
  if (ctx) {
    Object.assign(headers, buildForwardHeaders(ctx));
  }

  const response = await fetch(`${CHAT_SERVICE_URL}/complete`, {
    method: "POST",
    headers,
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Chat service POST /complete failed (${response.status}): ${text}`
    );
  }

  return response.json() as Promise<CompleteResponse>;
}
