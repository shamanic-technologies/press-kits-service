import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { mediaKits, mediaKitInstructions } from "../db/schema.js";
import { complete } from "./chat-client.js";
import { getBrand, extractBrandFields, extractBrandImages } from "./brand-client.js";
import type { ContextHeaders } from "../middleware/auth.js";

const SYSTEM_PROMPT = [
  "You are a professional press kit writer. Generate a press kit in MDX format.",
  "The output must be valid MDX that can be rendered directly. Include sections like: Company Overview, Key Facts, Leadership, Products/Services, Awards & Recognition, Company Milestones, Press & Media Assets, Press Contacts.",
  "Use markdown headings (##), bold text, and bullet points for readability.",
  "Do NOT include import statements or JSX components — only standard markdown syntax.",
  "Use the brand data provided below to fill in ALL details. NEVER use placeholder brackets like [Brand Name] or [Year] — if a piece of information is not available, omit that line entirely rather than using a placeholder.",
  "When brand images are provided, embed them in relevant sections using standard markdown image syntax: ![description](url). Place logos near the top, product images in the Products/Services section, team photos in the Leadership section, and other images where contextually appropriate. Use the provided descriptions as alt text.",
  "Output ONLY the MDX content, no explanations or wrapping.",
].join("\n");

/** Fields to extract from brand-service for press kit generation. */
const PRESS_KIT_FIELDS = [
  { key: "company_name", description: "The official company or brand name" },
  { key: "founding_year", description: "The year the company was founded" },
  { key: "headquarters", description: "City, state/country where the company is headquartered" },
  { key: "industry", description: "The primary industry or sector the company operates in" },
  { key: "company_size", description: "Number of employees or team size" },
  { key: "annual_revenue", description: "Annual revenue figure or range, if publicly available" },
  { key: "markets_served", description: "Geographic markets or regions the company serves" },
  { key: "website_url", description: "The company's main website URL" },
  { key: "social_media", description: "Social media handles/URLs (LinkedIn, Twitter/X, Instagram, Facebook, etc.)" },
  { key: "leadership_team", description: "Key executives and founders with their titles, bios, and backgrounds" },
  { key: "products_and_services", description: "Main products or services offered, with descriptions, key features, and target audiences" },
  { key: "value_proposition", description: "The company's unique value proposition or competitive advantage" },
  { key: "awards_and_recognition", description: "Awards, certifications, press mentions, or notable recognitions" },
  { key: "company_milestones", description: "Key milestones in the company's history (founding, product launches, funding rounds, expansions)" },
  { key: "press_contact", description: "Press or media contact information (name, email, phone)" },
  { key: "notable_clients_or_partners", description: "Notable clients, partners, or case studies" },
  { key: "funding_info", description: "Funding rounds, investors, or financial backing information" },
];

/** Image categories to extract from brand-service for press kit visuals. */
const PRESS_KIT_IMAGE_CATEGORIES = [
  { key: "logo", description: "Company logo (primary, high resolution)", maxCount: 2 },
  { key: "product", description: "Product screenshots, UI mockups, or product photos", maxCount: 5 },
  { key: "team", description: "Team photos, headshots of leadership or founders", maxCount: 3 },
  { key: "office", description: "Office, workspace, or company environment photos", maxCount: 2 },
  { key: "brand", description: "Brand imagery, lifestyle photos, or marketing visuals", maxCount: 3 },
];

interface GenerationData {
  currentKit: {
    id: string;
    orgId: string;
    title: string | null;
    mdxPageContent: string | null;
    brandId: string | null;
    campaignId: string | null;
  };
  instructions: { instruction: string; instructionType: string }[];
  feedbacks: { denialReason: string }[];
}

