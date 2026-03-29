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

// Mock the content-generation client
const mockGenerate = vi.fn();
vi.mock("../../src/lib/content-generation-client.js", () => ({
  deployPrompts: vi.fn().mockResolvedValue(undefined),
  generate: (...args: unknown[]) => mockGenerate(...args),
}));

const { generatePressKit } = await import("../../src/lib/generate.js");

describe("generatePressKit", () => {
  beforeEach(async () => {
    await cleanTestData();
    mockGenerate.mockReset();
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

    mockGenerate.mockResolvedValue({
      id: "gen-1",
      subject: "Press Kit",
      sequence: [
        {
          step: 1,
          bodyHtml: "# Acme Corp Press Kit\n\n## Overview\n\nAcme Corp is a leading provider of widgets.",
          bodyText: "",
          daysSinceLastStep: 0,
        },
      ],
      tokensInput: 100,
      tokensOutput: 200,
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
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("throws when content-generation returns empty content", async () => {
    const kit = await insertTestMediaKit({
      orgId: "org-empty",
      status: "generating",
    });
    await insertTestInstruction({
      mediaKitId: kit.id,
      instruction: "Generate something",
      instructionType: "initial",
    });

    mockGenerate.mockResolvedValue({
      id: "gen-2",
      subject: "",
      sequence: [{ step: 1, bodyHtml: "", bodyText: "", daysSinceLastStep: 0 }],
      tokensInput: 10,
      tokensOutput: 0,
    });

    await expect(generatePressKit(kit.id)).rejects.toThrow(
      "Content generation service returned empty content"
    );
  });

  it("passes existing content as variable for edits", async () => {
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

    mockGenerate.mockResolvedValue({
      id: "gen-3",
      subject: "",
      sequence: [
        {
          step: 1,
          bodyHtml: "# Updated Kit\n\n## Overview\n\nOld content here.\n\n## Sustainability\n\nNew section.",
          bodyText: "",
          daysSinceLastStep: 0,
        },
      ],
      tokensInput: 100,
      tokensOutput: 200,
    });

    await generatePressKit(kit.id);

    // Verify variables passed to content-generation
    const callArgs = mockGenerate.mock.calls[0][0];
    expect(callArgs.type).toBe("generate-press-kit");
    expect(callArgs.variables.existingContent).toContain("Old content here.");
    expect(callArgs.variables.instructions).toContain("Add a sustainability section");
  });

  it("passes feedbacks as variable", async () => {
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

    mockGenerate.mockResolvedValue({
      id: "gen-4",
      subject: "",
      sequence: [
        { step: 1, bodyHtml: "# Detailed Press Kit\n\nContent here.", bodyText: "", daysSinceLastStep: 0 },
      ],
      tokensInput: 100,
      tokensOutput: 200,
    });

    await generatePressKit(kit.id);

    const callArgs = mockGenerate.mock.calls[0][0];
    expect(callArgs.variables.feedbacks).toContain("Too generic, needs more specifics");
  });
});
