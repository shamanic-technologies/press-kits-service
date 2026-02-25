-- Partial unique index: one validated per clerk_organization_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_kits_one_validated_per_org
  ON media_kits (clerk_organization_id)
  WHERE status = 'validated';

--> statement-breakpoint

-- validate_media_kit_with_archive: archives existing validated kit, sets target to validated
CREATE OR REPLACE FUNCTION validate_media_kit_with_archive(p_media_kit_id UUID)
RETURNS SETOF media_kits AS $$
DECLARE
  v_clerk_org_id VARCHAR;
BEGIN
  -- Get the org id for this kit
  SELECT clerk_organization_id INTO v_clerk_org_id
  FROM media_kits WHERE id = p_media_kit_id;

  IF v_clerk_org_id IS NULL THEN
    RETURN;
  END IF;

  -- Archive existing validated kit for the same org
  UPDATE media_kits
  SET status = 'archived', updated_at = now()
  WHERE clerk_organization_id = v_clerk_org_id
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

-- cancel_draft_media_kit: deletes draft, restores parent from archived to drafted
CREATE OR REPLACE FUNCTION cancel_draft_media_kit(p_draft_id UUID)
RETURNS SETOF media_kits AS $$
DECLARE
  v_parent_id UUID;
BEGIN
  -- Get the parent id
  SELECT parent_media_kit_id INTO v_parent_id
  FROM media_kits WHERE id = p_draft_id;

  -- Delete the draft
  DELETE FROM media_kits WHERE id = p_draft_id;

  -- Restore parent if it exists and is archived
  IF v_parent_id IS NOT NULL THEN
    RETURN QUERY
    UPDATE media_kits
    SET status = 'drafted', updated_at = now()
    WHERE id = v_parent_id AND status = 'archived'
    RETURNING *;
  END IF;

  RETURN;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint

-- update_media_kit_status: updates status, sets denial_reason only if denied
CREATE OR REPLACE FUNCTION update_media_kit_status(
  p_id UUID,
  p_status TEXT,
  p_denial_reason TEXT DEFAULT NULL
)
RETURNS SETOF media_kits AS $$
BEGIN
  RETURN QUERY
  UPDATE media_kits
  SET
    status = p_status::media_kit_status,
    denial_reason = CASE WHEN p_status = 'denied' THEN p_denial_reason ELSE NULL END,
    updated_at = now()
  WHERE id = p_id
  RETURNING *;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint

-- get_media_kit_for_edit_by_clerk_org: returns the generating kit for an org
CREATE OR REPLACE FUNCTION get_media_kit_for_edit_by_clerk_org(p_clerk_org_id VARCHAR)
RETURNS SETOF media_kits AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM media_kits
  WHERE clerk_organization_id = p_clerk_org_id
    AND status = 'generating'
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint

-- get_media_kit_instructions_by_clerk_org: all instructions for an org
CREATE OR REPLACE FUNCTION get_media_kit_instructions_by_clerk_org(p_clerk_org_id VARCHAR)
RETURNS SETOF media_kit_instructions AS $$
BEGIN
  RETURN QUERY
  SELECT mki.*
  FROM media_kit_instructions mki
  JOIN media_kits mk ON mki.media_kit_id = mk.id
  WHERE mk.clerk_organization_id = p_clerk_org_id
  ORDER BY mki.created_at;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint

-- get_media_kit_feedbacks_by_clerk_org: denial reasons from all kits
CREATE OR REPLACE FUNCTION get_media_kit_feedbacks_by_clerk_org(p_clerk_org_id VARCHAR)
RETURNS TABLE(id UUID, denial_reason TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT mk.id, mk.denial_reason
  FROM media_kits mk
  WHERE mk.clerk_organization_id = p_clerk_org_id
    AND mk.denial_reason IS NOT NULL
  ORDER BY mk.updated_at;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint

-- upsert_generating_media_kit_by_clerk_org: updates generating kit with LLM output, sets to drafted
CREATE OR REPLACE FUNCTION upsert_generating_media_kit_by_clerk_org(
  p_data JSONB,
  p_clerk_org_id VARCHAR
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
  WHERE clerk_organization_id = p_clerk_org_id
    AND status = 'generating'
  RETURNING *;
END;
$$ LANGUAGE plpgsql;
