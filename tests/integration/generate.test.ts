import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/index.js";
import { mediaKits } from "../../src/db/schema.js";
import {
  cleanTestData,
  insertTestMediaKit,
  insertTestInstruction,
  closeDb,
} from "../helpers/test-db.js";

// Mock the chat client
const mockComplete = vi.fn();
vi.mock("../../src/lib/chat-client.js", () => ({
  complete: (...args: unknown[]) => mockComplete(...args),
}));

// Mock the brand client
const mockGetBrand = vi.fn();
const mockExtractBrandFields = vi.fn();
const mockExtractBrandImages = vi.fn();
vi.mock("../../src/lib/brand-client.js", () => ({
  getBrand: (...args: unknown[]) => mockGetBrand(...args),
  extractBrandFields: (...args: unknown[]) => mockExtractBrandFields(...args),
  extractBrandImages: (...args: unknown[]) => mockExtractBrandImages(...args),
}));


const { generatePressKit } = await import("../../src/lib/generate.js");

describe("generatePressKit", () => {
  beforeEach(async () => {
    await cleanTestData();
    mockComplete.mockReset();
    mockGetBrand.mockReset();
    mockExtractBrandFields.mockReset();
    mockExtractBrandImages.mockReset();
    mockExtractBrandImages.mockResolvedValue([]);
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  it("generates HTML and updates kit to drafted", async () => {
    const kit = await insertTestMediaKit({
      orgId: "org-gen",
      status: "generating",
    });
    await insertTestInstruction({
      mediaKitId: kit.id,
      instruction: "Create a press kit for Acme Corp",
      instructionType: "initial",
    });

    mockComplete.mockResolvedValue({
      content: '<!DOCTYPE html><html><head><title>Acme Corp Press Kit</title></head><body><h1>Acme Corp</h1><section>Overview content</section></body></html>',
      tokensInput: 100,
      tokensOutput: 200,
      model: "claude-sonnet-4-6",
    });

    await generatePressKit(kit.id);

    const [updated] = await db
      .select()
      .from(mediaKits)
      .where(eq(mediaKits.id, kit.id));

    expect(updated.status).toBe("drafted");
    expect(updated.title).toBe("Acme Corp Press Kit");
    expect(updated.mdxPageContent).toContain("Overview content");

    const callArgs = mockComplete.mock.calls[0][0];
    expect(callArgs.provider).toBe("google");
    expect(callArgs.model).toBe("pro");
    expect(callArgs.maxTokens).toBe(16384);
  });

  it("does nothing when kit is not in generating status", async () => {
    const kit = await insertTestMediaKit({
      orgId: "org-skip",
      status: "drafted",
    });

    await generatePressKit(kit.id);

    const [unchanged] = await db
      .select()
      .from(mediaKits)
      .where(eq(mediaKits.id, kit.id));

    expect(unchanged.status).toBe("drafted");
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("throws when chat service returns empty content", async () => {
    const kit = await insertTestMediaKit({
      orgId: "org-empty",
      status: "generating",
    });
    await insertTestInstruction({
      mediaKitId: kit.id,
      instruction: "Generate something",
      instructionType: "initial",
    });

    mockComplete.mockResolvedValue({
      content: "",
      tokensInput: 10,
      tokensOutput: 0,
      model: "claude-sonnet-4-6",
    });

    await expect(generatePressKit(kit.id)).rejects.toThrow(
      "Chat service returned empty content"
    );
  });

  it("includes existing content in message for edits", async () => {
    const kit = await insertTestMediaKit({
      orgId: "org-edit",
      status: "generating",
      mdxPageContent: "<!DOCTYPE html><html><head><title>Old Kit</title></head><body>Old content here.</body></html>",
    });
    await insertTestInstruction({
      mediaKitId: kit.id,
      instruction: "Add a sustainability section",
      instructionType: "edit",
    });

    mockComplete.mockResolvedValue({
      content: '<!DOCTYPE html><html><head><title>Updated Kit</title></head><body><section>Old content here.</section><section>Sustainability</section></body></html>',
      tokensInput: 100,
      tokensOutput: 200,
      model: "claude-sonnet-4-6",
    });

    await generatePressKit(kit.id);

    const callArgs = mockComplete.mock.calls[0][0];
    expect(callArgs.message).toContain("EXISTING PRESS KIT HTML");
    expect(callArgs.message).toContain("Old content here.");
    expect(callArgs.message).toContain("Add a sustainability section");
    expect(callArgs.systemPrompt).toContain("press kit designer");
  });

  it("includes previous denial feedback in message", async () => {
    await insertTestMediaKit({
      orgId: "org-fb",
      status: "denied",
      denialReason: "Too generic, needs more specifics",
    });

    const kit = await insertTestMediaKit({
      orgId: "org-fb",
      status: "generating",
    });
    await insertTestInstruction({
      mediaKitId: kit.id,
      instruction: "Try again with more detail",
      instructionType: "initial",
    });

    mockComplete.mockResolvedValue({
      content: "# Detailed Press Kit\n\nContent here.",
      tokensInput: 100,
      tokensOutput: 200,
      model: "claude-sonnet-4-6",
    });

    await generatePressKit(kit.id);

    const callArgs = mockComplete.mock.calls[0][0];
    expect(callArgs.message).toContain("PREVIOUS FEEDBACK");
    expect(callArgs.message).toContain("Too generic, needs more specifics");
  });

  it("fetches brand data when brandId is present and includes it in prompt", async () => {
    const brandId = "a6b5fdad-b31d-4fa2-b34b-1cec4cb21ce5";
    const kit = await insertTestMediaKit({
      orgId: "org-brand",
      brandIds: [brandId],
      status: "generating",
    });
    await insertTestInstruction({
      mediaKitId: kit.id,
      instruction: "Generate press kit",
      instructionType: "initial",
    });

    mockGetBrand.mockResolvedValue({
      id: brandId,
      name: "Polarity Course",
      domain: "polaritycourse.com",
      brandUrl: "https://polaritycourse.com",
      elevatorPitch: "Online courses for personal development",
      bio: "Polarity Course is an ed-tech platform.",
      mission: "Empowering learners worldwide",
      location: "San Francisco, CA",
      categories: "Education, E-Learning",
      logoUrl: "https://polaritycourse.com/logo.png",
    });

    mockExtractBrandFields.mockResolvedValue([
      { key: "company_name", value: "Polarity Course", cached: false },
      { key: "founding_year", value: "2021", cached: false },
      { key: "headquarters", value: "San Francisco, CA", cached: false },
      { key: "industry", value: "Education Technology", cached: false },
      { key: "leadership_team", value: "Jane Doe, CEO; John Smith, CTO", cached: false },
      { key: "products_and_services", value: ["Self-paced courses", "Live workshops", "Coaching"], cached: false },
    ]);

    mockComplete.mockResolvedValue({
      content: '<!DOCTYPE html><html><head><title>Polarity Course Press Kit</title></head><body><h1>Polarity Course</h1><section>Polarity Course is an ed-tech platform.</section></body></html>',
      tokensInput: 500,
      tokensOutput: 300,
      model: "claude-sonnet-4-6",
    });

    await generatePressKit(kit.id);

    // Verify brand-service was called
    expect(mockGetBrand).toHaveBeenCalledWith(brandId, undefined);
    expect(mockExtractBrandFields).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ key: "company_name" }),
        expect.objectContaining({ key: "leadership_team" }),
        expect.objectContaining({ key: "products_and_services" }),
      ]),
      undefined,
    );

    // Verify prompt includes brand data
    const callArgs = mockComplete.mock.calls[0][0];
    expect(callArgs.message).toContain("BRAND DATA");
    expect(callArgs.message).toContain("Polarity Course");
    expect(callArgs.message).toContain("polaritycourse.com");
    expect(callArgs.message).toContain("Education Technology");
    expect(callArgs.message).toContain("Jane Doe, CEO");
    expect(callArgs.message).toContain("Self-paced courses");

    // Verify system prompt mentions HTML output
    expect(callArgs.systemPrompt).toContain("Complete HTML Document");

    // Verify kit was updated
    const [updated] = await db
      .select()
      .from(mediaKits)
      .where(eq(mediaKits.id, kit.id));
    expect(updated.status).toBe("drafted");
    expect(updated.title).toBe("Polarity Course Press Kit");
  });

  it("stores brandDomain and iconUrl from brand-service during generation", async () => {
    const brandId = "a6b5fdad-b31d-4fa2-b34b-1cec4cb21ce5";
    const kit = await insertTestMediaKit({
      orgId: "org-logo",
      brandIds: [brandId],
      status: "generating",
    });
    await insertTestInstruction({
      mediaKitId: kit.id,
      instruction: "Generate press kit",
      instructionType: "initial",
    });

    mockGetBrand.mockResolvedValue({
      id: brandId,
      name: "Acme",
      domain: "acme.com",
      brandUrl: "https://acme.com",
      elevatorPitch: null,
      bio: null,
      mission: null,
      location: null,
      categories: null,
      logoUrl: "https://acme.com/logo.png",
    });
    mockExtractBrandFields.mockResolvedValue([]);
    mockComplete.mockResolvedValue({
      content: "# Acme Press Kit\n\n## Overview\n\nAcme is great.",
      tokensInput: 100,
      tokensOutput: 200,
      model: "claude-sonnet-4-6",
    });

    await generatePressKit(kit.id);

    const [updated] = await db
      .select()
      .from(mediaKits)
      .where(eq(mediaKits.id, kit.id));
    expect(updated.brandDomain).toBe("acme.com");
    expect(updated.iconUrl).toBe("https://acme.com/logo.png");
  });

  it("stores brandDomain even when brand has no logoUrl", async () => {
    const brandId = "b2222222-2222-2222-2222-222222222222";
    const kit = await insertTestMediaKit({
      orgId: "org-nologo",
      brandIds: [brandId],
      status: "generating",
    });
    await insertTestInstruction({
      mediaKitId: kit.id,
      instruction: "Generate press kit",
      instructionType: "initial",
    });

    mockGetBrand.mockResolvedValue({
      id: brandId,
      name: "NoLogo Corp",
      domain: "nologo.com",
      brandUrl: "https://nologo.com",
      elevatorPitch: null,
      bio: null,
      mission: null,
      location: null,
      categories: null,
      logoUrl: null,
    });
    mockExtractBrandFields.mockResolvedValue([]);
    mockComplete.mockResolvedValue({
      content: "# NoLogo Corp\n\n## Overview\n\nContent.",
      tokensInput: 100,
      tokensOutput: 200,
      model: "claude-sonnet-4-6",
    });

    await generatePressKit(kit.id);

    const [updated] = await db
      .select()
      .from(mediaKits)
      .where(eq(mediaKits.id, kit.id));
    expect(updated.status).toBe("drafted");
    expect(updated.brandDomain).toBe("nologo.com");
    expect(updated.iconUrl).toBeNull();
  });

  it("skips brand fetch when no brandIds and still generates", async () => {
    const kit = await insertTestMediaKit({
      orgId: "org-no-brand",
      status: "generating",
    });
    await insertTestInstruction({
      mediaKitId: kit.id,
      instruction: "Generate a generic press kit",
      instructionType: "initial",
    });

    mockComplete.mockResolvedValue({
      content: "# Press Kit\n\n## Overview\n\nGeneric content.",
      tokensInput: 50,
      tokensOutput: 100,
      model: "claude-sonnet-4-6",
    });

    await generatePressKit(kit.id);

    expect(mockGetBrand).not.toHaveBeenCalled();
    expect(mockExtractBrandFields).not.toHaveBeenCalled();

    const callArgs = mockComplete.mock.calls[0][0];
    expect(callArgs.message).not.toContain("BRAND DATA");
  });

  it("handles brand-service failure gracefully and still generates", async () => {
    const brandId = "b1111111-1111-1111-1111-111111111111";
    const kit = await insertTestMediaKit({
      orgId: "org-brand-fail",
      brandIds: [brandId],
      status: "generating",
    });
    await insertTestInstruction({
      mediaKitId: kit.id,
      instruction: "Generate press kit",
      instructionType: "initial",
    });

    // Brand service returns null/empty
    mockGetBrand.mockResolvedValue(null);
    mockExtractBrandFields.mockResolvedValue([]);

    mockComplete.mockResolvedValue({
      content: "# Press Kit\n\n## Overview\n\nContent here.",
      tokensInput: 50,
      tokensOutput: 100,
      model: "claude-sonnet-4-6",
    });

    await generatePressKit(kit.id);

    // Should still generate even without brand data
    const [updated] = await db
      .select()
      .from(mediaKits)
      .where(eq(mediaKits.id, kit.id));
    expect(updated.status).toBe("drafted");

    // Brand data section should not be in the prompt
    const callArgs = mockComplete.mock.calls[0][0];
    expect(callArgs.message).not.toContain("BRAND DATA");
  });

  it("fetches brand images and includes permanent URLs in prompt", async () => {
    const brandId = "c2222222-2222-2222-2222-222222222222";
    const kit = await insertTestMediaKit({
      orgId: "org-images",
      brandIds: [brandId],
      status: "generating",
    });
    await insertTestInstruction({
      mediaKitId: kit.id,
      instruction: "Generate press kit with images",
      instructionType: "initial",
    });

    mockGetBrand.mockResolvedValue({
      id: brandId,
      name: "ImageCo",
      domain: "imageco.com",
      brandUrl: "https://imageco.com",
      elevatorPitch: null,
      bio: null,
      mission: null,
      location: null,
      categories: null,
      logoUrl: null,
    });

    mockExtractBrandFields.mockResolvedValue([
      { key: "company_name", value: "ImageCo", cached: false },
    ]);

    mockExtractBrandImages.mockResolvedValue([
      {
        category: "logo",
        images: [
          {
            originalUrl: "https://imageco.com/logo.png",
            permanentUrl: "https://r2.distribute.you/brands/imageco/logo.png",
            description: "ImageCo primary logo",
            width: 512,
            height: 512,
            format: "png",
            sizeBytes: 24000,
            relevanceScore: 0.98,
            cached: false,
          },
        ],
      },
      {
        category: "product",
        images: [
          {
            originalUrl: "https://imageco.com/product-shot.jpg",
            permanentUrl: "https://r2.distribute.you/brands/imageco/product-shot.jpg",
            description: "ImageCo dashboard screenshot",
            width: 1920,
            height: 1080,
            format: "jpeg",
            sizeBytes: 150000,
            relevanceScore: 0.92,
            cached: false,
          },
        ],
      },
      {
        category: "team",
        images: [],
      },
    ]);

    mockComplete.mockResolvedValue({
      content: "# ImageCo Press Kit\n\n![ImageCo primary logo](https://r2.distribute.you/brands/imageco/logo.png)\n\n## Overview\n\nImageCo builds great products.",
      tokensInput: 600,
      tokensOutput: 400,
      model: "claude-sonnet-4-6",
    });

    await generatePressKit(kit.id);

    // Verify extract-images was called with the right categories (headerless multi-brand endpoint)
    expect(mockExtractBrandImages).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ key: "logo", maxCount: 2 }),
        expect.objectContaining({ key: "product", maxCount: 5 }),
        expect.objectContaining({ key: "team", maxCount: 3 }),
      ]),
      undefined,
    );

    // Verify prompt includes image URLs
    const callArgs = mockComplete.mock.calls[0][0];
    expect(callArgs.message).toContain("BRAND IMAGES");
    expect(callArgs.message).toContain("https://r2.distribute.you/brands/imageco/logo.png");
    expect(callArgs.message).toContain("ImageCo primary logo");
    expect(callArgs.message).toContain("https://r2.distribute.you/brands/imageco/product-shot.jpg");
    expect(callArgs.message).toContain("ImageCo dashboard screenshot");
    expect(callArgs.message).toContain("512x512");
    // Empty category (team) should not appear
    expect(callArgs.message).not.toContain("Category: team");

    // Verify system prompt mentions brand images
    expect(callArgs.systemPrompt).toContain("BRAND IMAGES");

    // Verify kit was updated
    const [updated] = await db
      .select()
      .from(mediaKits)
      .where(eq(mediaKits.id, kit.id));
    expect(updated.status).toBe("drafted");
  });

  it("generates without images when extract-images returns empty", async () => {
    const brandId = "d3333333-3333-3333-3333-333333333333";
    const kit = await insertTestMediaKit({
      orgId: "org-no-images",
      brandIds: [brandId],
      status: "generating",
    });
    await insertTestInstruction({
      mediaKitId: kit.id,
      instruction: "Generate press kit",
      instructionType: "initial",
    });

    mockGetBrand.mockResolvedValue({
      id: brandId,
      name: "NoImgCo",
      domain: "noimgco.com",
      brandUrl: "https://noimgco.com",
      elevatorPitch: null,
      bio: null,
      mission: null,
      location: null,
      categories: null,
      logoUrl: null,
    });

    mockExtractBrandFields.mockResolvedValue([]);
    mockExtractBrandImages.mockResolvedValue([]);

    mockComplete.mockResolvedValue({
      content: "# NoImgCo Press Kit\n\n## Overview\n\nContent here.",
      tokensInput: 50,
      tokensOutput: 100,
      model: "claude-sonnet-4-6",
    });

    await generatePressKit(kit.id);

    const callArgs = mockComplete.mock.calls[0][0];
    expect(callArgs.message).not.toContain("BRAND IMAGES");

    const [updated] = await db
      .select()
      .from(mediaKits)
      .where(eq(mediaKits.id, kit.id));
    expect(updated.status).toBe("drafted");
  });
});
