import type { ContextHeaders } from "../middleware/auth.js";
import { buildForwardHeaders } from "../middleware/auth.js";

const EMAIL_SERVICE_URL = process.env.TRANSACTIONAL_EMAIL_SERVICE_URL || "http://localhost:3005";
const EMAIL_SERVICE_API_KEY = process.env.TRANSACTIONAL_EMAIL_SERVICE_API_KEY || "";

export async function deployTemplates(
  templates: Array<{ name: string; subject: string; htmlBody: string; textBody?: string }>
): Promise<void> {
  const response = await fetch(`${EMAIL_SERVICE_URL}/templates`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": EMAIL_SERVICE_API_KEY,
    },
    body: JSON.stringify({ templates }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Email service deploy templates failed (${response.status}): ${text}`);
  }
}

export async function sendEmail(
  params: {
    eventType: string;
    orgId: string;
    metadata: Record<string, string>;
  },
  ctx?: ContextHeaders
): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": EMAIL_SERVICE_API_KEY,
  };
  if (ctx) {
    Object.assign(headers, buildForwardHeaders(ctx));
  }

  const response = await fetch(`${EMAIL_SERVICE_URL}/send`, {
    method: "POST",
    headers,
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Email service send failed (${response.status}): ${text}`);
  }
}
