import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
  uniqueIndex,
  pgEnum,
} from "drizzle-orm/pg-core";

export const mediaKitRunTypeEnum = pgEnum("media_kit_run_type", [
  "generation",
  "edit",
]);

export const mediaKitStatusEnum = pgEnum("media_kit_status", [
  "drafted",
  "generating",
  "validated",
  "denied",
  "failed",
  "archived",
]);

export const mediaKits = pgTable(
  "media_kits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: varchar("org_id").notNull(),
    brandId: varchar("brand_id"),
    campaignId: varchar("campaign_id"),
    featureSlug: varchar("feature_slug"),
    workflowSlug: varchar("workflow_slug"),
    shareToken: uuid("share_token").unique().defaultRandom(),
    title: text("title"),
    iconUrl: text("icon_url"),
    brandDomain: text("brand_domain"),
    mdxPageContent: text("mdx_page_content"),
    parentMediaKitId: uuid("parent_media_kit_id"),
    status: mediaKitStatusEnum("status").notNull(),
    denialReason: text("denial_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_media_kits_ext_org_id").on(table.orgId),
    index("idx_media_kits_status").on(table.status),
    index("idx_media_kits_campaign_id").on(table.campaignId),
    uniqueIndex("idx_media_kits_share_token").on(table.shareToken),
  ]
);

export const mediaKitInstructions = pgTable(
  "media_kit_instructions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mediaKitId: uuid("media_kit_id")
      .references(() => mediaKits.id, { onDelete: "cascade" })
      .notNull(),
    instruction: text("instruction").notNull(),
    instructionType: text("instruction_type").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("idx_instructions_media_kit_id").on(table.mediaKitId)]
);

export const mediaKitViews = pgTable(
  "media_kit_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mediaKitId: uuid("media_kit_id")
      .references(() => mediaKits.id, { onDelete: "cascade" })
      .notNull(),
    viewedAt: timestamp("viewed_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: varchar("ip_address"),
    userAgent: text("user_agent"),
    country: varchar("country"),
  },
  (table) => [
    index("idx_views_media_kit_id").on(table.mediaKitId),
    index("idx_views_viewed_at").on(table.viewedAt),
    index("idx_views_country").on(table.country),
  ]
);

export const mediaKitRuns = pgTable(
  "media_kit_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mediaKitId: uuid("media_kit_id")
      .references(() => mediaKits.id, { onDelete: "cascade" })
      .notNull(),
    runId: varchar("run_id").notNull(),
    parentRunId: varchar("parent_run_id"),
    runType: mediaKitRunTypeEnum("run_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_runs_media_kit_id").on(table.mediaKitId),
    index("idx_runs_run_id").on(table.runId),
  ]
);

export type MediaKit = typeof mediaKits.$inferSelect;
export type NewMediaKit = typeof mediaKits.$inferInsert;
export type MediaKitInstruction = typeof mediaKitInstructions.$inferSelect;
export type NewMediaKitInstruction = typeof mediaKitInstructions.$inferInsert;
export type MediaKitView = typeof mediaKitViews.$inferSelect;
export type NewMediaKitView = typeof mediaKitViews.$inferInsert;
export type MediaKitRun = typeof mediaKitRuns.$inferSelect;
export type NewMediaKitRun = typeof mediaKitRuns.$inferInsert;
