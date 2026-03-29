-- Add 'failed' value to media_kit_status enum
ALTER TYPE media_kit_status ADD VALUE IF NOT EXISTS 'failed';
