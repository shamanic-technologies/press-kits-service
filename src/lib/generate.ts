import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { mediaKits, mediaKitInstructions } from "../db/schema.js";
import { complete } from "./chat-client.js";
import { getBrand, extractBrandFields, extractBrandImages } from "./brand-client.js";
import type { ContextHeaders } from "../middleware/auth.js";

function buildSystemPrompt(brandColors?: { primary?: string; accent?: string }): string {
  const today = new Date().toISOString().split("T")[0];
  const primaryColor = brandColors?.primary ?? "#0f172a";
  const accentColor = brandColors?.accent ?? "#6366f1";

  return `You are a world-class press kit designer. You generate a single, self-contained HTML page that looks like a premium landing page — polished, modern, and visually striking.

**Current date**: ${today}
**Language**: Keep the same language as the current press kit unless explicitly instructed otherwise.

---

### PRIORITY ORDER:

1. **User Instructions (HIGHEST)**: Apply user edit instructions exactly as requested
2. **HTML Output Rules (MANDATORY)**: Follow all rules below
3. **Design Guidelines (DEFAULT)**: Apply to new or unchanged sections

---

## OUTPUT FORMAT: Complete HTML Document

Output a **complete, valid HTML document** — from \`<!DOCTYPE html>\` to \`</html>\`. No markdown, no MDX, no JSON wrapper.

### Required \`<head>\` structure:

\`\`\`html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>BRAND NAME — Press Kit</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
          colors: {
            brand: { primary: '${primaryColor}', accent: '${accentColor}' }
          }
        }
      }
    }
  </script>
</head>
\`\`\`

### Design Principles — CRITICAL:

- **DO NOT** use a white background with purple accents (the default AI look). Derive colors from the brand.
- Use the brand's actual color palette. The primary brand color is \`${primaryColor}\` and the accent color is \`${accentColor}\`. Use these throughout.
- Create a **bold hero section** at the top: large brand name, a tagline or elevator pitch, and the brand logo. Use a gradient background derived from the brand colors.
- Use **card-based layout** for content sections: white/light cards with subtle shadows on a slightly tinted background.
- Apply **generous whitespace**: \`py-16\` or \`py-20\` between sections, \`px-6 md:px-8\` for content.
- Maximum content width: \`max-w-4xl mx-auto\`.
- Typography: Use Inter font. Large section headings (\`text-2xl md:text-3xl font-bold\`), readable body text (\`text-base md:text-lg text-gray-600 leading-relaxed\`).
- Add subtle visual flourishes: gradient borders, hover effects on cards (\`hover:shadow-lg transition-shadow\`), rounded corners (\`rounded-xl\` or \`rounded-2xl\`).
- Images should have \`rounded-xl\` and subtle shadows. Gallery images in a responsive grid (\`grid grid-cols-2 md:grid-cols-3 gap-4\`).
- Use \`<details>\` / \`<summary>\` for expandable content (press coverage, long lists).
- Must be **fully responsive** — mobile-first with Tailwind breakpoints.
- Do NOT include any footer — a legal disclaimer and branding footer are injected server-side.

### Client/Partner Logos:

For client or partner logos, use img.logo.dev:
\`\`\`html
<img src="https://img.logo.dev/DOMAIN?format=png&size=80" alt="Company Name" class="h-10 grayscale opacity-60 hover:grayscale-0 hover:opacity-100 transition" />
\`\`\`
Replace DOMAIN with the bare domain (e.g., "stripe.com", "apple.com"). Do NOT add a token parameter — it is injected server-side.

### Brand Images:

When brand images are provided in the BRAND IMAGES section, embed them using \`<img>\` tags in contextually appropriate sections:
- Logos → hero section or top of page
- Product images → Products/Services section, in a grid
- Team photos → Leadership section, as rounded avatars or cards
- Other images → where contextually relevant

**CRITICAL: ONLY use image URLs from the BRAND IMAGES section. NEVER invent or guess image URLs. If no BRAND IMAGES section is present, do NOT include any \`<img>\` tags for brand content (logo.dev images for client logos are fine).**

### Content Sections to Include:

1. **Hero** — Brand name, tagline, logo, one-line description
2. **About** — Company overview, founding, mission
3. **Key Facts** — Presented as a clean grid or table (headquarters, founded, industry, size, funding, etc.)
4. **Leadership** — Founders/executives with bios, headshots if available
5. **Products & Services** — What they offer, with images if available
6. **Notable Clients/Partners** — Logo grid using img.logo.dev
7. **Awards & Recognition** — If available
8. **Press Coverage** — Articles, mentions, with links. Use \`<details>\` for long lists
9. **Media Assets** — Image gallery (grid layout, not full-width)
10. **Contact** — Press contact info, social media links, website

Omit sections for which no data is available. Do not use placeholder text.

### Style Guidelines:

- **Tone**: Dynamic, human, compelling — not stiff corporate boilerplate
- **Facts only**: All data must be accurate. Embed links where appropriate.
- **Strategic bold**: Use \`<strong>\` to highlight key figures and differentiators
- **No quotation marks inside blockquotes**
- Do NOT wrap the output in code fences or JSON. Output raw HTML only.
`;
}

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
    brandIds: string[];
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
      brandIds: kit.brandIds,
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

