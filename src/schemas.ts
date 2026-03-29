import { z } from "zod";
import { extendZodWithOpenApi, OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);
export const registry = new OpenAPIRegistry();

// --- Shared ---

const ErrorResponseSchema = z
  .object({ error: z.string() })
  .openapi("ErrorResponse");

const mediaKitStatusValues = ["drafted", "generating", "validated", "denied", "archived"] as const;
const MediaKitStatusEnum = z.enum(mediaKitStatusValues).openapi("MediaKitStatus");

// --- Media Kit Schemas ---

export const MediaKitResponseSchema = z
  .object({
    id: z.string().uuid(),
    orgId: z.string(),
    brandId: z.string().nullable(),
    campaignId: z.string().nullable(),
    featureSlug: z.string().nullable(),
    workflowSlug: z.string().nullable(),
    shareToken: z.string().uuid().nullable(),
    title: z.string().nullable(),
    iconUrl: z.string().nullable(),
    mdxPageContent: z.string().nullable(),
    parentMediaKitId: z.string().uuid().nullable().openapi({
      description:
        "ID of the kit this version was forked from. Forms a linked list of versions. Null for the first kit in a scope.",
    }),
    status: MediaKitStatusEnum,
    denialReason: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
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
    mdxContent: z.string(),
  })
  .openapi("UpdateMdxRequest");

export const UpdateStatusRequestSchema = z
  .object({
    status: MediaKitStatusEnum,
    denialReason: z.string().optional(),
  })
  .openapi("UpdateStatusRequest");

