import { Router } from "express";
import { eq } from "drizzle-orm";
import geoip from "geoip-lite";
import { db } from "../db/index.js";
import { mediaKits, mediaKitViews } from "../db/schema.js";
import { getPlatformKey } from "../lib/key-client.js";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const DISCLAIMER_FOOTER = `<footer style="max-width:720px;margin:48px auto 0;padding:32px 24px 48px;border-top:1px solid #e2e8f0;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <p style="font-size:0.7rem;line-height:1.6;color:#94a3b8;margin:0">
    <strong style="color:#64748b">Disclaimer</strong> &mdash;
    This press kit was prepared by Distribute.io, a third-party media service, on behalf of the featured organization.
    It was compiled using AI-assisted research and editorial tools based on publicly available information, and may contain inaccuracies, omissions, or outdated details.
    This material represents Distribute.io&rsquo;s best-effort understanding of the organization and its offerings;
    it does not constitute an official statement, endorsement, or representation by the featured organization.
    This document is provided for media background and reference purposes only and may not be quoted, reproduced, or used as-is in articles or external communications without independent verification.
    For confirmed information or official statements, please contact the organization directly.
  </p>
  <p style="font-size:0.7rem;line-height:1.6;color:#94a3b8;margin:8px 0 0">
    <strong style="color:#64748b">Confidentiality notice</strong> &mdash;
    This document is confidential and intended solely for the use of the individual or entity to whom it was addressed.
    If you have received this document in error, please notify the sender immediately and delete all copies.
    Unauthorized distribution, reproduction, or use of this material is strictly prohibited.
  </p>
  <p style="font-size:0.65rem;color:#cbd5e1;margin:8px 0 0;text-align:center">Powered by Distribute.io</p>
</footer>`;

/**
 * Injects server-side elements into the LLM-generated HTML:
 * - Favicon link tag (from kit.iconUrl)
 * - Logo.dev API token into img.logo.dev URLs
 * - Legal disclaimer footer (always present, hard-coded)
 */
function injectServerSideElements(
  html: string,
  opts: { iconUrl: string | null; logoDevToken: string | null },
): string {
  let result = html;

  // Inject favicon if iconUrl is available
  if (opts.iconUrl) {
    const faviconTag = `<link rel="icon" href="${escapeHtml(opts.iconUrl)}" />`;
    result = result.replace(/<\/head>/i, `  ${faviconTag}\n</head>`);
  }

  // Inject logo.dev token into all img.logo.dev URLs
  if (opts.logoDevToken) {
    result = result.replace(
      /https:\/\/img\.logo\.dev\/([^"'\s]*)/g,
      (match) => {
        if (match.includes("token=")) return match;
        const separator = match.includes("?") ? "&" : "?";
        return `${match}${separator}token=${encodeURIComponent(opts.logoDevToken!)}`;
      },
    );
  }

  // Inject disclaimer footer before </body>
  result = result.replace(/<\/body>/i, `${DISCLAIMER_FOOTER}\n</body>`);

  return result;
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

    const content = kit.mdxPageContent || "";

    // Fetch logo.dev API token
    const logoDevToken = await getPlatformKey("logo-dev").catch((err) => {
      console.error("[press-kits-service] Failed to fetch logo-dev key:", err);
      return null;
    });

    const html = injectServerSideElements(content, {
      iconUrl: kit.iconUrl,
      logoDevToken,
    });

    res.type("html").send(html);
  } catch (err) {
    console.error("[press-kits-service] GET /public/:token error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
