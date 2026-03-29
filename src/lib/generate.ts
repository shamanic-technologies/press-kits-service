import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { mediaKits, mediaKitInstructions } from "../db/schema.js";
import { complete } from "./chat-client.js";
import type { ContextHeaders } from "../middleware/auth.js";

const SYSTEM_PROMPT = [
  "You are a professional press kit writer. Generate a press kit in MDX format.",
  "The output must be valid MDX that can be rendered directly. Include sections like: Company Overview, Key Facts, Leadership, Products/Services, Press Contacts.",
  "Use markdown headings (##), bold text, and bullet points for readability.",
  "Do NOT include import statements or JSX components — only standard markdown syntax.",
  "Output ONLY the MDX content, no explanations or wrapping.",
].join("\n");

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

function buildMessage(data: GenerationData): string {
  const parts: string[] = [];

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

  parts.push("Generate the full press kit MDX content now.");

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

  const message = buildMessage(data);

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
    })
    .where(eq(mediaKits.id, mediaKitId));

  console.log(`[press-kits-service] Generation complete for kit ${mediaKitId}, title: "${title}"`);
}
