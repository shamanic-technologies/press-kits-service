import type { ContextHeaders } from "../middleware/auth.js";
import { buildForwardHeaders } from "../middleware/auth.js";

const BRAND_SERVICE_URL = process.env.BRAND_SERVICE_URL || "http://localhost:3006";
const BRAND_SERVICE_API_KEY = process.env.BRAND_SERVICE_API_KEY || "";

interface Brand {
  id: string;
  domain: string | null;
  brandUrl: string | null;
  name: string | null;
}

export async function getBrandDomain(
  brandId: string,
  ctx?: ContextHeaders
): Promise<string | null> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": BRAND_SERVICE_API_KEY,
  };
  if (ctx) {
    Object.assign(headers, buildForwardHeaders(ctx));
  }

  const response = await fetch(`${BRAND_SERVICE_URL}/brands/${brandId}`, {
    method: "GET",
    headers,
  });

  if (!response.ok) {
    console.error(`[brand-client] GET /brands/${brandId} failed (${response.status})`);
    return null;
  }

  const data = (await response.json()) as { brand: Brand };
  return data.brand.brandUrl ?? data.brand.domain ?? null;
}
