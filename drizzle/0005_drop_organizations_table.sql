-- Add share_token to media_kits (per-kit public sharing)
ALTER TABLE "media_kits" ADD COLUMN "share_token" uuid DEFAULT gen_random_uuid();

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_media_kits_share_token" ON "media_kits" USING btree ("share_token");

--> statement-breakpoint

-- Make org_id NOT NULL
ALTER TABLE "media_kits" ALTER COLUMN "org_id" SET NOT NULL;

--> statement-breakpoint

-- Drop FK to organizations
ALTER TABLE "media_kits" DROP CONSTRAINT IF EXISTS "media_kits_organization_id_organizations_id_fk";

--> statement-breakpoint

-- Drop legacy columns
ALTER TABLE "media_kits" DROP COLUMN IF EXISTS "client_organization_id";

--> statement-breakpoint

ALTER TABLE "media_kits" DROP COLUMN IF EXISTS "organization_id";

--> statement-breakpoint

ALTER TABLE "media_kits" DROP COLUMN IF EXISTS "jsx_page_content";

--> statement-breakpoint

ALTER TABLE "media_kits" DROP COLUMN IF EXISTS "json_page_content";

--> statement-breakpoint

ALTER TABLE "media_kits" DROP COLUMN IF EXISTS "notion_page_content";

--> statement-breakpoint

-- Drop organization-related index (was on organization_id FK)
DROP INDEX IF EXISTS "idx_media_kits_org_id";

--> statement-breakpoint

-- Drop one-validated-per-org unique index (too restrictive for campaign-scoped kits)
DROP INDEX IF EXISTS "idx_media_kits_one_validated_per_org";

--> statement-breakpoint

-- Drop organizations table
DROP TABLE IF EXISTS "organizations";

--> statement-breakpoint

-- Drop unused SQL functions that reference organizations
DROP FUNCTION IF EXISTS get_media_kit_for_edit_by_org(VARCHAR);

--> statement-breakpoint

DROP FUNCTION IF EXISTS get_media_kit_instructions_by_org(VARCHAR);

--> statement-breakpoint

DROP FUNCTION IF EXISTS get_media_kit_feedbacks_by_org(VARCHAR);

--> statement-breakpoint

-- Update validate_media_kit_with_archive to scope by campaign_id
CREATE OR REPLACE FUNCTION validate_media_kit_with_archive(p_media_kit_id UUID)
RETURNS SETOF media_kits AS $$
DECLARE
  v_org_id VARCHAR;
  v_campaign_id VARCHAR;
BEGIN
  SELECT org_id, campaign_id INTO v_org_id, v_campaign_id
  FROM media_kits WHERE id = p_media_kit_id;

  IF v_org_id IS NULL THEN
    RETURN;
  END IF;

  -- Archive existing validated kits for the same org+campaign scope
  IF v_campaign_id IS NOT NULL THEN
    UPDATE media_kits
    SET status = 'archived', updated_at = now()
    WHERE org_id = v_org_id
      AND campaign_id = v_campaign_id
      AND status = 'validated'
      AND id != p_media_kit_id;
  ELSE
    UPDATE media_kits
    SET status = 'archived', updated_at = now()
    WHERE org_id = v_org_id
      AND campaign_id IS NULL
      AND status = 'validated'
      AND id != p_media_kit_id;
  END IF;

  RETURN QUERY
  UPDATE media_kits
  SET status = 'validated', updated_at = now()
  WHERE id = p_media_kit_id
  RETURNING *;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint

-- Update upsert_generating_media_kit_by_org to also return share_token
CREATE OR REPLACE FUNCTION upsert_generating_media_kit_by_org(
  p_data JSONB,
  p_org_id VARCHAR
)
RETURNS SETOF media_kits AS $$
BEGIN
  RETURN QUERY
  UPDATE media_kits
  SET
    mdx_page_content = COALESCE(p_data->>'mdx_page_content', mdx_page_content),
    title = COALESCE(p_data->>'title', title),
    icon_url = COALESCE(p_data->>'icon_url', icon_url),
    status = 'drafted',
    updated_at = now()
  WHERE org_id = p_org_id
    AND status = 'generating'
  RETURNING *;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint

-- Add index on campaign_id for campaign-scoped queries
CREATE INDEX IF NOT EXISTS "idx_media_kits_campaign_id" ON "media_kits" USING btree ("campaign_id");
