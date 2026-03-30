import { z } from "zod";
import { extendZodWithOpenApi, OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);
export const registry = new OpenAPIRegistry();

// --- Shared ---

const ErrorResponseSchema = z
  .object({ error: z.string().openapi({ example: "Media kit not found" }) })
  .openapi("ErrorResponse");

const mediaKitStatusValues = ["drafted", "generating", "validated", "denied", "failed", "archived"] as const;
const MediaKitStatusEnum = z.enum(mediaKitStatusValues).openapi("MediaKitStatus", {
  description: "drafted = generation complete, pending review. generating = workflow in progress. validated = approved and live. denied = rejected by user. failed = generation error or timeout. archived = superseded by a newer version.",
});

// --- Required Headers (all protected endpoints) ---

const requiredHeaders = z.object({
  "x-org-id": z.string().openapi({ description: "Internal org UUID from client-service", example: "org_3ANNRtJtvq2vahygqOSJ7IjRfp1" }),
  "x-user-id": z.string().openapi({ description: "Internal user UUID from client-service", example: "usr_7BXkm2pTq1wLnHyjRfK4d" }),
  "x-run-id": z.string().openapi({ description: "Run ID for tracing (from runs-service)", example: "550e8400-e29b-41d4-a716-446655440000" }),
});

const optionalContextHeaders = z.object({
  "x-brand-id": z.string().optional().openapi({ description: "Brand UUID — scopes kit to a specific brand" }),
  "x-campaign-id": z.string().optional().openapi({ description: "Campaign UUID — scopes kit to a specific campaign" }),
  "x-feature-slug": z.string().optional().openapi({ description: "Feature slug (e.g. 'press-kit-v2')" }),
  "x-workflow-slug": z.string().optional().openapi({ description: "Workflow slug override for generation" }),
  "x-feature-dynasty-slug": z.string().optional().openapi({ description: "Stable feature dynasty slug (version-independent)" }),
  "x-workflow-dynasty-slug": z.string().optional().openapi({ description: "Stable workflow dynasty slug (version-independent)" }),
});

// --- Media Kit Schemas ---

export const MediaKitResponseSchema = z
  .object({
    id: z.string().uuid().openapi({ example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }),
    orgId: z.string().openapi({ example: "org_3ANNRtJtvq2vahygqOSJ7IjRfp1" }),
    brandId: z.string().nullable().openapi({ example: "a6b5fdad-b31d-4fa2-b34b-1cec4cb21ce5" }),
    campaignId: z.string().nullable().openapi({ example: "c7d8e9f0-a1b2-3456-cdef-789012345678" }),
    featureSlug: z.string().nullable().openapi({ example: "press-kit-v2" }),
    workflowSlug: z.string().nullable().openapi({ example: "generate-press-kit" }),
    featureDynastySlug: z.string().nullable().openapi({ example: "press-kit-page-generation" }),
    workflowDynastySlug: z.string().nullable().openapi({ example: "generate-press-kit" }),
    shareToken: z.string().uuid().nullable().openapi({
      description: "Public share token. Use with GET /public/{token} to access the kit without authentication.",
      example: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    }),
    title: z.string().nullable().openapi({ example: "Acme Corp Press Kit — Q1 2026" }),
    iconUrl: z.string().nullable().openapi({ example: "https://cdn.example.com/brands/acme/icon.png" }),
    mdxPageContent: z.string().nullable().openapi({
      description: "Full MDX content of the press kit page.",
      example: "# Acme Corp\n\nAcme Corp is a leading provider of innovative SaaS solutions...",
    }),
    parentMediaKitId: z.string().uuid().nullable().openapi({
      description:
        "ID of the kit this version was forked from. Forms a linked list of versions. Null for the first kit in a scope.",
      example: null,
    }),
    status: MediaKitStatusEnum,
    denialReason: z.string().nullable().openapi({
      description: "Reason for denial (when status is 'denied') or failure message (when status is 'failed').",
      example: null,
    }),
    createdAt: z.string().openapi({ example: "2026-03-29T10:00:00.000Z" }),
    updatedAt: z.string().openapi({ example: "2026-03-29T10:05:00.000Z" }),
    publicUrl: z.string().nullable().openapi({
      description: "Full public URL for the press kit page. Ready to open in a browser.",
      example: "https://press-kits.distribute.you/public/f47ac10b-58cc-4372-a567-0e02b2c3d479",
    }),
  })
  .openapi("MediaKitResponse");

