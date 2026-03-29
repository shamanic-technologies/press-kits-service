import "./instrument.js";
import express from "express";
import cors from "cors";
import * as Sentry from "@sentry/node";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./db/index.js";
import { requireApiKey, requireIdentityHeaders } from "./middleware/auth.js";
import { trackRun } from "./middleware/run-tracking.js";
import { deployTemplates } from "./lib/email-client.js";
import { deployPrompts } from "./lib/content-generation-client.js";

import healthRoutes from "./routes/health.js";
import mediaKitsRoutes from "./routes/media-kits.js";
import publicRoutes from "./routes/public.js";
import adminRoutes from "./routes/admin.js";
import internalRoutes from "./routes/internal.js";
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

// Protected routes (require API key + identity headers + run tracking)
app.use(requireApiKey);
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

const PRESS_KIT_GENERATION_PROMPT = {
  type: "generate-press-kit",
  prompt: [
    "You are a professional press kit writer. Generate a press kit in MDX format.",
    "The output must be valid MDX that can be rendered directly. Include sections like: Company Overview, Key Facts, Leadership, Products/Services, Press Contacts.",
    "Use markdown headings (##), bold text, and bullet points for readability.",
    "Do NOT include import statements or JSX components — only standard markdown syntax.",
    "",
    "{{#existingContent}}",
    "--- EXISTING PRESS KIT CONTENT (use as base, apply edits requested below) ---",
    "{{existingContent}}",
    "--- END EXISTING CONTENT ---",
    "{{/existingContent}}",
    "",
    "{{#instructions}}",
    "--- USER INSTRUCTIONS ---",
    "{{instructions}}",
    "--- END INSTRUCTIONS ---",
    "{{/instructions}}",
    "",
    "{{#feedbacks}}",
    "--- PREVIOUS FEEDBACK (avoid these issues) ---",
    "{{feedbacks}}",
    "--- END FEEDBACK ---",
    "{{/feedbacks}}",
    "",
    "Generate the full press kit MDX content now. Output ONLY the MDX content, no explanations or wrapping.",
  ].join("\n"),
  variables: ["existingContent", "instructions", "feedbacks"],
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

  // 2. Deploy prompt templates (idempotent)
  if (process.env.CONTENT_GENERATION_SERVICE_API_KEY) {
    await deployPrompts([PRESS_KIT_GENERATION_PROMPT]);
    console.log("[press-kits-service] Prompt templates deployed");
  }

  // 3. Deploy email templates (idempotent)
  if (process.env.TRANSACTIONAL_EMAIL_SERVICE_API_KEY) {
    await deployTemplates([PRESS_KIT_READY_TEMPLATE]);
    console.log("[press-kits-service] Email templates deployed");
  }

  // 4. Start listening
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
