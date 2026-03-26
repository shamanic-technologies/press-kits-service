-- Drop all PL/pgSQL functions — logic moved to application layer (Drizzle transactions)

DROP FUNCTION IF EXISTS validate_media_kit_with_archive(UUID);

--> statement-breakpoint

DROP FUNCTION IF EXISTS cancel_draft_media_kit(UUID);

--> statement-breakpoint

DROP FUNCTION IF EXISTS update_media_kit_status(UUID, TEXT, TEXT);

--> statement-breakpoint

DROP FUNCTION IF EXISTS upsert_generating_media_kit_by_org(JSONB, VARCHAR);
