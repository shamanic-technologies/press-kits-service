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
    workflowName: z.string().nullable(),
    shareToken: z.string().uuid().nullable(),
    title: z.string().nullable(),
    iconUrl: z.string().nullable(),
    mdxPageContent: z.string().nullable(),
    parentMediaKitId: z.string().uuid().nullable(),
    status: MediaKitStatusEnum,
    denialReason: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("MediaKitResponse");

export const MediaKitListResponseSchema = z
  .object({ mediaKits: z.array(MediaKitResponseSchema) })
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
    mediaKitId: z.string().uuid().optional(),
    instruction: z.string(),
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
    orgId: z.string().optional(),
    mdxContent: z.string(),
    title: z.string().optional(),
    iconUrl: z.string().optional(),
  })
  .openapi("UpsertGenerationResultRequest");

export const MediaKitSetupSchema = z
  .object({
    orgId: z.string(),
    hasKit: z.boolean(),
    status: MediaKitStatusEnum.nullable(),
    isSetup: z.boolean(),
  })
  .openapi("MediaKitSetup");

export const MediaKitSetupListResponseSchema = z
  .object({ organizations: z.array(MediaKitSetupSchema) })
  .openapi("MediaKitSetupListResponse");

export const HealthBulkItemSchema = z
  .object({
    orgId: z.string(),
    hasValidated: z.boolean(),
    hasDrafted: z.boolean(),
    totalKits: z.number(),
  })
  .openapi("HealthBulkItem");

export const HealthBulkResponseSchema = z
  .object({ organizations: z.array(HealthBulkItemSchema) })
  .openapi("HealthBulkResponse");

const HealthResponseSchema = z
  .object({ status: z.string(), service: z.string() })
  .openapi("HealthResponse");

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
  summary: "Create or edit a media kit",
  description: "Idempotent create-or-edit. Uses x-org-id header to find the latest active kit for the org, or creates a new one if none exists. Optionally pass mediaKitId in the body to target a specific kit.",
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
  summary: "Get latest media kit for org (from x-org-id header)",
  tags: ["Internal"],
  responses: {
    200: { description: "Media kit", content: { "application/json": { schema: MediaKitResponseSchema.nullable() } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/internal/media-kits/generation-data",
  summary: "Get data for generation workflow (org from x-org-id header)",
  tags: ["Internal"],
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
  method: "get",
  path: "/internal/media-kits/stale",
  summary: "Get stale media kits (>1 month old)",
  tags: ["Internal"],
  responses: {
    200: { description: "Stale kits", content: { "application/json": { schema: MediaKitListResponseSchema } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/internal/media-kits/setup",
  summary: "Get setup status for all orgs",
  tags: ["Internal"],
  responses: {
    200: { description: "Setup status", content: { "application/json": { schema: MediaKitSetupListResponseSchema } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/internal/health/bulk",
  summary: "Bulk health check per org",
  tags: ["Internal"],
  responses: {
    200: { description: "Bulk health", content: { "application/json": { schema: HealthBulkResponseSchema } } },
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
