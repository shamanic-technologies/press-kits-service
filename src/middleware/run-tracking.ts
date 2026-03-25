import type { Request, Response, NextFunction } from "express";
import { createRun, updateRunStatus } from "../lib/runs-client.js";
import { getContextHeaders } from "./auth.js";

export async function trackRun(req: Request, res: Response, next: NextFunction): Promise<void> {
  const ctx = getContextHeaders(req);

  try {
    const run = await createRun({
      orgId: req.orgId,
      userId: req.userId,
      serviceName: "press-kits-service",
      taskName: `${req.method} ${req.path}`,
      parentRunId: req.runId,
      ctx,
    });

    req.runId = run.id;

    res.on("finish", () => {
      const status = res.statusCode < 400 ? "completed" : "failed";
      updateRunStatus(run.id, status, ctx).catch((err) =>
        console.error("Failed to close run:", err)
      );
    });

    next();
  } catch (err) {
    console.error("Failed to create run:", err);
    res.status(502).json({ error: "Run tracking unavailable" });
  }
}
