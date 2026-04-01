import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Must import after mocking fetch
const { extractBrandImages } = await import("../../src/lib/brand-client.js");

describe("extractBrandImages", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns results when brand-service responds with valid data", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        brands: [],
        results: [
          {
            category: "brand",
            images: [
              {
                originalUrl: "https://example.com/img.jpg",
                permanentUrl: "https://r2.example.com/img.jpg",
                description: "Logo",
                width: 200,
                height: 100,
                format: "jpeg",
                sizeBytes: 5000,
                relevanceScore: 0.9,
                cached: false,
              },
            ],
          },
        ],
      }),
    });

    const results = await extractBrandImages([{ key: "brand", description: "Brand images", maxCount: 5 }]);
    expect(results).toHaveLength(1);
    expect(results[0].category).toBe("brand");
    expect(results[0].images).toHaveLength(1);
  });

  it("normalizes missing images array to empty array instead of crashing", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        brands: [],
        results: [
          { category: "brand", images: undefined },
        ],
      }),
    });

    const results = await extractBrandImages([{ key: "brand", description: "Brand images", maxCount: 5 }]);
    expect(results).toHaveLength(1);
    expect(results[0].category).toBe("brand");
    expect(results[0].images).toEqual([]);
  });

  it("returns empty array when brand-service returns no results array at all", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ brands: [] }),
    });

    const results = await extractBrandImages([{ key: "brand", description: "Brand images", maxCount: 5 }]);
    expect(results).toEqual([]);
  });

  it("returns empty array when brand-service responds with non-ok status", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    const results = await extractBrandImages([{ key: "brand", description: "Brand images", maxCount: 5 }]);
    expect(results).toEqual([]);
  });
});