export const MediaKitSummarySchema = MediaKitResponseSchema.extend({
  contentExcerpt: z.string().nullable().openapi({
    description: "First ~200 characters of the MDX content, stripped of markup. Useful for card/grid previews.",
    example: "Acme Corp is a leading provider of innovative solutions in the SaaS space, serving over 10,000 customers worldwide...",
  }),
}).omit({ mdxPageContent: true }).openapi("MediaKitSummary");

export const MediaKitListResponseSchema = z
  .object({ mediaKits: z.array(MediaKitSummarySchema) })
  .openapi("MediaKitListResponse");

export const UpdateMdxRequestSchema = z
  .object({
    mdxContent: z.string().openapi({ example: "# Updated Press Kit\n\nNew content goes here..." }),
  })
  .openapi("UpdateMdxRequest");

export const UpdateStatusRequestSchema = z
  .object({
    status: MediaKitStatusEnum.openapi({ example: "denied" }),
    denialReason: z.string().optional().openapi({
      description: "Required when setting status to 'denied'. Explains why the kit was rejected.",
      example: "Tone is too informal for our brand guidelines",
    }),
  })
  .openapi("UpdateStatusRequest");

export const CreateMediaKitRequestSchema = z
  .object({
    mediaKitId: z.string().uuid().optional().openapi({
      description:
        "Target a specific media kit. If omitted, the latest active kit in the scope (org + brand + campaign) is used. If no kit exists, a new one is created from scratch.",
      example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    }),
    instruction: z.string().openapi({
      description: "User instruction for the generation workflow.",
      example: "Create a professional press kit highlighting our Q1 2026 product launches and sustainability initiatives",
    }),
  })
  .openapi("CreateMediaKitRequest");

// --- Public Schemas ---

export const PublicMediaKitResponseSchema = z
  .object({
    mediaKit: MediaKitResponseSchema,
  })
  .openapi("PublicMediaKitResponse");

// --- Internal Schemas ---

export const EmailDataResponseSchema = z
  .object({
    status: MediaKitStatusEnum.nullable().openapi({ example: "validated" }),
    title: z.string().nullable().openapi({ example: "Acme Corp Press Kit — Q1 2026" }),
    pressKitUrl: z.string().nullable().openapi({ description: "Full public URL for the press kit page.", example: "https://press-kits.distribute.you/public/f47ac10b-58cc-4372-a567-0e02b2c3d479" }),
    content: z.string().nullable().openapi({ example: "# Acme Corp\n\nLeading SaaS provider..." }),
  })
  .openapi("EmailDataResponse");

export const GenerationDataResponseSchema = z
  .object({
    currentKit: MediaKitResponseSchema.nullable(),
    instructions: z.array(
      z.object({
        id: z.string().uuid(),
        instruction: z.string(),
        instructionType: z.string(),
        createdAt: z.string(),
      })
    ),
    feedbacks: z.array(
      z.object({
        id: z.string().uuid(),
        denialReason: z.string(),
      })
    ),
  })
  .openapi("GenerationDataResponse");

export const UpsertGenerationResultRequestSchema = z
  .object({
    mediaKitId: z.string().uuid().optional().openapi({
      description: "Target kit ID. If omitted, finds the generating kit by orgId.",
      example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    }),
    orgId: z.string().optional().openapi({
      description: "Org ID fallback when mediaKitId is not provided.",
      example: "org_3ANNRtJtvq2vahygqOSJ7IjRfp1",
    }),
    mdxContent: z.string().openapi({ example: "# Generated Press Kit\n\nContent produced by the generation workflow..." }),
    title: z.string().optional().openapi({ example: "Acme Corp Press Kit — Q1 2026" }),
    iconUrl: z.string().optional().openapi({ example: "https://cdn.example.com/brands/acme/icon.png" }),
  })
  .openapi("UpsertGenerationResultRequest");

const HealthResponseSchema = z
  .object({
    status: z.string().openapi({ example: "ok" }),
    service: z.string().openapi({ example: "press-kits-service" }),
  })
  .openapi("HealthResponse");

// --- Stats Schemas ---

const ViewStatsGroupByEnum = z.enum(["country", "mediaKitId", "day", "brandId", "campaignId", "featureSlug", "workflowSlug", "featureDynastySlug", "workflowDynastySlug"]).openapi("ViewStatsGroupBy");

