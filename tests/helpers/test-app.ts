import express from "express";
import { requireApiKey, requireIdentityHeaders } from "../../src/middleware/auth.js";
import healthRoutes from "../../src/routes/health.js";
import organizationsRoutes from "../../src/routes/organizations.js";
import mediaKitsRoutes from "../../src/routes/media-kits.js";
import publicRoutes from "../../src/routes/public.js";
import adminRoutes from "../../src/routes/admin.js";
import internalRoutes from "../../src/routes/internal.js";

export function createTestApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  // Public routes (no auth)
  app.use(healthRoutes);
  app.use(publicRoutes);

  // Protected routes
  app.use(requireApiKey);
  app.use(requireIdentityHeaders);
  app.use(organizationsRoutes);
  app.use(mediaKitsRoutes);
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
