import { vi, beforeAll } from "vitest";

process.env.PRESS_KITS_SERVICE_DATABASE_URL =
  process.env.PRESS_KITS_SERVICE_DATABASE_URL ?? "postgresql://test:test@localhost:5432/press_kits_test";
process.env.PRESS_KITS_SERVICE_API_KEY = "test-api-key";
process.env.NODE_ENV = "test";

vi.mock("../src/lib/dynasty-client.js", () => ({
  resolveFeatureDynastySlugs: vi.fn().mockResolvedValue([]),
  resolveWorkflowDynastySlugs: vi.fn().mockResolvedValue([]),
}));

vi.mock("../src/lib/runs-client.js", () => ({
  createRun: vi.fn().mockResolvedValue({ id: "test-run-id" }),
  updateRunStatus: vi.fn().mockResolvedValue(undefined),
  addCosts: vi.fn().mockResolvedValue(undefined),
  batchGetCosts: vi.fn().mockResolvedValue([]),
}));

beforeAll(async () => {
  const { sql } = await import("../src/db/index.js");
  // Ensure test DB schema matches the Drizzle schema (idempotent).
  await sql`ALTER TABLE media_kits ADD COLUMN IF NOT EXISTS share_token uuid DEFAULT gen_random_uuid()`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_media_kits_share_token ON media_kits USING btree (share_token)`;
  await sql`ALTER TABLE media_kits DROP COLUMN IF EXISTS client_organization_id`;
  await sql`ALTER TABLE media_kits DROP COLUMN IF EXISTS organization_id`;
  await sql`ALTER TABLE media_kits DROP COLUMN IF EXISTS jsx_page_content`;
  await sql`ALTER TABLE media_kits DROP COLUMN IF EXISTS json_page_content`;
  await sql`ALTER TABLE media_kits DROP COLUMN IF EXISTS notion_page_content`;
  await sql`DROP TABLE IF EXISTS organizations CASCADE`;
  await sql`CREATE INDEX IF NOT EXISTS idx_media_kits_campaign_id ON media_kits USING btree (campaign_id)`;
  await sql`DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='media_kits' AND column_name='workflow_name') THEN ALTER TABLE media_kits RENAME COLUMN workflow_name TO workflow_slug; END IF; END $$`;
  // media_kit_views table
  await sql`CREATE TABLE IF NOT EXISTS media_kit_views (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    media_kit_id uuid NOT NULL REFERENCES media_kits(id) ON DELETE CASCADE,
    viewed_at timestamptz NOT NULL DEFAULT now(),
    ip_address varchar,
    user_agent text,
    country varchar
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_views_media_kit_id ON media_kit_views USING btree (media_kit_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_views_viewed_at ON media_kit_views USING btree (viewed_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_views_country ON media_kit_views USING btree (country)`;
  // Add 'failed' status to enum
  await sql`ALTER TYPE media_kit_status ADD VALUE IF NOT EXISTS 'failed'`;
  // media_kit_runs table
  await sql`DO $$ BEGIN CREATE TYPE media_kit_run_type AS ENUM ('generation', 'edit'); EXCEPTION WHEN duplicate_object THEN null; END $$`;
  await sql`CREATE TABLE IF NOT EXISTS media_kit_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    media_kit_id uuid NOT NULL REFERENCES media_kits(id) ON DELETE CASCADE,
    run_id varchar NOT NULL,
    parent_run_id varchar,
    run_type media_kit_run_type NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_runs_media_kit_id ON media_kit_runs USING btree (media_kit_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_runs_run_id ON media_kit_runs USING btree (run_id)`;
  // Drop dynasty slug columns (removed in favor of service-call resolution)
  await sql`ALTER TABLE media_kits DROP COLUMN IF EXISTS feature_dynasty_slug`;
  await sql`ALTER TABLE media_kits DROP COLUMN IF EXISTS workflow_dynasty_slug`;
  // Add brand_domain column for logo.dev resolution
  await sql`ALTER TABLE media_kits ADD COLUMN IF NOT EXISTS brand_domain text`;
});
