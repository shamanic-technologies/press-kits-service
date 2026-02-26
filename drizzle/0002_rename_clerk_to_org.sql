-- Rename clerk_organization_id columns to org_id
ALTER TABLE organizations RENAME COLUMN clerk_organization_id TO org_id;

--> statement-breakpoint

ALTER TABLE media_kits RENAME COLUMN clerk_organization_id TO org_id;

--> statement-breakpoint

-- Rename unique constraint on organizations
ALTER TABLE organizations RENAME CONSTRAINT organizations_clerk_organization_id_unique TO organizations_org_id_unique;

--> statement-breakpoint

-- Drop old indexes and create new ones
DROP INDEX IF EXISTS idx_organizations_clerk_org_id;

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_organizations_org_id ON organizations USING btree (org_id);

--> statement-breakpoint

DROP INDEX IF EXISTS idx_media_kits_clerk_org_id;

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_media_kits_ext_org_id ON media_kits USING btree (org_id);

--> statement-breakpoint

-- Recreate partial unique index with renamed column
DROP INDEX IF EXISTS idx_media_kits_one_validated_per_org;

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_kits_one_validated_per_org
  ON media_kits (org_id)
  WHERE status = 'validated';

--> statement-breakpoint

-- Drop old PL/pgSQL functions that reference clerk naming
DROP FUNCTION IF EXISTS get_media_kit_for_edit_by_clerk_org(VARCHAR);

--> statement-breakpoint

DROP FUNCTION IF EXISTS get_media_kit_instructions_by_clerk_org(VARCHAR);

--> statement-breakpoint

DROP FUNCTION IF EXISTS get_media_kit_feedbacks_by_clerk_org(VARCHAR);

--> statement-breakpoint

DROP FUNCTION IF EXISTS upsert_generating_media_kit_by_clerk_org(JSONB, VARCHAR);

--> statement-breakpoint

-- Recreate validate_media_kit_with_archive with renamed column references
CREATE OR REPLACE FUNCTION validate_media_kit_with_archive(p_media_kit_id UUID)
RETURNS SETOF media_kits AS $$
DECLARE
  v_org_id VARCHAR;
BEGIN
  -- Get the org id for this kit
  SELECT org_id INTO v_org_id
  FROM media_kits WHERE id = p_media_kit_id;

  IF v_org_id IS NULL THEN
    RETURN;
  END IF;

  -- Archive existing validated kit for the same org
  UPDATE media_kits
  SET status = 'archived', updated_at = now()
  WHERE org_id = v_org_id
    AND status = 'validated'
    AND id != p_media_kit_id;

  -- Set target kit to validated
  RETURN QUERY
  UPDATE media_kits
  SET status = 'validated', updated_at = now()
  WHERE id = p_media_kit_id
  RETURNING *;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint

-- Recreate with new name: get_media_kit_for_edit_by_org
CREATE OR REPLACE FUNCTION get_media_kit_for_edit_by_org(p_org_id VARCHAR)
RETURNS SETOF media_kits AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM media_kits
  WHERE org_id = p_org_id
    AND status = 'generating'
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint

-- Recreate with new name: get_media_kit_instructions_by_org
CREATE OR REPLACE FUNCTION get_media_kit_instructions_by_org(p_org_id VARCHAR)
RETURNS SETOF media_kit_instructions AS $$
BEGIN
  RETURN QUERY
  SELECT mki.*
  FROM media_kit_instructions mki
  JOIN media_kits mk ON mki.media_kit_id = mk.id
  WHERE mk.org_id = p_org_id
  ORDER BY mki.created_at;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint

-- Recreate with new name: get_media_kit_feedbacks_by_org
CREATE OR REPLACE FUNCTION get_media_kit_feedbacks_by_org(p_org_id VARCHAR)
RETURNS TABLE(id UUID, denial_reason TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT mk.id, mk.denial_reason
  FROM media_kits mk
  WHERE mk.org_id = p_org_id
    AND mk.denial_reason IS NOT NULL
  ORDER BY mk.updated_at;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint

-- Recreate with new name: upsert_generating_media_kit_by_org
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
