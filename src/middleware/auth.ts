import type { Request, Response, NextFunction } from "express";

declare global {
  namespace Express {
    interface Request {
      orgId: string;
      userId: string;
      runId: string;
      workflowSlug?: string;
      brandIds: string[];
      campaignId?: string;
      featureSlug?: string;
      featureDynastySlug?: string;
      workflowDynastySlug?: string;
    }
  }
}

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers["x-api-key"] as string | undefined;
  if (!key || key !== process.env.PRESS_KITS_SERVICE_API_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

export function requireIdentityHeaders(req: Request, res: Response, next: NextFunction): void {
  const orgId = req.headers["x-org-id"] as string | undefined;
  const userId = req.headers["x-user-id"] as string | undefined;
  const runId = req.headers["x-run-id"] as string | undefined;
  if (!orgId || !userId || !runId) {
    res.status(400).json({ error: "x-org-id, x-user-id, and x-run-id headers are required" });
    return;
  }
  req.orgId = orgId;
  req.userId = userId;
  req.runId = runId;
  req.workflowSlug = req.headers["x-workflow-slug"] as string | undefined;
  req.brandIds = String(req.headers["x-brand-id"] ?? "").split(",").map(s => s.trim()).filter(Boolean).sort();
  req.campaignId = req.headers["x-campaign-id"] as string | undefined;
  req.featureSlug = req.headers["x-feature-slug"] as string | undefined;
  req.featureDynastySlug = req.headers["x-feature-dynasty-slug"] as string | undefined;
  req.workflowDynastySlug = req.headers["x-workflow-dynasty-slug"] as string | undefined;
  next();
}

export interface ContextHeaders {
  orgId: string;
  userId: string;
  runId: string;
  workflowSlug?: string;
  brandIds: string[];
  campaignId?: string;
  featureSlug?: string;
  featureDynastySlug?: string;
  workflowDynastySlug?: string;
}

export function getContextHeaders(req: Request): ContextHeaders {
  return {
    orgId: req.orgId,
    userId: req.userId,
    runId: req.runId,
    workflowSlug: req.workflowSlug,
    brandIds: req.brandIds,
    campaignId: req.campaignId,
    featureSlug: req.featureSlug,
    featureDynastySlug: req.featureDynastySlug,
    workflowDynastySlug: req.workflowDynastySlug,
  };
}

export function buildForwardHeaders(ctx: ContextHeaders): Record<string, string> {
  const headers: Record<string, string> = {
    "x-org-id": ctx.orgId,
    "x-user-id": ctx.userId,
    "x-run-id": ctx.runId,
  };
  if (ctx.workflowSlug) headers["x-workflow-slug"] = ctx.workflowSlug;
  if (ctx.brandIds.length > 0) headers["x-brand-id"] = ctx.brandIds.join(",");
  if (ctx.campaignId) headers["x-campaign-id"] = ctx.campaignId;
  if (ctx.featureSlug) headers["x-feature-slug"] = ctx.featureSlug;
  if (ctx.featureDynastySlug) headers["x-feature-dynasty-slug"] = ctx.featureDynastySlug;
  if (ctx.workflowDynastySlug) headers["x-workflow-dynasty-slug"] = ctx.workflowDynastySlug;
  return headers;
}
