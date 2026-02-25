const EMAIL_SERVICE_URL = process.env.TRANSACTIONAL_EMAIL_SERVICE_URL || "http://localhost:3005";
const EMAIL_SERVICE_API_KEY = process.env.TRANSACTIONAL_EMAIL_SERVICE_API_KEY || "";

export async function deployTemplates(
  appId: string,
  templates: Array<{ name: string; subject: string; htmlBody: string; textBody?: string }>
): Promise<void> {
  const response = await fetch(`${EMAIL_SERVICE_URL}/templates`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": EMAIL_SERVICE_API_KEY,
    },
    body: JSON.stringify({ appId, templates }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Email service deploy templates failed (${response.status}): ${text}`);
  }
}

export async function sendEmail(params: {
  appId: string;
  eventType: string;
  clerkOrgId: string;
  metadata: Record<string, string>;
}): Promise<void> {
  const response = await fetch(`${EMAIL_SERVICE_URL}/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": EMAIL_SERVICE_API_KEY,
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Email service send failed (${response.status}): ${text}`);
  }
}
