CREATE TYPE "media_kit_run_type" AS ENUM ('generation', 'edit');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_kit_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_kit_id" uuid NOT NULL,
	"run_id" varchar NOT NULL,
	"parent_run_id" varchar,
	"run_type" "media_kit_run_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "media_kit_runs" ADD CONSTRAINT "media_kit_runs_media_kit_id_media_kits_id_fk" FOREIGN KEY ("media_kit_id") REFERENCES "public"."media_kits"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_runs_media_kit_id" ON "media_kit_runs" USING btree ("media_kit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_runs_run_id" ON "media_kit_runs" USING btree ("run_id");
