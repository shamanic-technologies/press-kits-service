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

// Mock Anthropic SDK
const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));

// Set the API key before importing the module under test
process.env.ANTHROPIC_API_KEY = "test-key";

const { generatePressKit } = await import("../../src/lib/generate.js");

describe("generatePressKit", () => {
  beforeEach(async () => {
    await cleanTestData();
    mockCreate.mockReset();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  it("generates MDX and updates kit to drafted", async () => {
    const kit = await insertTestMediaKit({
      orgId: "org-gen",
      status: "generating",
    });
    await insertTestInstruction({
      mediaKitId: kit.id,
      instruction: "Create a press kit for Acme Corp",
      instructionType: "initial",
    });

    mockCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: "# Acme Corp Press Kit\n\n## Overview\n\nAcme Corp is a leading provider of widgets.",
        },
      ],
    });

    await generatePressKit(kit.id);

    const [updated] = await db
      .select()
      .from(mediaKits)
      .where(eq(mediaKits.id, kit.id));

    expect(updated.status).toBe("drafted");
    expect(updated.title).toBe("Acme Corp Press Kit");
    expect(updated.mdxPageContent).toContain("## Overview");
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
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("throws when AI returns empty content", async () => {
    const kit = await insertTestMediaKit({
      orgId: "org-empty",
      status: "generating",
    });
    await insertTestInstruction({
      mediaKitId: kit.id,
      instruction: "Generate something",
      instructionType: "initial",
    });

    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "" }],
    });

    await expect(generatePressKit(kit.id)).rejects.toThrow("AI returned empty content");
  });

  it("includes existing content in prompt for edits", async () => {
    const kit = await insertTestMediaKit({
      orgId: "org-edit",
      status: "generating",
      mdxPageContent: "# Old Kit\n\nOld content here.",
    });
    await insertTestInstruction({
      mediaKitId: kit.id,
      instruction: "Add a sustainability section",
      instructionType: "edit",
    });

    mockCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: "# Updated Kit\n\n## Overview\n\nOld content here.\n\n## Sustainability\n\nNew section.",
        },
      ],
    });

    await generatePressKit(kit.id);

    // Verify the prompt included existing content
    const callArgs = mockCreate.mock.calls[0][0];
    const prompt = callArgs.messages[0].content;
    expect(prompt).toContain("EXISTING PRESS KIT CONTENT");
    expect(prompt).toContain("Old content here.");
    expect(prompt).toContain("Add a sustainability section");
  });

  it("includes previous denial feedback in prompt", async () => {
    // Create a denied kit with feedback
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

    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "# Detailed Press Kit\n\nContent here." }],
    });

    await generatePressKit(kit.id);

    const callArgs = mockCreate.mock.calls[0][0];
    const prompt = callArgs.messages[0].content;
    expect(prompt).toContain("PREVIOUS FEEDBACK");
    expect(prompt).toContain("Too generic, needs more specifics");
  });
});
