import type { Request, Response, NextFunction } from "express";

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers["x-api-key"] as string | undefined;
  if (!key || key !== process.env.PRESS_KITS_SERVICE_API_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
