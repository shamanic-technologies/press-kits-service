import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { createTestApp } from "../helpers/test-app.js";
import {
  cleanTestData,
  insertTestMediaKit,
  closeDb,
} from "../helpers/test-db.js";
import { db } from "../../src/db/index.js";
import { mediaKits } from "../../src/db/schema.js";
import { eq } from "drizzle-orm";

const app = createTestApp();

const apiKeyHeader = { "X-API-Key": "test-api-key" };

const BRAND_1 = "a0000000-0000-0000-0000-000000000001";
const BRAND_2 = "a0000000-0000-0000-0000-000000000002";
const BRAND_OTHER = "a0000000-0000-0000-0000-000000000099";

describe("POST /internal/transfer-brand", () => {
  beforeEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await cleanTestData();
    await closeDb();
  });

  it("transfers solo-brand media kits from source to target org", async () => {
    await insertTestMediaKit({
      orgId: "org-source",
      brandIds: [BRAND_1],
      status: "validated",
      title: "Solo Kit",
    });

    const res = await request(app)
      .post("/internal/transfer-brand")
      .set(apiKeyHeader)
      .send({
        sourceBrandId: BRAND_1,
        sourceOrgId: "org-source",
        targetOrgId: "org-target",
      });

    expect(res.status).toBe(200);
    expect(res.body.updatedTables).toEqual([
      { tableName: "media_kits", count: 1 },
    ]);

    const kits = await db
      .select()
      .from(mediaKits)
      .where(eq(mediaKits.orgId, "org-target"));
    expect(kits).toHaveLength(1);
    expect(kits[0].title).toBe("Solo Kit");
  });

  it("rewrites brand_ids when targetBrandId is provided", async () => {
    const TARGET_BRAND = "b0000000-0000-0000-0000-000000000001";

    await insertTestMediaKit({
      orgId: "org-source",
      brandIds: [BRAND_1],
      status: "validated",
      title: "Rewrite Kit",
    });

    const res = await request(app)
      .post("/internal/transfer-brand")
      .set(apiKeyHeader)
      .send({
        sourceBrandId: BRAND_1,
        sourceOrgId: "org-source",
        targetOrgId: "org-target",
        targetBrandId: TARGET_BRAND,
      });

    expect(res.status).toBe(200);
    expect(res.body.updatedTables).toEqual([
      { tableName: "media_kits", count: 1 },
    ]);

    const kits = await db
      .select()
      .from(mediaKits)
      .where(eq(mediaKits.orgId, "org-target"));
    expect(kits).toHaveLength(1);
    expect(kits[0].brandIds).toEqual([TARGET_BRAND]);
  });

  it("skips co-branding rows (multiple brand IDs)", async () => {
    await insertTestMediaKit({
      orgId: "org-source",
      brandIds: [BRAND_1, BRAND_2],
      status: "validated",
      title: "Co-branded Kit",
    });

    const res = await request(app)
      .post("/internal/transfer-brand")
      .set(apiKeyHeader)
      .send({
        sourceBrandId: BRAND_1,
        sourceOrgId: "org-source",
        targetOrgId: "org-target",
      });

    expect(res.status).toBe(200);
    expect(res.body.updatedTables).toEqual([
      { tableName: "media_kits", count: 0 },
    ]);

    const kits = await db
      .select()
      .from(mediaKits)
      .where(eq(mediaKits.orgId, "org-source"));
    expect(kits).toHaveLength(1);
  });

  it("skips rows where brand_id does not match", async () => {
    await insertTestMediaKit({
      orgId: "org-source",
      brandIds: [BRAND_OTHER],
      status: "validated",
    });

    const res = await request(app)
      .post("/internal/transfer-brand")
      .set(apiKeyHeader)
      .send({
        sourceBrandId: BRAND_1,
        sourceOrgId: "org-source",
        targetOrgId: "org-target",
      });

    expect(res.status).toBe(200);
    expect(res.body.updatedTables).toEqual([
      { tableName: "media_kits", count: 0 },
    ]);
  });

  it("is idempotent — second run is a no-op", async () => {
    await insertTestMediaKit({
      orgId: "org-source",
      brandIds: [BRAND_1],
      status: "validated",
    });

    const payload = {
      sourceBrandId: BRAND_1,
      sourceOrgId: "org-source",
      targetOrgId: "org-target",
    };

    await request(app)
      .post("/internal/transfer-brand")
      .set(apiKeyHeader)
      .send(payload);

    const res = await request(app)
      .post("/internal/transfer-brand")
      .set(apiKeyHeader)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.updatedTables).toEqual([
      { tableName: "media_kits", count: 0 },
    ]);
  });

  it("transfers multiple solo-brand kits at once", async () => {
    await insertTestMediaKit({
      orgId: "org-source",
      brandIds: [BRAND_1],
      status: "validated",
      title: "Kit A",
    });
    await insertTestMediaKit({
      orgId: "org-source",
      brandIds: [BRAND_1],
      status: "drafted",
      title: "Kit B",
    });
    await insertTestMediaKit({
      orgId: "org-source",
      brandIds: [BRAND_1],
      status: "archived",
      title: "Kit C",
    });

    const res = await request(app)
      .post("/internal/transfer-brand")
      .set(apiKeyHeader)
      .send({
        sourceBrandId: BRAND_1,
        sourceOrgId: "org-source",
        targetOrgId: "org-target",
      });

    expect(res.status).toBe(200);
    expect(res.body.updatedTables).toEqual([
      { tableName: "media_kits", count: 3 },
    ]);
  });

  it("does not require identity headers", async () => {
    const res = await request(app)
      .post("/internal/transfer-brand")
      .set(apiKeyHeader)
      .send({
        sourceBrandId: BRAND_1,
        sourceOrgId: "org-source",
        targetOrgId: "org-target",
      });

    expect(res.status).toBe(200);
  });

  it("rejects requests without API key", async () => {
    const res = await request(app)
      .post("/internal/transfer-brand")
      .send({
        sourceBrandId: BRAND_1,
        sourceOrgId: "org-source",
        targetOrgId: "org-target",
      });

    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid body", async () => {
    const res = await request(app)
      .post("/internal/transfer-brand")
      .set(apiKeyHeader)
      .send({ sourceBrandId: "not-a-uuid" });

    expect(res.status).toBe(400);
  });
});
