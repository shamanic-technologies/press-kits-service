const KEY_SERVICE_URL = process.env.KEY_SERVICE_URL || "http://localhost:3004";
const KEY_SERVICE_API_KEY = process.env.KEY_SERVICE_API_KEY || "";

export async function registerAppKey(appId: string, provider: string, apiKey: string): Promise<void> {
  const response = await fetch(`${KEY_SERVICE_URL}/internal/app-keys`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": KEY_SERVICE_API_KEY,
    },
    body: JSON.stringify({ appId, provider, apiKey }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Key service register failed (${response.status}): ${text}`);
  }
}