async function fetchGenerationData(mediaKitId: string): Promise<GenerationData | null> {
  const kit = await db.query.mediaKits.findFirst({
    where: and(
      eq(mediaKits.id, mediaKitId),
      eq(mediaKits.status, "generating"),
    ),
  });
  if (!kit) return null;

  const instructions = await db
    .select()
    .from(mediaKitInstructions)
    .where(eq(mediaKitInstructions.mediaKitId, kit.id))
    .orderBy(mediaKitInstructions.createdAt);

  const feedbackConditions = [
    eq(mediaKits.orgId, kit.orgId),
    eq(mediaKits.status, "denied"),
  ];
  if (kit.campaignId) {
    feedbackConditions.push(eq(mediaKits.campaignId, kit.campaignId));
  }

  const feedbackResults = await db
    .select({ denialReason: mediaKits.denialReason })
    .from(mediaKits)
    .where(and(...feedbackConditions))
    .orderBy(desc(mediaKits.updatedAt));

  return {
    currentKit: {
      id: kit.id,
      orgId: kit.orgId,
      title: kit.title,
      mdxPageContent: kit.mdxPageContent,
      brandId: kit.brandId,
      campaignId: kit.campaignId,
    },
    instructions: instructions.map((i) => ({
      instruction: i.instruction,
      instructionType: i.instructionType,
    })),
    feedbacks: feedbackResults
      .filter((r) => r.denialReason !== null)
      .map((r) => ({ denialReason: r.denialReason! })),
  };
}

function formatFieldValue(value: string | string[] | Record<string, unknown> | null): string {
  if (value === null || value === undefined) return "N/A";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  return JSON.stringify(value, null, 2);
}

async function fetchBrandContext(brandId: string, ctx?: ContextHeaders): Promise<string | null> {
  console.log(`[press-kits-service] Fetching brand data for brandId=${brandId}`);

  // Fetch basic brand info, extracted fields, and images in parallel
  const [brand, extractedFields, imageResults] = await Promise.all([
    getBrand(brandId, ctx),
    extractBrandFields(brandId, PRESS_KIT_FIELDS, ctx),
    extractBrandImages(brandId, PRESS_KIT_IMAGE_CATEGORIES, ctx),
  ]);

  if (!brand && extractedFields.length === 0 && imageResults.length === 0) {
    console.warn(`[press-kits-service] No brand data found for brandId=${brandId}`);
    return null;
  }

  const parts: string[] = ["--- BRAND DATA (use this to write the press kit) ---"];

  // Basic brand info from brand-service
  if (brand) {
    if (brand.name) parts.push(`Brand Name: ${brand.name}`);
    if (brand.domain) parts.push(`Domain: ${brand.domain}`);
    if (brand.brandUrl) parts.push(`Website: ${brand.brandUrl}`);
    if (brand.elevatorPitch) parts.push(`Elevator Pitch: ${brand.elevatorPitch}`);
    if (brand.bio) parts.push(`Bio: ${brand.bio}`);
    if (brand.mission) parts.push(`Mission: ${brand.mission}`);
    if (brand.location) parts.push(`Location: ${brand.location}`);
    if (brand.categories) parts.push(`Categories: ${brand.categories}`);
    if (brand.logoUrl) parts.push(`Logo URL: ${brand.logoUrl}`);
    parts.push("");
  }

  // AI-extracted detailed fields
  if (extractedFields.length > 0) {
    parts.push("--- DETAILED BRAND INFORMATION (AI-extracted from website) ---");
    for (const field of extractedFields) {
      if (field.value !== null && field.value !== undefined) {
        const label = field.key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        parts.push(`${label}: ${formatFieldValue(field.value)}`);
      }
    }
    parts.push("--- END DETAILED BRAND INFORMATION ---");
    parts.push("");
  }

  // Brand images with permanent URLs
  const totalImages = imageResults.reduce((sum, r) => sum + r.images.length, 0);
  if (totalImages > 0) {
    parts.push("--- BRAND IMAGES (use these permanent URLs in the press kit) ---");
    for (const result of imageResults) {
      if (result.images.length === 0) continue;
      parts.push(`\nCategory: ${result.category}`);
      for (const img of result.images) {
        parts.push(`- ![${img.description}](${img.permanentUrl})`);
        if (img.width && img.height) {
          parts.push(`  Dimensions: ${img.width}x${img.height}, Format: ${img.format}`);
        }
      }
    }
    parts.push("--- END BRAND IMAGES ---");
    parts.push("");
  }

  parts.push("--- END BRAND DATA ---");

  console.log(`[press-kits-service] Brand data fetched: ${brand ? "basic info ✓" : "basic info ✗"}, ${extractedFields.filter((f) => f.value !== null).length}/${extractedFields.length} fields extracted, ${totalImages} images`);

  return parts.join("\n");
}