export const CreateMediaKitRequestSchema = z
  .object({
    mediaKitId: z.string().uuid().optional().openapi({
      description:
        "Target a specific media kit. If omitted, the latest active kit in the scope (org + brand + campaign) is used. If no kit exists, a new one is created from scratch.",
    }),
    instruction: z.string().openapi({
      description: "User instruction for the generation workflow (e.g. 'Make it more concise', 'Add a sustainability section').",
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
    status: MediaKitStatusEnum.nullable(),
    title: z.string().nullable(),
    pressKitUrl: z.string().nullable(),
    content: z.string().nullable(),
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
    mediaKitId: z.string().uuid().optional(),
    orgId: z.string().optional(),
    mdxContent: z.string(),
    title: z.string().optional(),
    iconUrl: z.string().optional(),
  })
  .openapi("UpsertGenerationResultRequest");

export const GenerationFailureRequestSchema = z
  .object({
    mediaKitId: z.string().uuid().optional(),
    orgId: z.string().optional(),
    reason: z.string().optional().openapi({
      description: "Reason the generation failed (e.g. workflow timeout, LLM error). Stored as denialReason.",
    }),
  })
  .openapi("GenerationFailureRequest");

const HealthResponseSchema = z
  .object({ status: z.string(), service: z.string() })
  .openapi("HealthResponse");

// --- Stats Schemas ---

const ViewStatsGroupByEnum = z.enum(["country", "mediaKitId", "day"]).openapi("ViewStatsGroupBy");

export const ViewStatsQuerySchema = z
  .object({
    brandId: z.string().uuid().optional(),
    campaignId: z.string().uuid().optional(),
    mediaKitId: z.string().uuid().optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    groupBy: ViewStatsGroupByEnum.optional(),
  })
  .openapi("ViewStatsQuery");

export const ViewStatsFlatResponseSchema = z
  .object({
    totalViews: z.number(),
    uniqueVisitors: z.number(),
    lastViewedAt: z.string().nullable(),
    firstViewedAt: z.string().nullable(),
  })
  .openapi("ViewStatsFlatResponse");

export const ViewStatsGroupedResponseSchema = z
  .object({
    groups: z.array(
      z.object({
        key: z.string().nullable(),
        totalViews: z.number(),
        uniqueVisitors: z.number(),
        lastViewedAt: z.string().nullable(),
      })
    ),
  })
  .openapi("ViewStatsGroupedResponse");

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
  tags: ["Media Kits"],
  request: {
    query: z.object({
      org_id: z.string().optional(),
      title: z.string().optional(),
      campaign_id: z.string().optional(),
      brand_id: z.string().optional(),
    }),
  },
  responses: {
    200: { description: "Media kits list", content: { "application/json": { schema: MediaKitListResponseSchema } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/media-kits/{id}",
  summary: "Get media kit by ID",
  tags: ["Media Kits"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Media kit", content: { "application/json": { schema: MediaKitResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: "patch",
  path: "/media-kits/{id}/mdx",
  summary: "Update MDX content",
  tags: ["Media Kits"],
  request: {
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
  tags: ["Media Kits"],
  request: {
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
  request: { body: { content: { "application/json": { schema: CreateMediaKitRequestSchema } } } },
  responses: {
    200: { description: "Media kit created or updated", content: { "application/json": { schema: MediaKitResponseSchema } } },
    404: { description: "Media kit not found (when mediaKitId specified)", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/media-kits/{id}/validate",
  summary: "Validate media kit",
  tags: ["Media Kits"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Validated", content: { "application/json": { schema: MediaKitResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/media-kits/{id}/cancel",
  summary: "Cancel draft media kit",
  tags: ["Media Kits"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Draft cancelled", content: { "application/json": { schema: z.object({ success: z.boolean() }) } } },
  },
});

// Public
registry.registerPath({
  method: "get",
  path: "/public/{token}",
  summary: "Get public media kit by share token",
  tags: ["Public"],
  request: { params: z.object({ token: z.string().uuid() }) },
  responses: {
    200: { description: "Public media kit", content: { "application/json": { schema: PublicMediaKitResponseSchema } } },
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

// Admin
registry.registerPath({
  method: "get",
  path: "/admin/media-kits",
  summary: "List all media kits",
  tags: ["Admin"],
  request: { query: z.object({ search: z.string().optional() }) },
  responses: {
    200: { description: "Admin kit list", content: { "application/json": { schema: MediaKitListResponseSchema } } },
  },
});

registry.registerPath({
  method: "delete",
  path: "/admin/media-kits/{id}",
  summary: "Delete media kit",
  tags: ["Admin"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: z.object({ success: z.boolean() }) } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

// Internal
registry.registerPath({
  method: "get",
  path: "/internal/media-kits/current",
  summary: "Get latest media kit for scope (x-org-id + optional brand_id/campaign_id query params)",
  tags: ["Internal"],
  request: {
    query: z.object({
      brand_id: z.string().optional(),
      campaign_id: z.string().optional(),
    }),
  },
  responses: {
    200: { description: "Media kit", content: { "application/json": { schema: MediaKitResponseSchema.nullable() } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/internal/media-kits/generation-data",
  summary: "Get data for generation workflow",
  tags: ["Internal"],
  request: {
    query: z.object({
      media_kit_id: z.string().uuid().optional(),
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
  tags: ["Internal"],
  request: { body: { content: { "application/json": { schema: UpsertGenerationResultRequestSchema } } } },
  responses: {
    200: { description: "Upserted", content: { "application/json": { schema: MediaKitResponseSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/internal/media-kits/generation-failure",
  summary: "Report generation failure (workflow failure callback)",
  description: "Called by the workflow service when a generation workflow fails or times out. Transitions the generating kit to denied status with the failure reason.",
  tags: ["Internal"],
  request: { body: { content: { "application/json": { schema: GenerationFailureRequestSchema } } } },
  responses: {
    200: { description: "Kit marked as denied", content: { "application/json": { schema: MediaKitResponseSchema } } },
    404: { description: "No generating kit found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/internal/email-data/{orgId}",
  summary: "Get press kit data for email templates",
  tags: ["Internal"],
  request: { params: z.object({ orgId: z.string() }) },
  responses: {
    200: { description: "Email data", content: { "application/json": { schema: EmailDataResponseSchema } } },
  },
});
