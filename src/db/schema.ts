import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  pgEnum,
} from "drizzle-orm/pg-core";

export const mediaKitStatusEnum = pgEnum("media_kit_status", [
  "drafted",
  "generating",
  "validated",
  "denied",
  "archived",
]);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkOrganizationId: varchar("clerk_organization_id").unique().notNull(),
    name: varchar("name"),
    shareToken: uuid("share_token").unique().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_organizations_clerk_org_id").on(table.clerkOrganizationId)]
);

export const mediaKits = pgTable(
  "media_kits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientOrganizationId: uuid("client_organization_id"),
    clerkOrganizationId: varchar("clerk_organization_id"),
    organizationId: uuid("organization_id").references(() => organizations.id),
    title: text("title"),
    iconUrl: text("icon_url"),
    mdxPageContent: text("mdx_page_content"),
    jsxPageContent: text("jsx_page_content"),
    jsonPageContent: jsonb("json_page_content"),
    notionPageContent: text("notion_page_content"),
    parentMediaKitId: uuid("parent_media_kit_id"),
    status: mediaKitStatusEnum("status").notNull(),
    denialReason: text("denial_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_media_kits_org_id").on(table.organizationId),
    index("idx_media_kits_clerk_org_id").on(table.clerkOrganizationId),
    index("idx_media_kits_status").on(table.status),
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

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type MediaKit = typeof mediaKits.$inferSelect;
export type NewMediaKit = typeof mediaKits.$inferInsert;
export type MediaKitInstruction = typeof mediaKitInstructions.$inferSelect;
export type NewMediaKitInstruction = typeof mediaKitInstructions.$inferInsert;
