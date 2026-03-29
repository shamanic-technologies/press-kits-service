import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { mediaKits, mediaKitInstructions } from "../db/schema.js";
import { generate } from "./content-generation-client.js";
import type { ContextHeaders } from "../middleware/auth.js";

const PROMPT_TYPE = "generate-press-kit";

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

function extractTitle(html: string): string {
  // Try extracting from h1/h2 tags in HTML
  const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (h1) return h1[1].trim();
  const h2 = html.match(/<h2[^>]*>([^<]+)<\/h2>/i);
  if (h2) return h2[1].trim();
  // Try markdown headings (in case bodyHtml contains markdown)
  const mdH1 = html.match(/^#\s+(.+)$/m);
  if (mdH1) return mdH1[1].trim();
  return "Press Kit";
}

export async function generatePressKit(mediaKitId: string, ctx?: ContextHeaders): Promise<void> {
  const data = await fetchGenerationData(mediaKitId);
  if (!data) {
    console.error(`[press-kits-service] Generation: kit ${mediaKitId} not found or not in generating status`);
    return;
  }

  console.log(`[press-kits-service] Starting generation for kit ${mediaKitId}`);

  // Build variables for the prompt template
  const instructionsText = data.instructions
    .map((i) => `[${i.instructionType}] ${i.instruction}`)
    .join("\n");

  const feedbacksText = data.feedbacks
    .map((f) => `- ${f.denialReason}`)
    .join("\n");

  const variables: Record<string, string | null> = {
    existingContent: data.currentKit.mdxPageContent,
    instructions: instructionsText || null,
    feedbacks: feedbacksText || null,
  };

  const result = await generate(
    {
      type: PROMPT_TYPE,
      variables,
      brandId: data.currentKit.brandId ?? undefined,
      campaignId: data.currentKit.campaignId ?? undefined,
    },
    ctx,
  );

  // Use the first step's bodyHtml as the MDX content
  const mdxContent = result.sequence?.[0]?.bodyHtml ?? "";
  if (!mdxContent.trim()) {
    throw new Error("Content generation service returned empty content");
  }

  const title = extractTitle(mdxContent);

  await db
    .update(mediaKits)
    .set({
      mdxPageContent: mdxContent,
      title,
      status: "drafted",
      updatedAt: new Date(),
    })
    .where(eq(mediaKits.id, mediaKitId));

  console.log(`[press-kits-service] Generation complete for kit ${mediaKitId}, title: "${title}"`);
}
