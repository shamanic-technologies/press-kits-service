import express from "express";
import { requireApiKey, requireIdentityHeaders } from "../../src/middleware/auth.js";
import { trackRun } from "../../src/middleware/run-tracking.js";
import healthRoutes from "../../src/routes/health.js";
import mediaKitsRoutes from "../../src/routes/media-kits.js";
import publicRoutes from "../../src/routes/public.js";
import adminRoutes from "../../src/routes/admin.js";
import internalRoutes from "../../src/routes/internal.js";
import statsRoutes from "../../src/routes/stats.js";

export function createTestApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  // Public routes (no auth)
  app.use(healthRoutes);
  app.use(publicRoutes);

  // Protected routes
  app.use(requireApiKey);
  app.use(requireIdentityHeaders);
  app.use(trackRun);
  app.use(mediaKitsRoutes);
  app.use(statsRoutes);
  app.use(adminRoutes);
  app.use(internalRoutes);

  return app;
}

export function getAuthHeaders(): Record<string, string> {
  return {
    "X-API-Key": "test-api-key",
    "x-org-id": "test-org-id",
    "x-user-id": "test-user-id",
    "x-run-id": "test-run-id",
  };
}
