import "./instrument.js";
import express from "express";
import cors from "cors";
import * as Sentry from "@sentry/node";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./db/index.js";
import { requireApiKey, requireIdentityHeaders } from "./middleware/auth.js";
import { trackRun } from "./middleware/run-tracking.js";
import { deployTemplates } from "./lib/email-client.js";

import healthRoutes from "./routes/health.js";
import mediaKitsRoutes from "./routes/media-kits.js";
import publicRoutes from "./routes/public.js";
import adminRoutes from "./routes/admin.js";
import internalRoutes from "./routes/internal.js";
import internalTransferRoutes from "./routes/internal-transfer.js";
import statsRoutes from "./routes/stats.js";
import openapiRoutes from "./routes/openapi.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Public routes (no auth)
app.use(healthRoutes);
app.use(publicRoutes);
app.use(openapiRoutes);

// Protected routes (require API key)
app.use(requireApiKey);

// Internal routes that need API key only (no identity headers)
app.use(internalTransferRoutes);

// Routes that also require identity headers + run tracking
app.use(requireIdentityHeaders);
app.use(trackRun);
app.use(mediaKitsRoutes);
app.use(statsRoutes);
app.use(adminRoutes);
app.use(internalRoutes);

// Sentry error handler
Sentry.setupExpressErrorHandler(app);

// Fallback error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

const PRESS_KIT_READY_TEMPLATE = {
  name: "press_kit_ready",
  subject: "Your press kit is ready!",
  htmlBody:
    "<h1>Your press kit is ready</h1><p>Your press kit has been validated and is now live.</p>",
  textBody: "Your press kit is ready and live.",
};

async function startup(): Promise<void> {
  // 1. Run migrations
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations complete");

  // 2. Deploy email templates (idempotent)
  if (process.env.TRANSACTIONAL_EMAIL_SERVICE_API_KEY) {
    await deployTemplates([PRESS_KIT_READY_TEMPLATE]);
    console.log("[press-kits-service] Email templates deployed");
  }

  // 3. Start listening
  app.listen(Number(PORT), "::", () => {
    console.log(`press-kits-service running on port ${PORT}`);
  });
}

if (process.env.NODE_ENV !== "test") {
  startup().catch((err) => {
    console.error("Startup failed:", err);
    process.exit(1);
  });
}

export default app;
