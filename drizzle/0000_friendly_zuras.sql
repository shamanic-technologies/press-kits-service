CREATE TYPE "public"."media_kit_status" AS ENUM('drafted', 'generating', 'validated', 'denied', 'archived');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_kit_instructions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_kit_id" uuid NOT NULL,
	"instruction" text NOT NULL,
	"instruction_type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_kits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_organization_id" uuid,
	"clerk_organization_id" varchar,
	"organization_id" uuid,
	"title" text,
	"icon_url" text,
	"mdx_page_content" text,
	"jsx_page_content" text,
	"json_page_content" jsonb,
	"notion_page_content" text,
	"parent_media_kit_id" uuid,
	"status" "media_kit_status" NOT NULL,
	"denial_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_organization_id" varchar NOT NULL,
	"name" varchar,
	"share_token" uuid DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_clerk_organization_id_unique" UNIQUE("clerk_organization_id"),
	CONSTRAINT "organizations_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "media_kit_instructions" ADD CONSTRAINT "media_kit_instructions_media_kit_id_media_kits_id_fk" FOREIGN KEY ("media_kit_id") REFERENCES "public"."media_kits"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "media_kits" ADD CONSTRAINT "media_kits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_instructions_media_kit_id" ON "media_kit_instructions" USING btree ("media_kit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_media_kits_org_id" ON "media_kits" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_media_kits_clerk_org_id" ON "media_kits" USING btree ("clerk_organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_media_kits_status" ON "media_kits" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_organizations_clerk_org_id" ON "organizations" USING btree ("clerk_organization_id");