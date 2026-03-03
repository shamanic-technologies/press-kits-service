import type { Request, Response, NextFunction } from "express";

declare global {
  namespace Express {
    interface Request {
      orgId: string;
      userId: string;
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
  if (!orgId || !userId) {
    res.status(400).json({ error: "x-org-id and x-user-id headers are required" });
    return;
  }
  req.orgId = orgId;
  req.userId = userId;
  next();
}