export const ViewStatsQuerySchema = z
  .object({
    brandId: z.string().uuid().optional().openapi({ description: "Filter by brand UUID" }),
    campaignId: z.string().uuid().optional().openapi({ description: "Filter by campaign UUID" }),
    mediaKitId: z.string().uuid().optional().openapi({ description: "Filter by specific media kit UUID" }),
    featureSlug: z.string().optional().openapi({ description: "Filter by feature slug (e.g. 'press-kit-v2')" }),
    workflowSlug: z.string().optional().openapi({ description: "Filter by workflow slug" }),
    featureDynastySlug: z.string().optional().openapi({ description: "Filter by feature dynasty slug (stable across versions)" }),
    workflowDynastySlug: z.string().optional().openapi({ description: "Filter by workflow dynasty slug (stable across versions)" }),
    from: z.string().datetime().optional().openapi({ description: "Start of date range (ISO 8601)", example: "2026-03-01T00:00:00Z" }),
    to: z.string().datetime().optional().openapi({ description: "End of date range (ISO 8601)", example: "2026-03-31T23:59:59Z" }),
    groupBy: ViewStatsGroupByEnum.optional().openapi({ description: "Group results by dimension. Omit for flat totals." }),
  })
  .openapi("ViewStatsQuery");

export const ViewStatsFlatResponseSchema = z
  .object({
    totalViews: z.number().openapi({ example: 1250 }),
    uniqueVisitors: z.number().openapi({ example: 843 }),
    lastViewedAt: z.string().nullable().openapi({ example: "2026-03-29T14:32:00.000Z" }),
    firstViewedAt: z.string().nullable().openapi({ example: "2026-03-01T09:15:00.000Z" }),
  })
  .openapi("ViewStatsFlatResponse");

export const ViewStatsGroupedResponseSchema = z
  .object({
    groups: z.array(
      z.object({
        key: z.string().nullable().openapi({ description: "Group key (country code, kit ID, or date depending on groupBy)", example: "US" }),
        totalViews: z.number().openapi({ example: 520 }),
        uniqueVisitors: z.number().openapi({ example: 340 }),
        lastViewedAt: z.string().nullable().openapi({ example: "2026-03-29T14:32:00.000Z" }),
      })
    ),
  })
  .openapi("ViewStatsGroupedResponse");

// --- Cost Stats Schemas ---

const CostStatsGroupByEnum = z.enum(["mediaKitId", "brandId", "campaignId", "featureSlug", "workflowSlug", "featureDynastySlug", "workflowDynastySlug"]).openapi("CostStatsGroupBy");

export const CostStatsQuerySchema = z
  .object({
    mediaKitId: z.string().uuid().optional().openapi({ description: "Filter by specific media kit UUID" }),
    brandId: z.string().uuid().optional().openapi({ description: "Filter by brand UUID" }),
    campaignId: z.string().uuid().optional().openapi({ description: "Filter by campaign UUID" }),
    featureSlug: z.string().optional().openapi({ description: "Filter by feature slug (e.g. 'press-kit-v2')" }),
    workflowSlug: z.string().optional().openapi({ description: "Filter by workflow slug" }),
    featureDynastySlug: z.string().optional().openapi({ description: "Filter by feature dynasty slug (stable across versions)" }),
    workflowDynastySlug: z.string().optional().openapi({ description: "Filter by workflow dynasty slug (stable across versions)" }),
    groupBy: CostStatsGroupByEnum.optional().openapi({ description: "Group results by dimension. Omit for flat totals." }),
  })
  .openapi("CostStatsQuery");

const CostStatsGroupSchema = z
  .object({
    dimensions: z.record(z.string(), z.string().nullable()).openapi({ description: "Group key dimensions" }),
    totalCostInUsdCents: z.number().openapi({ example: 2050 }),
    actualCostInUsdCents: z.number().openapi({ example: 2050 }),
    provisionedCostInUsdCents: z.number().openapi({ example: 0 }),
    runCount: z.number().openapi({ example: 3 }),
  })
  .openapi("CostStatsGroup");

export const CostStatsResponseSchema = z
  .object({
    groups: z.array(CostStatsGroupSchema),
  })
  .openapi("CostStatsResponse");

// --- Register Paths ---

// Health
registry.registerPath({
  method: "get",
  path: "/health",
  summary: "Health check",
  tags: ["Health"],
  responses: {
    200: { description: "Service is healthy", content: { "application/json": { schema: HealthResponseSchema } } },
  },
});

