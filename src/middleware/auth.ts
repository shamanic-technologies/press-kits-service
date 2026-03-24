import type { Request, Response, NextFunction } from "express";

declare global {
  namespace Express {
    interface Request {
      orgId: string;
      userId: string;
      runId: string;
      workflowName?: string;
      brandId?: string;
      campaignId?: string;
      featureSlug?: string;
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
  req.workflowName = req.headers["x-workflow-name"] as string | undefined;
  req.brandId = req.headers["x-brand-id"] as string | undefined;
  req.campaignId = req.headers["x-campaign-id"] as string | undefined;
  req.featureSlug = req.headers["x-feature-slug"] as string | undefined;
  next();
}

export interface ContextHeaders {
  orgId: string;
  userId: string;
  runId: string;
  workflowName?: string;
  brandId?: string;
  campaignId?: string;
  featureSlug?: string;
}

export function getContextHeaders(req: Request): ContextHeaders {
  return {
    orgId: req.orgId,
    userId: req.userId,
    runId: req.runId,
    workflowName: req.workflowName,
    brandId: req.brandId,
    campaignId: req.campaignId,
    featureSlug: req.featureSlug,
  };
}

export function buildForwardHeaders(ctx: ContextHeaders): Record<string, string> {
  const headers: Record<string, string> = {
    "x-org-id": ctx.orgId,
    "x-user-id": ctx.userId,
    "x-run-id": ctx.runId,
  };
  if (ctx.workflowName) headers["x-workflow-name"] = ctx.workflowName;
  if (ctx.brandId) headers["x-brand-id"] = ctx.brandId;
  if (ctx.campaignId) headers["x-campaign-id"] = ctx.campaignId;
  if (ctx.featureSlug) headers["x-feature-slug"] = ctx.featureSlug;
  return headers;
}
