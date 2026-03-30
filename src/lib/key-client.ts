const KEY_SERVICE_URL = process.env.KEY_SERVICE_URL || "http://localhost:3001";
const KEY_SERVICE_API_KEY = process.env.KEY_SERVICE_API_KEY || "";

/** In-memory cache for platform keys: provider → { key, expiresAt } */
const cache = new Map<string, { key: string; expiresAt: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Fetches a decrypted platform key from key-service.
 * Cached in-memory for 10 minutes. Returns null if the key is not configured.
 */
export async function getPlatformKey(provider: string): Promise<string | null> {
  const cached = cache.get(provider);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.key;
  }

  const url = `${KEY_SERVICE_URL}/keys/platform/${encodeURIComponent(provider)}/decrypt`;
  console.log(`[press-kits-service] Fetching platform key for provider=${provider}`);

  const response = await fetch(url, {
    headers: {
      "x-api-key": KEY_SERVICE_API_KEY,
      "x-caller-service": "press-kits-service",
    },
  });

  if (response.status === 404) {
    console.warn(`[press-kits-service] Platform key not found for provider=${provider}`);
    return null;
  }

  if (!response.ok) {
    console.error(`[press-kits-service] Failed to fetch platform key for provider=${provider}: ${response.status}`);
    return null;
  }

  const body = (await response.json()) as { provider: string; key: string };
  cache.set(provider, { key: body.key, expiresAt: Date.now() + CACHE_TTL_MS });
  console.log(`[press-kits-service] Platform key cached for provider=${provider}`);
  return body.key;
}
