CREATE TABLE IF NOT EXISTS "media_kit_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_kit_id" uuid NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" varchar,
	"user_agent" text,
	"country" varchar
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "media_kit_views" ADD CONSTRAINT "media_kit_views_media_kit_id_media_kits_id_fk" FOREIGN KEY ("media_kit_id") REFERENCES "public"."media_kits"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_views_media_kit_id" ON "media_kit_views" USING btree ("media_kit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_views_viewed_at" ON "media_kit_views" USING btree ("viewed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_views_country" ON "media_kit_views" USING btree ("country");
