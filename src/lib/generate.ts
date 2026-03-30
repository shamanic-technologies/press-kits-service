import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { mediaKits, mediaKitInstructions } from "../db/schema.js";
import { complete } from "./chat-client.js";
import { getBrand, extractBrandFields, extractBrandImages } from "./brand-client.js";
import type { ContextHeaders } from "../middleware/auth.js";

function buildSystemPrompt(): string {
  const today = new Date().toISOString().split("T")[0];
  return `You are a professional press kit writer. Your task is to generate or upsert a press kit in MDX format.

**Current date**: ${today}
**Language**: Keep the same language as the current media kit unless explicitly instructed otherwise.

---

### CRITICAL PRIORITY ORDER:

1. **User Instructions (HIGHEST PRIORITY)**: Apply user's edit instructions exactly as requested
2. **MDX Syntax (MANDATORY)**: Follow all MDX syntax rules below
3. **General Guidelines (DEFAULT)**: Apply to unchanged sections or new content

---

## MDX Format — ONLY OUTPUT

Use the brand data provided to fill in ALL details. NEVER use placeholder brackets like [Brand Name] or [Year] — if a piece of information is not available, omit that line entirely rather than using a placeholder.

### MDX Syntax:

**Native Markdown**:
- \`# \` for H1, \`## \` for H2, \`### \` for H3
- \`**bold**\`, \`*italic*\`
- \`- \` for bullet lists, \`1. \` for numbered lists
- \`> \` for blockquotes (NO quotation marks inside the text)
- \`---\` for dividers
- \`[link text](url)\` for links

**JSX Components** (use when needed):
- \`<Card>\`, \`<Avatar>\`, \`<InteractiveImage>\`, \`<ClientLogo>\` — wrap in \`<div className="not-prose my-6">\`
- \`<Collapsible>\` — DO NOT wrap in \`not-prose\`, it handles its own styling

---

### Component Rules:

**\`<Card>\`** — Wrap in \`not-prose\`:
\`\`\`mdx
<div className="not-prose my-6">
  <Card>
    <CardHeader>
      <CardTitle>Title</CardTitle>
    </CardHeader>
    <CardContent>
      Content here
    </CardContent>
  </Card>
</div>
\`\`\`

**\`<Collapsible>\`** — No wrapper needed:
\`\`\`mdx
<Collapsible>
  <CollapsibleTrigger>
    Click to Expand
  </CollapsibleTrigger>
  <CollapsibleContent>
    ### Details

    Content with **native markdown**.
  </CollapsibleContent>
</Collapsible>
\`\`\`

**\`<ClientLogo>\`** — For client/partner logos (ALWAYS use this, never InteractiveImage for logos):
\`\`\`mdx
<div className="not-prose my-6">
  <div className="overflow-x-auto -mx-4 px-4 md:overflow-visible md:mx-0 md:px-0">
    <div className="flex md:flex-wrap justify-start md:justify-center gap-4 sm:gap-6 md:gap-8 min-w-max md:min-w-0">
      <ClientLogo domain="example.com" name="Example Company" />
      <ClientLogo domain="acme.com" name="Acme Corp" />
    </div>
  </div>
</div>
\`\`\`
**IMPORTANT for ClientLogo**:
- \`domain\`: Just the domain without https:// or www (e.g., "vallourec.com", "apple.com")
- \`name\`: The company's display name (will appear as caption)
- Automatically fetches logo from Clearbit, shows grayscale by default (color on hover), handles fallback

**Tables** — Wrap in \`not-prose\`:
\`\`\`mdx
<div className="not-prose my-6 overflow-x-auto">
  <table className="w-full">
    <thead>
      <tr><th>Column 1</th><th>Column 2</th></tr>
    </thead>
    <tbody>
      <tr><td>Data 1</td><td>Data 2</td></tr>
    </tbody>
  </table>
</div>
\`\`\`

**\`<InteractiveImage>\`** — For clickable/downloadable images (NOT for logos):
\`\`\`mdx
<InteractiveImage src="url" alt="Description for screen readers" caption="Visible text shown to users" />
\`\`\`
- \`src\`: Image URL (required)
- \`alt\`: Short description for accessibility/screen readers — NOT shown to users
- \`caption\`: Visible text displayed below image and in modal title (optional)
- Use for product photos, team photos, event images, office spaces

When brand images are provided in the BRAND IMAGES section, use \`<InteractiveImage>\` to embed them in relevant sections. Place logos near the top, product images in the Products/Services section, team photos in the Leadership section, and other images where contextually appropriate. Use the provided descriptions as alt text, and add a meaningful caption.

**CRITICAL: ONLY use image URLs that are explicitly provided in the BRAND IMAGES section. NEVER invent, guess, or infer image URLs based on the brand's domain, website content, or any other information. If no BRAND IMAGES section is present, do NOT include any \`<InteractiveImage>\` components or markdown images in the output.**

**Blockquotes** — NEVER include quotation marks inside:
\`\`\`mdx
> This is the quote text without any quotation marks
\`\`\`

---

### Responsive Design for Mobile

IMPORTANT: Always use responsive text sizing for mobile compatibility.

DON'T (Desktop-only): \`<div className="text-base">...</div>\`
DO (Mobile-first responsive): \`<div className="text-sm sm:text-base">...</div>\`

Standard text sizing:
- \`text-sm sm:text-base\`: All main content (bios, descriptions, paragraphs)
- \`text-xs sm:text-sm\`: Metadata, dates, captions only

---

### Section: Media Assets

For the Media Assets section, include all relevant images (company, founders, logos, services). Display them as an image gallery — no full-width images — as many images would be pixelated at full width.

### Section: Articles & Press Coverage

Include a section listing all relevant online publications about the leadership team and the company. Be extensive and up-to-date. Display at least 3 articles if available, and use \`<Collapsible>\` for long lists so journalists can expand to see more.

---

### General Style Guidelines:

- **Strategic bold**: Highlight key information with **bold**
- **Paragraph structure**: Split long paragraphs for readability
- **Images**: Top-align images beside text; place face photos above/beside text
- **Captions**: Be generic enough to avoid errors; use empty alt (\`alt=""\`) when unsure
- **Logo**: Large and visible (1/4 or 1/3 width), no caption
- **Tone**: Dynamic, human, compelling — avoid stiff AI-generated feeling
- **Factual**: All data must be accurate; embed links where appropriate

---

Output ONLY the MDX content, no explanations, no wrapping, no JSON.
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

  parts.push(
    "---",
    "",
    "### Your Task:",
    "",
    "1. Read the current media kit content carefully, if it exists",
    "2. Review the edit history to understand the evolution, if any",
    "3. Apply the user's current instruction precisely, if any",
    "4. Generate MDX format with proper component usage following ALL syntax rules above",
    "5. Use the brand data above to fill in ALL real details — do not use any placeholders",
    "",
    "Generate the full press kit MDX content now.",
  );

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
      systemPrompt: buildSystemPrompt(),
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
