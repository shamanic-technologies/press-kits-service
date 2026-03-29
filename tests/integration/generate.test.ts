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

const { generatePressKit } = await import("../../src/lib/generate.js");

describe("generatePressKit", () => {
  beforeEach(async () => {
    await cleanTestData();
    mockComplete.mockReset();
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

    mockComplete.mockResolvedValue({
      content: "# Acme Corp Press Kit\n\n## Overview\n\nAcme Corp is a leading provider of widgets.",
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
      mdxPageContent: "# Old Kit\n\nOld content here.",
    });
    await insertTestInstruction({
      mediaKitId: kit.id,
      instruction: "Add a sustainability section",
      instructionType: "edit",
    });

    mockComplete.mockResolvedValue({
      content: "# Updated Kit\n\n## Overview\n\nOld content here.\n\n## Sustainability\n\nNew section.",
      tokensInput: 100,
      tokensOutput: 200,
      model: "claude-sonnet-4-6",
    });

    await generatePressKit(kit.id);

    const callArgs = mockComplete.mock.calls[0][0];
    expect(callArgs.message).toContain("EXISTING PRESS KIT CONTENT");
    expect(callArgs.message).toContain("Old content here.");
    expect(callArgs.message).toContain("Add a sustainability section");
    expect(callArgs.systemPrompt).toContain("press kit writer");
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
});
