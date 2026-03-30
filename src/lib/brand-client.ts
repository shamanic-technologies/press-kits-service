import type { ContextHeaders } from "../middleware/auth.js";
import { buildForwardHeaders } from "../middleware/auth.js";

const BRAND_SERVICE_URL = process.env.BRAND_SERVICE_URL || "http://localhost:3010";
const BRAND_SERVICE_API_KEY = process.env.BRAND_SERVICE_API_KEY || "";

interface BrandInfo {
  id: string;
  domain: string | null;
  name: string | null;
  brandUrl: string | null;
  logoUrl: string | null;
  elevatorPitch: string | null;
  bio: string | null;
  mission: string | null;
  location: string | null;
  categories: string | null;
}

interface ExtractedField {
  key: string;
  value: string | string[] | Record<string, unknown> | null;
  cached: boolean;
}

interface ExtractedImage {
  originalUrl: string;
  permanentUrl: string;
  description: string;
  width: number | null;
  height: number | null;
  format: string;
  sizeBytes: number;
  relevanceScore: number;
  cached: boolean;
}

interface ImageCategory {
  key: string;
  description: string;
  maxCount: number;
}

interface ExtractImagesResult {
  category: string;
  images: ExtractedImage[];
}

/** Fetch basic brand info from brand-service. */
export async function getBrand(brandId: string, ctx?: ContextHeaders): Promise<BrandInfo | null> {
  const headers: Record<string, string> = {
    "x-api-key": BRAND_SERVICE_API_KEY,
  };
  if (ctx) Object.assign(headers, buildForwardHeaders(ctx));

  const response = await fetch(`${BRAND_SERVICE_URL}/brands/${brandId}`, { headers });
  if (response.status === 404) return null;
  if (!response.ok) {
    const text = await response.text();
    console.error(`[press-kits-service] GET /brands/${brandId} failed (${response.status}): ${text}`);
    return null;
  }

  const data = (await response.json()) as { brand: BrandInfo };
  return data.brand;
}

/** Extract detailed fields from a brand via AI (cached 30 days). */
export async function extractBrandFields(
  brandId: string,
  fields: { key: string; description: string }[],
  ctx?: ContextHeaders,
): Promise<ExtractedField[]> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": BRAND_SERVICE_API_KEY,
  };
  if (ctx) Object.assign(headers, buildForwardHeaders(ctx));

  const response = await fetch(`${BRAND_SERVICE_URL}/brands/${brandId}/extract-fields`, {
    method: "POST",
    headers,
    body: JSON.stringify({ fields }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`[press-kits-service] POST /brands/${brandId}/extract-fields failed (${response.status}): ${text}`);
    return [];
  }

  const data = (await response.json()) as { results: ExtractedField[] };
  return data.results;
}

/** Extract brand images by category via AI, with permanent R2 URLs. */
export async function extractBrandImages(
  brandId: string,
  categories: ImageCategory[],
  ctx?: ContextHeaders,
): Promise<ExtractImagesResult[]> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": BRAND_SERVICE_API_KEY,
  };
  if (ctx) Object.assign(headers, buildForwardHeaders(ctx));

  const response = await fetch(`${BRAND_SERVICE_URL}/brands/${brandId}/extract-images`, {
    method: "POST",
    headers,
    body: JSON.stringify({ categories }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`[press-kits-service] POST /brands/${brandId}/extract-images failed (${response.status}): ${text}`);
    return [];
  }

  const data = (await response.json()) as { brandId: string; results: ExtractImagesResult[] };
  return data.results;
}
