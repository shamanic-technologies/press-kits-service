import "./instrument.js";
import express from "express";
import cors from "cors";
import * as Sentry from "@sentry/node";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./db/index.js";
import { requireApiKey } from "./middleware/auth.js";
import { deployWorkflows } from "./lib/windmill-client.js";
import { registerAppKey } from "./lib/key-client.js";
import { deployTemplates } from "./lib/email-client.js";

import healthRoutes from "./routes/health.js";
import organizationsRoutes from "./routes/organizations.js";
import mediaKitsRoutes from "./routes/media-kits.js";
import publicRoutes from "./routes/public.js";
import adminRoutes from "./routes/admin.js";
import internalRoutes from "./routes/internal.js";
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
app.use(organizationsRoutes);
app.use(mediaKitsRoutes);
app.use(adminRoutes);
app.use(internalRoutes);

// Sentry error handler
Sentry.setupExpressErrorHandler(app);

// Fallback error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

const PRESS_KIT_GENERATION_WORKFLOW = {
  name: "generate-press-kit",
  description: "Generate press kit MDX content via LLM",
  dag: {
    nodes: [
      {
        id: "fetch-data",
        type: "http.call" as const,
        config: {
          service: "press-kits",
          method: "GET",
          path: "/internal/generation-data",
        },
        inputMapping: {
          "query.orgId": "$ref:flow_input.orgId",
        },
      },
      {
        id: "generate-mdx",
        type: "http.call" as const,
        config: {
          service: "content-generation",
          method: "POST",
          path: "/generate",
        },
        inputMapping: {
          "body.appId": "$ref:flow_input.appId",
          "body.variables": "$ref:fetch-data.output",
          "body.parentRunId": "$ref:flow_input.runId",
        },
        retries: 0,
      },
      {
        id: "upsert-result",
        type: "http.call" as const,
        config: {
          service: "press-kits",
          method: "POST",
          path: "/internal/upsert-generation-result",
        },
        inputMapping: {
          "body.orgId": "$ref:flow_input.orgId",
          "body.mdxContent": "$ref:generate-mdx.output.bodyHtml",
          "body.title": "$ref:generate-mdx.output.title",
        },
      },
      {
        id: "end-run",
        type: "http.call" as const,
        config: {
          service: "runs",
          method: "PATCH",
        },
        inputMapping: {
          path: "$ref:flow_input.runId",
          "body.status": "completed",
        },
      },
    ],
    edges: [
      { from: "fetch-data", to: "generate-mdx" },
      { from: "generate-mdx", to: "upsert-result" },
      { from: "upsert-result", to: "end-run" },
    ],
    onError: "end-run",
  },
};

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

  // 2. Register app keys (idempotent)
  if (process.env.ANTHROPIC_API_KEY && process.env.KEY_SERVICE_API_KEY) {
    await registerAppKey("press-kits-service", "anthropic", process.env.ANTHROPIC_API_KEY);
    console.log("App keys registered");
  }

  // 3. Deploy windmill workflow (idempotent)
  if (process.env.WORKFLOW_SERVICE_API_KEY) {
    await deployWorkflows("press-kits-service", [PRESS_KIT_GENERATION_WORKFLOW]);
    console.log("Workflows deployed");
  }

  // 4. Deploy email templates (idempotent)
  if (process.env.TRANSACTIONAL_EMAIL_SERVICE_API_KEY) {
    await deployTemplates("press-kits-service", [PRESS_KIT_READY_TEMPLATE]);
    console.log("Email templates deployed");
  }

  // 5. Start listening
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