async function fetchBrandContext(brandIds: string[], ctx?: ContextHeaders): Promise<string | null> {
  console.log(`[press-kits-service] Fetching brand data for brandIds=${brandIds.join(",")}`);

  // Fetch basic brand info, extracted fields, and images — all use the headerless
  // multi-brand endpoints that read brand IDs from x-brand-id at once.
  const [brands, extractedFields, imageResults] = await Promise.all([
    Promise.all(brandIds.map((id) => getBrand(id, ctx))),
    extractBrandFields(PRESS_KIT_FIELDS, ctx),
    extractBrandImages(PRESS_KIT_IMAGE_CATEGORIES, ctx),
  ]);

  const validBrands = brands.filter((b): b is NonNullable<typeof b> => b !== null);
  const totalImages = imageResults.reduce((sum, r) => sum + r.images.length, 0);

  if (validBrands.length === 0 && extractedFields.length === 0 && totalImages === 0) {
    console.warn(`[press-kits-service] No brand data found for brandIds=${brandIds.join(",")}`);
    return null;
  }

  const parts: string[] = ["--- BRAND DATA (use this to write the press kit) ---"];

  // Basic brand info from brand-service (one section per brand)
  for (const brand of validBrands) {
    parts.push(`\n--- Brand: ${brand.name ?? brand.id} ---`);
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

  // AI-extracted detailed fields (returned by the new multi-brand endpoint)
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

  console.log(`[press-kits-service] Brand data fetched: ${validBrands.length}/${brandIds.length} brands, ${extractedFields.filter((f) => f.value !== null).length}/${extractedFields.length} fields extracted, ${totalImages} images`);

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
      "--- EXISTING PRESS KIT HTML (use as base, apply edits requested below) ---",
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

  parts.push(
    "---",
    "",
    "### Your Task:",
    "",
    "1. Read the current media kit content carefully, if it exists",
    "2. Review the edit history to understand the evolution, if any",
    "3. Apply the user's current instruction precisely, if any",
    "4. Generate a complete HTML page with Tailwind CDN following ALL rules in the system prompt",
    "5. Use the brand data above to fill in ALL real details — do not use any placeholders",
    "",
    "Generate the full press kit HTML page now.",
  );

  return parts.join("\n");
}

function extractTitle(html: string): string {
  const titleTag = html.match(/<title>([^<]+)<\/title>/i);
  if (titleTag) return titleTag[1].trim();
  const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (h1) return h1[1].trim();
  return "Press Kit";
}

export async function generatePressKit(mediaKitId: string, ctx?: ContextHeaders): Promise<void> {
  const data = await fetchGenerationData(mediaKitId);
  if (!data) {
    console.error(`[press-kits-service] Generation: kit ${mediaKitId} not found or not in generating status`);
    return;
  }

  console.log(`[press-kits-service] Starting generation for kit ${mediaKitId}`);

  // Fetch brand context if brandIds are available
  let brandContext: string | null = null;
  if (data.currentKit.brandIds.length > 0) {
    brandContext = await fetchBrandContext(data.currentKit.brandIds, ctx);
  } else {
    console.warn(`[press-kits-service] No brandIds on kit ${mediaKitId} — generating without brand data`);
  }

  const message = buildMessage(data, brandContext);

  // Resolve brand domain and logo URL from brand-service (use first brand for kit metadata)
  let brandDomain: string | null = null;
  let logoUrl: string | null = null;
  if (data.currentKit.brandIds.length > 0) {
    const brand = await getBrand(data.currentKit.brandIds[0], ctx);
    if (brand) {
      brandDomain = brand.domain;
      logoUrl = brand.logoUrl;
    }
  }

  const result = await complete(
    {
      message,
      systemPrompt: buildSystemPrompt(),
      provider: "google",
      model: "pro",
      maxTokens: 24000,
      thinkingBudget: 8000,
    },
    ctx,
  );

  const htmlContent = result.content;
  if (!htmlContent.trim()) {
    throw new Error("Chat service returned empty content");
  }

  const title = extractTitle(htmlContent);

  await db
    .update(mediaKits)
    .set({
      mdxPageContent: htmlContent,
      title,
      status: "drafted",
      updatedAt: new Date(),
      ...(brandDomain ? { brandDomain } : {}),
      ...(logoUrl ? { iconUrl: logoUrl } : {}),
    })
    .where(eq(mediaKits.id, mediaKitId));

  console.log(`[press-kits-service] Generation complete for kit ${mediaKitId}, title: "${title}"`);
}