function buildMessage(data: GenerationData, brandContext: string | null): string {
  const parts: string[] = [];

  // Brand context first — this is the most important input
  if (brandContext) {
    parts.push(brandContext, "");
  }

  if (data.currentKit.mdxPageContent) {
    parts.push(
      "--- EXISTING PRESS KIT CONTENT (use as base, apply edits requested below) ---",
      data.currentKit.mdxPageContent,
      "--- END EXISTING CONTENT ---",
      "",
    );
  }

  if (data.instructions.length > 0) {
    parts.push("--- USER INSTRUCTIONS ---");
    for (const inst of data.instructions) {
      parts.push(`[${inst.instructionType}] ${inst.instruction}`);
    }
    parts.push("--- END INSTRUCTIONS ---", "");
  }

  if (data.feedbacks.length > 0) {
    parts.push("--- PREVIOUS FEEDBACK (avoid these issues) ---");
    for (const fb of data.feedbacks) {
      parts.push(`- ${fb.denialReason}`);
    }
    parts.push("--- END FEEDBACK ---", "");
  }

  parts.push("Generate the full press kit MDX content now. Use the brand data above to fill in all real details. Do not use any placeholders.");

  return parts.join("\n");
}

function extractTitle(mdx: string): string {
  const h1 = mdx.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  const h2 = mdx.match(/^##\s+(.+)$/m);
  if (h2) return h2[1].trim();
  return "Press Kit";
}

export async function generatePressKit(mediaKitId: string, ctx?: ContextHeaders): Promise<void> {
  const data = await fetchGenerationData(mediaKitId);
  if (!data) {
    console.error(`[press-kits-service] Generation: kit ${mediaKitId} not found or not in generating status`);
    return;
  }

  console.log(`[press-kits-service] Starting generation for kit ${mediaKitId}`);

  // Fetch brand context if brandId is available
  let brandContext: string | null = null;
  if (data.currentKit.brandId) {
    brandContext = await fetchBrandContext(data.currentKit.brandId, ctx);
  } else {
    console.warn(`[press-kits-service] No brandId on kit ${mediaKitId} — generating without brand data`);
  }

  const message = buildMessage(data, brandContext);

  // Resolve brand domain and logo URL from brand-service
  let brandDomain: string | null = null;
  let logoUrl: string | null = null;
  if (data.currentKit.brandId) {
    const brand = await getBrand(data.currentKit.brandId, ctx);
    if (brand) {
      brandDomain = brand.domain;
      logoUrl = brand.logoUrl;
    }
  }

  const result = await complete(
    {
      message,
      systemPrompt: SYSTEM_PROMPT,
      maxTokens: 8192,
    },
    ctx,
  );

  const mdxContent = result.content;
  if (!mdxContent.trim()) {
    throw new Error("Chat service returned empty content");
  }

  const title = extractTitle(mdxContent);

  await db
    .update(mediaKits)
    .set({
      mdxPageContent: mdxContent,
      title,
      status: "drafted",
      updatedAt: new Date(),
      ...(brandDomain ? { brandDomain } : {}),
      ...(logoUrl ? { iconUrl: logoUrl } : {}),
    })
    .where(eq(mediaKits.id, mediaKitId));

  console.log(`[press-kits-service] Generation complete for kit ${mediaKitId}, title: "${title}"`);
}
