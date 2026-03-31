-- Add brand_ids array column
ALTER TABLE media_kits ADD COLUMN brand_ids VARCHAR[] NOT NULL DEFAULT '{}';

-- Migrate existing data from brand_id
UPDATE media_kits SET brand_ids = ARRAY[brand_id] WHERE brand_id IS NOT NULL;

-- Drop old scalar column
ALTER TABLE media_kits DROP COLUMN brand_id;

-- Add GIN index for array queries (e.g. WHERE $1 = ANY(brand_ids))
CREATE INDEX idx_media_kits_brand_ids ON media_kits USING GIN (brand_ids);