// Media Kits
registry.registerPath({
  method: "get",
  path: "/media-kits",
  summary: "List media kits",
  description: "Returns active media kits (validated, drafted, generating). At least one filter is required. Results are sorted by status priority (validated first) then by most recently updated.",
  tags: ["Media Kits"],
  request: {
    headers: requiredHeaders,
    query: z.object({
      org_id: z.string().optional().openapi({ description: "Filter by org UUID. At least one of org_id, campaign_id, or brand_id is required.", example: "org_3ANNRtJtvq2vahygqOSJ7IjRfp1" }),
      title: z.string().optional().openapi({ description: "Case-insensitive title search (partial match)", example: "Q1 2026" }),
      campaign_id: z.string().optional().openapi({ description: "Filter by campaign UUID", example: "c7d8e9f0-a1b2-3456-cdef-789012345678" }),
      brand_id: z.string().optional().openapi({ description: "Filter by brand UUID", example: "a6b5fdad-b31d-4fa2-b34b-1cec4cb21ce5" }),
    }),
  },
  responses: {
    200: { description: "Media kits list", content: { "application/json": { schema: MediaKitListResponseSchema } } },
    400: { description: "Missing required filter", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/media-kits/{id}",
  summary: "Get media kit by ID",
  description: "Returns full media kit including MDX content. Kits stuck in 'generating' for over 30 minutes are automatically transitioned to 'failed'.",
  tags: ["Media Kits"],
  request: {
    headers: requiredHeaders,
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: { description: "Media kit", content: { "application/json": { schema: MediaKitResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: "patch",
  path: "/media-kits/{id}/mdx",
  summary: "Update MDX content",
  description: "Directly update the MDX page content of a media kit. Typically used for manual edits after generation.",
  tags: ["Media Kits"],
  request: {
    headers: requiredHeaders,
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: UpdateMdxRequestSchema } } },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: MediaKitResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: "patch",
  path: "/media-kits/{id}/status",
  summary: "Update media kit status",
  description: "Manually update a kit's status. Use 'denied' with a denialReason to reject a kit for rework.",
  tags: ["Media Kits"],
  request: {
    headers: requiredHeaders,
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: UpdateStatusRequestSchema } } },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: MediaKitResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/media-kits",
  summary: "Create or edit a media kit (versioning via fork)",
  description: [
    "Triggers a generation workflow for a media kit. The behavior depends on the current state:",
    "",
    "**No existing kit in scope** → Creates a new kit with `status: generating` and `parentMediaKitId: null`.",
    "",
    "**Existing kit is `validated` or `drafted`** → **Forks**: creates a NEW kit (new UUID) with `status: generating`, copying the content (title, icon, MDX) from the original. The new kit's `parentMediaKitId` points to the original, preserving full version history. The original kit is NOT modified or archived at this stage.",
    "",
    "**Existing kit is `generating`** → Updates the existing generating kit in place (adds the instruction, refreshes context headers). No new kit is created.",
    "",
    "Scope is determined by `x-org-id` + `x-brand-id` + `x-campaign-id` headers. Pass `mediaKitId` in the body to target a specific kit instead of auto-resolving by scope.",
    "",
    "To validate the generated result and archive the previous version, call `POST /media-kits/{id}/validate`. To discard the generating kit and restore the parent, call `POST /media-kits/{id}/cancel`.",
  ].join("\n"),
  tags: ["Media Kits"],
  request: {
    headers: requiredHeaders.merge(optionalContextHeaders),
    body: { content: { "application/json": { schema: CreateMediaKitRequestSchema } } },
  },
  responses: {
    200: { description: "Media kit created or updated", content: { "application/json": { schema: MediaKitResponseSchema } } },
    404: { description: "Media kit not found (when mediaKitId specified)", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/media-kits/{id}/validate",
  summary: "Validate media kit",
  description: "Approves the kit and sets it to 'validated'. Automatically archives any previously validated kit in the same scope (org + campaign). Sends a press_kit_ready email notification.",
  tags: ["Media Kits"],
  request: {
    headers: requiredHeaders,
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: { description: "Validated", content: { "application/json": { schema: MediaKitResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/media-kits/{id}/cancel",
  summary: "Cancel draft media kit",
  description: "Deletes the generating/drafted kit. If the kit was forked from a parent, the parent is restored to 'drafted' status.",
  tags: ["Media Kits"],
  request: {
    headers: requiredHeaders,
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: { description: "Draft cancelled", content: { "application/json": { schema: z.object({ success: z.boolean() }) } } },
  },
});

// Public
registry.registerPath({
  method: "get",
  path: "/public/{token}",
  summary: "Get public media kit page by share token",
  description: "Returns a fully rendered HTML page for the press kit. Intended to be opened in a browser.",
  tags: ["Public"],
  request: { params: z.object({ token: z.string().uuid() }) },
  responses: {
    200: { description: "Rendered HTML press kit page", content: { "text/html": { schema: z.string() } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

// Stats
registry.registerPath({
  method: "get",
  path: "/media-kits/stats/views",
  summary: "Get view stats for media kits",
  description: "Returns aggregated view stats for the org's media kits. Supports filters (brandId, campaignId, mediaKitId, date range) and optional groupBy (country, mediaKitId, day). Without groupBy returns flat totals; with groupBy returns grouped results.",
  tags: ["Stats"],
  request: {
    headers: requiredHeaders,
    query: ViewStatsQuerySchema,
  },
  responses: {
    200: {
      description: "View stats (flat or grouped depending on groupBy param)",
      content: {
        "application/json": {
          schema: z.union([ViewStatsFlatResponseSchema, ViewStatsGroupedResponseSchema]),
        },
      },
    },
  },
});

// Cost Stats
registry.registerPath({
  method: "get",
  path: "/media-kits/stats/costs",
  summary: "Get cost stats for media kit generations",
  description: "Returns aggregated generation/edit costs by querying runs-service for all runs associated with media kits. Supports filters (mediaKitId, brandId, campaignId) and optional groupBy (mediaKitId). Without groupBy returns flat totals; with groupBy returns grouped results.",
  tags: ["Stats"],
  request: {
    headers: requiredHeaders,
    query: CostStatsQuerySchema,
  },
  responses: {
    200: {
      description: "Cost stats (flat or grouped depending on groupBy param)",
      content: { "application/json": { schema: CostStatsResponseSchema } },
    },
  },
});

// Admin
registry.registerPath({
  method: "get",
  path: "/admin/media-kits",
  summary: "List all media kits (admin)",
  description: "Returns all media kits across all orgs. Supports text search on title.",
  tags: ["Admin"],
  request: {
    headers: requiredHeaders,
    query: z.object({ search: z.string().optional().openapi({ description: "Case-insensitive title search", example: "Acme" }) }),
  },
  responses: {
    200: { description: "Admin kit list", content: { "application/json": { schema: MediaKitListResponseSchema } } },
  },
});

registry.registerPath({
  method: "delete",
  path: "/admin/media-kits/{id}",
  summary: "Delete media kit (admin)",
  description: "Permanently deletes a media kit and its associated instructions (cascade).",
  tags: ["Admin"],
  request: {
    headers: requiredHeaders,
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: z.object({ success: z.boolean() }) } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

// Internal
registry.registerPath({
  method: "get",
  path: "/internal/media-kits/current",
  summary: "Get latest media kit for scope",
  description: "Returns the most recently updated media kit for the given org, optionally scoped by brand and campaign. Used by other services to check current press kit state.",
  tags: ["Internal"],
  request: {
    headers: requiredHeaders,
    query: z.object({
      brand_id: z.string().optional().openapi({ description: "Filter by brand UUID" }),
      campaign_id: z.string().optional().openapi({ description: "Filter by campaign UUID" }),
    }),
  },
  responses: {
    200: { description: "Media kit or null if none exists", content: { "application/json": { schema: MediaKitResponseSchema.nullable() } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/internal/media-kits/generation-data",
  summary: "Get data for generation workflow",
  description: "Returns the currently generating kit with its instructions and past denial feedbacks. Used by the generation workflow to build the LLM prompt.",
  tags: ["Internal"],
  request: {
    headers: requiredHeaders,
    query: z.object({
      media_kit_id: z.string().uuid().optional().openapi({ description: "Target a specific kit. If omitted, finds the generating kit for the org." }),
    }),
  },
  responses: {
    200: { description: "Generation data", content: { "application/json": { schema: GenerationDataResponseSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/internal/media-kits/generation-result",
  summary: "Upsert generation result (workflow callback)",
  description: "Called by the generation workflow on success. Updates the generating kit with the produced MDX content and transitions it to 'drafted' status.",
  tags: ["Internal"],
  request: {
    headers: requiredHeaders,
    body: { content: { "application/json": { schema: UpsertGenerationResultRequestSchema } } },
  },
  responses: {
    200: { description: "Kit updated to drafted", content: { "application/json": { schema: MediaKitResponseSchema } } },
    404: { description: "No generating kit found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/internal/email-data/{orgId}",
  summary: "Get press kit data for email templates",
  description: "Returns the validated press kit data for a given org. Used by transactional-email-service to populate email templates.",
  tags: ["Internal"],
  request: {
    headers: requiredHeaders,
    params: z.object({ orgId: z.string().openapi({ description: "Internal org UUID", example: "org_3ANNRtJtvq2vahygqOSJ7IjRfp1" }) }),
  },
  responses: {
    200: { description: "Email data (all fields null if no validated kit exists)", content: { "application/json": { schema: EmailDataResponseSchema } } },
  },
});
