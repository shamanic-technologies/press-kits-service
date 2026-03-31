import { db, sql } from "../../src/db/index.js";
import { mediaKits, mediaKitInstructions, mediaKitViews, mediaKitRuns } from "../../src/db/schema.js";
import type { NewMediaKit, NewMediaKitInstruction, NewMediaKitView, NewMediaKitRun } from "../../src/db/schema.js";

export async function cleanTestData(): Promise<void> {
  await db.delete(mediaKitRuns);
  await db.delete(mediaKitViews);
  await db.delete(mediaKitInstructions);
  await db.delete(mediaKits);
}

export async function insertTestMediaKit(
  data: Partial<NewMediaKit> & { orgId: string; status: NewMediaKit["status"] } & { updatedAt?: Date }
) {
  const [kit] = await db
    .insert(mediaKits)
    .values({
      orgId: data.orgId,
      brandIds: data.brandIds ?? [],
      campaignId: data.campaignId ?? null,
      featureSlug: data.featureSlug ?? null,
      workflowSlug: data.workflowSlug ?? null,
      title: data.title ?? null,
      iconUrl: data.iconUrl ?? null,
      brandDomain: data.brandDomain ?? null,
      mdxPageContent: data.mdxPageContent ?? null,
      parentMediaKitId: data.parentMediaKitId ?? null,
      status: data.status,
      denialReason: data.denialReason ?? null,
      ...(data.updatedAt ? { updatedAt: data.updatedAt } : {}),
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

export async function insertTestMediaKitRun(
  data: Partial<NewMediaKitRun> & {
    mediaKitId: string;
    runId: string;
    runType: NewMediaKitRun["runType"];
  }
) {
  const [run] = await db
    .insert(mediaKitRuns)
    .values({
      mediaKitId: data.mediaKitId,
      runId: data.runId,
      parentRunId: data.parentRunId ?? null,
      runType: data.runType,
    })
    .returning();
  return run;
}

export async function closeDb(): Promise<void> {
  await sql.end();
}
