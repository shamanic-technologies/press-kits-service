import { Router } from "express";
import { eq } from "drizzle-orm";
import geoip from "geoip-lite";
import { marked } from "marked";
import { db } from "../db/index.js";
import { mediaKits, mediaKitViews } from "../db/schema.js";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHtmlPage(title: string, mdxContent: string, iconUrl: string | null): string {
  const htmlContent = marked.parse(mdxContent) as string;
  const safeTitle = escapeHtml(title);
  const faviconTag = iconUrl
    ? `<link rel="icon" href="${escapeHtml(iconUrl)}" />`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
  ${faviconTag}
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.7;
      color: #1a1a2e;
      background: #fafafa;
      padding: 0;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      padding: 48px 24px 96px;
    }
    h1 { font-size: 2.25rem; font-weight: 700; margin: 1.5em 0 0.5em; line-height: 1.2; }
    h2 { font-size: 1.5rem; font-weight: 600; margin: 1.8em 0 0.6em; color: #16213e; }
    h3 { font-size: 1.2rem; font-weight: 600; margin: 1.5em 0 0.4em; }
    p { margin: 0.8em 0; }
    ul, ol { margin: 0.8em 0; padding-left: 1.5em; }
    li { margin: 0.3em 0; }
    hr { border: none; border-top: 1px solid #e0e0e0; margin: 2em 0; }
    table { width: 100%; border-collapse: collapse; margin: 1.5em 0; }
    th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid #e8e8e8; }
    th { font-weight: 600; background: #f5f5f5; }
    blockquote {
      border-left: 3px solid #c0c0c0;
      padding: 0.5em 1em;
      margin: 1em 0;
      color: #555;
      background: #f9f9f9;
    }
    a { color: #0f4c75; }
    strong { font-weight: 600; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
    img { max-width: 100%; height: auto; }
  </style>
</head>
<body>
  <div class="container">
    ${htmlContent}
  </div>
</body>
</html>`;
}

// GET /public/:token — serve rendered HTML page for the press kit
router.get("/public/:token", async (req, res) => {
  try {
    const { token } = req.params;

    if (!UUID_RE.test(token)) {
      res.status(400).json({ error: "Invalid token format" });
      return;
    }

    const kit = await db.query.mediaKits.findFirst({
      where: eq(mediaKits.shareToken, token),
    });

    if (!kit) {
      res.status(404).json({ error: "Media kit not found" });
      return;
    }

    // Track view (fire-and-forget)
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
      || req.socket.remoteAddress
      || null;
    const geo = ip ? geoip.lookup(ip) : null;

    db.insert(mediaKitViews)
      .values({
        mediaKitId: kit.id,
        ipAddress: ip,
        userAgent: (req.headers["user-agent"] as string) ?? null,
        country: geo?.country ?? null,
      })
      .catch((err) => console.error("[press-kits-service] Failed to track view:", err));

    // Serve rendered HTML
    const title = kit.title || "Press Kit";
    const content = kit.mdxPageContent || "";
    const html = renderHtmlPage(title, content, kit.iconUrl);
    res.type("html").send(html);
  } catch (err) {
    console.error("[press-kits-service] GET /public/:token error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
