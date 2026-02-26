import { db, sql } from "../../src/db/index.js";
import { organizations, mediaKits, mediaKitInstructions } from "../../src/db/schema.js";
import type { NewOrganization, NewMediaKit, NewMediaKitInstruction } from "../../src/db/schema.js";

export async function cleanTestData(): Promise<void> {
  await db.delete(mediaKitInstructions);
  await db.delete(mediaKits);
  await db.delete(organizations);
}

export async function insertTestOrganization(
  data: Partial<NewOrganization> & { orgId: string }
) {
  const [org] = await db
    .insert(organizations)
    .values({
      orgId: data.orgId,
      name: data.name ?? null,
    })
    .returning();
  return org;
}

export async function insertTestMediaKit(
  data: Partial<NewMediaKit> & { status: NewMediaKit["status"] }
) {
  const [kit] = await db
    .insert(mediaKits)
    .values({
      clientOrganizationId: data.clientOrganizationId ?? null,
      orgId: data.orgId ?? null,
      organizationId: data.organizationId ?? null,
      title: data.title ?? null,
      iconUrl: data.iconUrl ?? null,
      mdxPageContent: data.mdxPageContent ?? null,
      jsxPageContent: data.jsxPageContent ?? null,
      jsonPageContent: data.jsonPageContent ?? null,
      notionPageContent: data.notionPageContent ?? null,
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

export async function closeDb(): Promise<void> {
  await sql.end();
}
