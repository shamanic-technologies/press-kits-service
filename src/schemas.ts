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

// --- Organization Schemas ---

export const UpsertOrganizationRequestSchema = z
  .object({
    orgId: z.string(),
    name: z.string().optional(),
  })
  .openapi("UpsertOrganizationRequest");

export const OrganizationResponseSchema = z
  .object({
    id: z.string().uuid(),
    orgId: z.string(),
    name: z.string().nullable(),
    shareToken: z.string().uuid(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("OrganizationResponse");

export const ShareTokenResponseSchema = z
  .object({ shareToken: z.string().uuid() })
  .openapi("ShareTokenResponse");

export const OrganizationExistsResponseSchema = z
  .object({
    organizations: z.array(
      z.object({
        orgId: z.string(),
        exists: z.boolean(),
      })
    ),
  })
  .openapi("OrganizationExistsResponse");

// --- Media Kit Schemas ---

export const MediaKitResponseSchema = z
  .object({
    id: z.string().uuid(),
    clientOrganizationId: z.string().uuid().nullable(),
    orgId: z.string().nullable(),
    organizationId: z.string().uuid().nullable(),
    title: z.string().nullable(),
    iconUrl: z.string().nullable(),
    mdxPageContent: z.string().nullable(),
    jsxPageContent: z.string().nullable(),
    jsonPageContent: z.unknown().nullable(),
    notionPageContent: z.string().nullable(),
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
    mediaKitId: z.string().uuid(),
    mdxContent: z.string(),
  })
  .openapi("UpdateMdxRequest");

export const UpdateStatusRequestSchema = z
  .object({
    mediaKitId: z.string().uuid(),
    status: MediaKitStatusEnum,
    denialReason: z.string().optional(),
  })
  .openapi("UpdateStatusRequest");

export const EditMediaKitRequestSchema = z
  .object({
    mediaKitId: z.string().uuid(),
    instruction: z.string(),
    organizationUrl: z.string().optional(),
  })
  .openapi("EditMediaKitRequest");

export const ValidateMediaKitRequestSchema = z
  .object({ mediaKitId: z.string().uuid() })
  .openapi("ValidateMediaKitRequest");

export const CancelDraftRequestSchema = z
  .object({ mediaKitId: z.string().uuid() })
  .openapi("CancelDraftRequest");

// --- Public Schemas ---

export const PublicMediaKitResponseSchema = z
  .object({
    organization: z.object({
      id: z.string().uuid(),
      name: z.string().nullable(),
      orgId: z.string(),
    }),
    mediaKit: MediaKitResponseSchema.nullable(),
  })
  .openapi("PublicMediaKitResponse");

export const EmailDataResponseSchema = z
  .object({
    companyName: z.string().nullable(),
    status: MediaKitStatusEnum.nullable(),
    title: z.string().nullable(),
    pressKitUrl: z.string().nullable(),
    content: z.string().nullable(),
    contentType: z.string().nullable(),
  })
  .openapi("EmailDataResponse");

// --- Admin Schemas ---

export const AdminOrganizationSchema = z
  .object({
    id: z.string().uuid(),
    orgId: z.string(),
    name: z.string().nullable(),
    shareToken: z.string().uuid(),
    mediaKitCount: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("AdminOrganization");

export const AdminOrganizationListResponseSchema = z
  .object({ organizations: z.array(AdminOrganizationSchema) })
  .openapi("AdminOrganizationListResponse");

// --- Internal Schemas ---

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
    orgId: z.string(),
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

export const StaleKitOrgSchema = z
  .object({
    orgId: z.string(),
    name: z.string().nullable(),
    lastUpdated: z.string(),
  })
  .openapi("StaleKitOrg");

export const StaleKitsResponseSchema = z
  .object({ organizations: z.array(StaleKitOrgSchema) })
  .openapi("StaleKitsResponse");

// --- Health ---

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

// Organizations
registry.registerPath({
  method: "post",
  path: "/organizations",
  summary: "Upsert organization",
  tags: ["Organizations"],
  request: { body: { content: { "application/json": { schema: UpsertOrganizationRequestSchema } } } },
  responses: {
    200: { description: "Organization upserted", content: { "application/json": { schema: OrganizationResponseSchema } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/organizations/share-token/{orgId}",
  summary: "Get share token",
  tags: ["Organizations"],
  request: { params: z.object({ orgId: z.string() }) },
  responses: {
    200: { description: "Share token", content: { "application/json": { schema: ShareTokenResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/organizations/exists",
  summary: "Batch check organization existence",
  tags: ["Organizations"],
  request: { query: z.object({ orgIds: z.string() }) },
  responses: {
    200: { description: "Existence check", content: { "application/json": { schema: OrganizationExistsResponseSchema } } },
  },
});

// Media Kits
registry.registerPath({
  method: "get",
  path: "/media-kit",
  summary: "List media kits",
  tags: ["Media Kits"],
  request: {
    query: z.object({
      org_id: z.string().optional(),
      organization_id: z.string().optional(),
      title: z.string().optional(),
    }),
  },
  responses: {
    200: { description: "Media kits list", content: { "application/json": { schema: MediaKitListResponseSchema } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/media-kit/{id}",
  summary: "Get media kit by ID",
  tags: ["Media Kits"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Media kit", content: { "application/json": { schema: MediaKitResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/update-mdx",
  summary: "Update MDX content",
  tags: ["Media Kits"],
  request: { body: { content: { "application/json": { schema: UpdateMdxRequestSchema } } } },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: MediaKitResponseSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/update-status",
  summary: "Update media kit status",
  tags: ["Media Kits"],
  request: { body: { content: { "application/json": { schema: UpdateStatusRequestSchema } } } },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: MediaKitResponseSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/edit-media-kit",
  summary: "Initiate media kit generation",
  tags: ["Media Kits"],
  request: { body: { content: { "application/json": { schema: EditMediaKitRequestSchema } } } },
  responses: {
    200: { description: "Generation initiated", content: { "application/json": { schema: MediaKitResponseSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/validate",
  summary: "Validate media kit",
  tags: ["Media Kits"],
  request: { body: { content: { "application/json": { schema: ValidateMediaKitRequestSchema } } } },
  responses: {
    200: { description: "Validated", content: { "application/json": { schema: MediaKitResponseSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/cancel-draft",
  summary: "Cancel draft media kit",
  tags: ["Media Kits"],
  request: { body: { content: { "application/json": { schema: CancelDraftRequestSchema } } } },
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

registry.registerPath({
  method: "get",
  path: "/public-media-kit/{token}",
  summary: "Get public media kit (legacy)",
  tags: ["Public"],
  request: { params: z.object({ token: z.string() }) },
  responses: {
    200: { description: "Public media kit", content: { "application/json": { schema: PublicMediaKitResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/email-data/press-kit/{orgId}",
  summary: "Get press kit data for email templates",
  tags: ["Public"],
  request: { params: z.object({ orgId: z.string() }) },
  responses: {
    200: { description: "Email data", content: { "application/json": { schema: EmailDataResponseSchema } } },
  },
});

// Admin
registry.registerPath({
  method: "get",
  path: "/admin/organizations",
  summary: "List organizations with kit counts",
  tags: ["Admin"],
  request: { query: z.object({ search: z.string().optional() }) },
  responses: {
    200: { description: "Admin org list", content: { "application/json": { schema: AdminOrganizationListResponseSchema } } },
  },
});

registry.registerPath({
  method: "delete",
  path: "/admin/organizations/{id}",
  summary: "Delete organization",
  tags: ["Admin"],
  request: {
    params: z.object({ id: z.string().uuid() }),
    query: z.object({ confirmName: z.string() }),
  },
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: z.object({ success: z.boolean() }) } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

// Internal
registry.registerPath({
  method: "get",
  path: "/internal/media-kit/by-org/{orgId}",
  summary: "Get latest media kit by org",
  tags: ["Internal"],
  request: { params: z.object({ orgId: z.string() }) },
  responses: {
    200: { description: "Media kit", content: { "application/json": { schema: MediaKitResponseSchema.nullable() } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/internal/generation-data",
  summary: "Get data for generation workflow",
  tags: ["Internal"],
  request: { query: z.object({ orgId: z.string() }) },
  responses: {
    200: { description: "Generation data", content: { "application/json": { schema: GenerationDataResponseSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/internal/upsert-generation-result",
  summary: "Upsert generation result (workflow callback)",
  tags: ["Internal"],
  request: { body: { content: { "application/json": { schema: UpsertGenerationResultRequestSchema } } } },
  responses: {
    200: { description: "Upserted", content: { "application/json": { schema: MediaKitResponseSchema } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/clients-media-kits-need-update",
  summary: "Get orgs with stale kits",
  tags: ["Internal"],
  responses: {
    200: { description: "Stale kits", content: { "application/json": { schema: StaleKitsResponseSchema } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/media-kit-setup",
  summary: "Get setup status for all orgs",
  tags: ["Internal"],
  responses: {
    200: { description: "Setup status", content: { "application/json": { schema: MediaKitSetupListResponseSchema } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/health/bulk",
  summary: "Bulk health check per org",
  tags: ["Internal"],
  responses: {
    200: { description: "Bulk health", content: { "application/json": { schema: HealthBulkResponseSchema } } },
  },
});
