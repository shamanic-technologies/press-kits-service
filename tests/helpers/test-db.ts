import { db, sql } from "../../src/db/index.js";
import { mediaKits, mediaKitInstructions, mediaKitViews } from "../../src/db/schema.js";
import type { NewMediaKit, NewMediaKitInstruction, NewMediaKitView } from "../../src/db/schema.js";

export async function cleanTestData(): Promise<void> {
  await db.delete(mediaKitViews);
  await db.delete(mediaKitInstructions);
  await db.delete(mediaKits);
}

export async function insertTestMediaKit(
  data: Partial<NewMediaKit> & { orgId: string; status: NewMediaKit["status"] }
) {
  const [kit] = await db
    .insert(mediaKits)
    .values({
      orgId: data.orgId,
      brandId: data.brandId ?? null,
      campaignId: data.campaignId ?? null,
      featureSlug: data.featureSlug ?? null,
      workflowSlug: data.workflowSlug ?? null,
      title: data.title ?? null,
      iconUrl: data.iconUrl ?? null,
      mdxPageContent: data.mdxPageContent ?? null,
      parentMediaKitId: data.parentMediaKitId ?? null,
      status: data.status,
      denialReason: data.denialReason ?? null,
    })
    .returning();
  return kit;
}

export async function insertTestInstruction(
  data: Partial<NewMediaKitInstruction> & {
    mediaKitId: string;
    instruction: string;
    instructionType: string;
  }
) {
  const [inst] = await db
    .insert(mediaKitInstructions)
    .values({
      mediaKitId: data.mediaKitId,
      instruction: data.instruction,
      instructionType: data.instructionType,
    })
    .returning();
  return inst;
}

export async function insertTestView(
  data: Partial<NewMediaKitView> & { mediaKitId: string }
) {
  const [view] = await db
    .insert(mediaKitViews)
    .values({
      mediaKitId: data.mediaKitId,
      ipAddress: data.ipAddress ?? null,
      userAgent: data.userAgent ?? null,
      country: data.country ?? null,
      viewedAt: data.viewedAt ?? new Date(),
    })
    .returning();
  return view;
}

export async function closeDb(): Promise<void> {
  await sql.end();
}
