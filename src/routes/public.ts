import { Router } from "express";
import { eq } from "drizzle-orm";
import geoip from "geoip-lite";
import { marked } from "marked";
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

interface RenderOptions {
  title: string;
  mdxContent: string;
  iconUrl: string | null;
  brandDomain: string | null;
  logoDevToken: string | null;
}

function extractAttr(tag: string, attr: string): string | null {
  const re = new RegExp(`${attr}=(?:"([^"]*)"|'([^']*)'|{["']([^"']*)["']})`);
  const m = tag.match(re);
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

/**
 * Converts JSX components in the MDX output to valid HTML before rendering.
 * This runs on the raw MDX string BEFORE marked.parse() so that marked
 * doesn't mangle the JSX tags.
 */
function transformJsxComponents(mdx: string, logoDevToken: string | null = null): string {
  let html = mdx;

  // className → class (everywhere)
  html = html.replace(/\bclassName=/g, "class=");

  // Strip Tailwind utility classes that have no effect without Tailwind CSS
  // e.g. class="not-prose my-6 overflow-x-auto -mx-4 px-4 md:overflow-visible ..."
  html = html.replace(
    /\bclass="([^"]*)"/g,
    (_match, classes: string) => {
      const filtered = classes
        .split(/\s+/)
        .filter((c) => !isTailwindUtility(c))
        .join(" ");
      return filtered ? `class="${filtered}"` : "";
    },
  );

  // <InteractiveImage src="..." alt="..." caption="..." />
  html = html.replace(
    /<InteractiveImage\s+([^>]*?)\/>/gs,
    (_match, attrs: string) => {
      const src = extractAttr(attrs, "src") ?? "";
      const alt = extractAttr(attrs, "alt") ?? "";
      const caption = extractAttr(attrs, "caption");
      const captionHtml = caption
        ? `<figcaption class="interactive-image-caption">${escapeHtml(caption)}</figcaption>`
        : "";
      return `<figure class="interactive-image"><img src="${src}" alt="${escapeHtml(alt)}" loading="lazy" onerror="this.classList.add('img-broken')" />${captionHtml}</figure>`;
    },
  );

  // <ClientLogo domain="..." name="..." />
  const logoDevQuery = logoDevToken
    ? `?token=${encodeURIComponent(logoDevToken)}&format=png&size=80`
    : "?format=png&size=80";
  html = html.replace(
    /<ClientLogo\s+([^>]*?)\/>/gs,
    (_match, attrs: string) => {
      const domain = extractAttr(attrs, "domain") ?? "";
      const name = extractAttr(attrs, "name") ?? domain;
      const safeName = escapeHtml(name);
      const initial = escapeHtml(name.charAt(0));
      return `<div class="client-logo"><img src="https://img.logo.dev/${encodeURIComponent(domain)}${logoDevQuery}" alt="${safeName}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><span class="client-logo-fallback" style="display:none">${initial}</span><span class="client-logo-name">${safeName}</span></div>`;
    },
  );

  // <Collapsible> → <details>, <CollapsibleTrigger> → <summary>, <CollapsibleContent> → <div>
  html = html.replace(/<Collapsible>/g, '<details class="collapsible">');
  html = html.replace(/<\/Collapsible>/g, "</details>");
  html = html.replace(/<CollapsibleTrigger>/g, "<summary>");
  html = html.replace(/<\/CollapsibleTrigger>/g, "</summary>");
  // Mark collapsible content with a placeholder so we can parse the markdown inside later
  html = html.replace(/<CollapsibleContent>/g, "<!--COLLAPSIBLE_CONTENT_START-->");
  html = html.replace(/<\/CollapsibleContent>/g, "<!--COLLAPSIBLE_CONTENT_END-->");

  // <Card> family → divs
  html = html.replace(/<Card>/g, '<div class="jsx-card">');
  html = html.replace(/<\/Card>/g, "</div>");
  html = html.replace(/<CardHeader>/g, '<div class="jsx-card-header">');
  html = html.replace(/<\/CardHeader>/g, "</div>");
  html = html.replace(/<CardTitle>/g, '<div class="jsx-card-title">');
  html = html.replace(/<\/CardTitle>/g, "</div>");
  html = html.replace(/<CardContent>/g, '<div class="jsx-card-content">');
  html = html.replace(/<\/CardContent>/g, "</div>");

  // Remove bare wrapper divs that served only to carry Tailwind classes (now stripped)
  // Match <div> (no class or empty class) ... </div> that wrap inline content
  html = html.replace(/<div\s*>\s*([\s\S]*?)\s*<\/div>/g, "$1");

  return html;
}

/** Returns true for Tailwind utility classes (no effect without Tailwind CSS). */
function isTailwindUtility(cls: string): boolean {
  if (!cls) return false;
  // Known structural classes we keep
  if (
    cls === "interactive-image" ||
    cls === "interactive-image-caption" ||
    cls === "client-logo" ||
    cls === "client-logo-name" ||
    cls === "client-logo-fallback" ||
    cls === "collapsible" ||
    cls === "collapsible-content" ||
    cls === "jsx-card" ||
    cls === "jsx-card-header" ||
    cls === "jsx-card-title" ||
    cls === "jsx-card-content" ||
    cls === "logo-grid"
  )
    return false;
  // Tailwind patterns: responsive prefixes, common utilities
  if (/^(sm:|md:|lg:|xl:|2xl:)/.test(cls)) return true;
  if (/^-?m[xytblr]?-/.test(cls)) return true; // margin
  if (/^p[xytblr]?-/.test(cls)) return true; // padding
  if (/^(text-|font-|leading-|tracking-)/.test(cls)) return true;
  if (/^(flex|grid|block|inline|hidden|overflow|gap|space|w-|h-|min-w|max-w|min-h)/.test(cls)) return true;
  if (/^(rounded|border|shadow|bg-|ring|opacity)/.test(cls)) return true;
  if (/^(items-|justify-|self-|place-)/.test(cls)) return true;
  if (cls === "not-prose" || cls === "prose") return true;
  return false;
}

/**
 * Wraps each <h2> section (h2 + all siblings until the next h2/h1) in a
 * <section class="card"> div. Content before the first h2 stays unwrapped.
 * Sections that already contain a .jsx-card are not double-wrapped.
 */
function wrapSectionsInCards(html: string): string {
  // Split on h2 tags while keeping them in the result
  const parts = html.split(/(?=<h2[\s>])/);
  if (parts.length <= 1) return html;

  // First part is content before any h2 (intro text) — leave unwrapped
  const intro = parts[0];
  const sections = parts.slice(1).map((section) => {
    // Don't double-wrap sections that already contain a jsx-card
    if (section.includes('class="jsx-card"')) return section;
    return `<section class="card">${section}</section>`;
  });

  return intro + sections.join("");
}

/**
 * Parses markdown inside collapsible content placeholders.
 * marked.parse() skips markdown inside HTML blocks, so we handle collapsible
 * content separately: extract it, parse it with marked, and inject it back.
 */
function parseCollapsibleContent(html: string): string {
  return html.replace(
    /<!--COLLAPSIBLE_CONTENT_START-->([\s\S]*?)<!--COLLAPSIBLE_CONTENT_END-->/g,
    (_match, content: string) => {
      const parsed = marked.parse(content.trim()) as string;
      return `<div class="collapsible-content">${parsed}</div>`;
    },
  );
}

function renderHtmlPage({ title, mdxContent, iconUrl, brandDomain, logoDevToken }: RenderOptions): string {
  const preprocessed = transformJsxComponents(mdxContent, logoDevToken);
  const rawHtml = marked.parse(preprocessed) as string;
  const withCollapsibles = parseCollapsibleContent(rawHtml);
  const htmlContent = wrapSectionsInCards(withCollapsibles);
  const safeTitle = escapeHtml(title);
  const faviconTag = iconUrl
    ? `<link rel="icon" href="${escapeHtml(iconUrl)}" />`
    : "";

  const headerLogoQuery = logoDevToken
    ? `?token=${encodeURIComponent(logoDevToken)}&format=png`
    : "?format=png";
  const logoTag = iconUrl
    ? `<img src="${escapeHtml(iconUrl)}" alt="${safeTitle}" class="brand-logo" />`
    : brandDomain
      ? `<img src="https://img.logo.dev/${escapeHtml(brandDomain)}${headerLogoQuery}" alt="${safeTitle}" class="brand-logo" onerror="this.style.display='none'" />`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
  ${faviconTag}
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.7;
      color: #1e293b;
      background: #f8fafc;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    /* --- Header --- */
    .header {
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%);
      padding: 56px 24px 48px;
      color: #fff;
      position: relative;
      overflow: hidden;
    }
    .header::before {
      content: '';
      position: absolute;
      top: -50%;
      right: -20%;
      width: 600px;
      height: 600px;
      background: radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%);
      pointer-events: none;
    }
    .header::after {
      content: '';
      position: absolute;
      bottom: -40%;
      left: -10%;
      width: 400px;
      height: 400px;
      background: radial-gradient(circle, rgba(14,165,233,0.1) 0%, transparent 70%);
      pointer-events: none;
    }
    .header-inner {
      max-width: 760px;
      margin: 0 auto;
      position: relative;
      z-index: 1;
      display: flex;
      align-items: center;
      gap: 24px;
    }
    .brand-logo {
      width: 64px;
      height: 64px;
      border-radius: 14px;
      object-fit: contain;
      background: #fff;
      padding: 6px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.2);
      flex-shrink: 0;
    }
    .header-text .page-title {
      font-size: 1.75rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      line-height: 1.2;
      margin: 0;
      color: #fff;
    }
    .header-text .subtitle {
      font-size: 0.875rem;
      color: rgba(255,255,255,0.6);
      font-weight: 500;
      margin-top: 6px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    /* --- Main content --- */
    .container {
      max-width: 760px;
      margin: 0 auto;
      padding: 40px 24px 96px;
    }

    /* Strip the first h1 from content since we show it in the header */
    .content > h1:first-child { display: none; }

    /* --- Cards --- */
    .content .card {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 28px 32px 24px;
      margin: 20px 0;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02);
      transition: box-shadow 0.2s;
    }
    .content .card:hover {
      box-shadow: 0 4px 12px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04);
    }

    .content h1 {
      font-size: 2rem;
      font-weight: 700;
      margin: 2em 0 0.6em;
      line-height: 1.2;
      letter-spacing: -0.02em;
      color: #0f172a;
    }
    .content h2 {
      font-size: 1.2rem;
      font-weight: 600;
      color: #0f172a;
      letter-spacing: -0.01em;
      margin: 0 0 16px;
      padding-bottom: 12px;
      border-bottom: 2px solid #f1f5f9;
    }
    .content h3 {
      font-size: 1.05rem;
      font-weight: 600;
      margin: 1.4em 0 0.4em;
      color: #334155;
    }
    .content p {
      margin: 0.6em 0;
      color: #475569;
    }
    .content ul, .content ol {
      margin: 0.6em 0;
      padding-left: 1.5em;
      color: #475569;
    }
    .content li {
      margin: 0.35em 0;
    }
    .content li::marker {
      color: #94a3b8;
    }
    .content hr {
      border: none;
      border-top: 1px solid #e2e8f0;
      margin: 2em 0;
    }
    .content table {
      width: 100%;
      border-collapse: collapse;
      margin: 1em 0;
      font-size: 0.95rem;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid #e2e8f0;
    }
    .content th {
      text-align: left;
      padding: 10px 14px;
      font-weight: 600;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #64748b;
      background: #f8fafc;
      border-bottom: 2px solid #e2e8f0;
    }
    .content td {
      text-align: left;
      padding: 10px 14px;
      border-bottom: 1px solid #f1f5f9;
      color: #475569;
    }
    .content tr:last-child td {
      border-bottom: none;
    }
    .content blockquote {
      border-left: 3px solid #6366f1;
      padding: 10px 18px;
      margin: 1em 0;
      color: #475569;
      background: #f8fafc;
      border-radius: 0 8px 8px 0;
      font-style: italic;
    }
    .content a {
      color: #4f46e5;
      text-decoration: none;
      font-weight: 500;
      transition: color 0.15s;
    }
    .content a:hover {
      color: #4338ca;
      text-decoration: underline;
    }
    .content strong { font-weight: 600; color: #1e293b; }
    .content code {
      background: #f1f5f9;
      padding: 2px 8px;
      border-radius: 5px;
      font-size: 0.875em;
      color: #6366f1;
    }
    .content img {
      max-width: 100%;
      height: auto;
      border-radius: 8px;
      margin: 1em 0;
    }

    /* --- InteractiveImage --- */
    .interactive-image {
      margin: 1em 0;
      display: inline-block;
      max-width: 100%;
    }
    .interactive-image img {
      max-width: 100%;
      height: auto;
      border-radius: 8px;
      cursor: pointer;
      transition: transform 0.2s;
    }
    .interactive-image img:hover {
      transform: scale(1.02);
    }
    .interactive-image img.img-broken {
      display: none;
    }
    .interactive-image:has(.img-broken) {
      display: block;
      background: #f1f5f9;
      border: 1px dashed #cbd5e1;
      border-radius: 8px;
      padding: 24px;
      text-align: center;
    }
    .interactive-image-caption {
      font-size: 0.85rem;
      color: #64748b;
      margin-top: 6px;
      text-align: center;
    }

    /* --- Image gallery grid --- */
    .card .interactive-image {
      width: calc(50% - 8px);
      vertical-align: top;
      margin: 8px 4px;
    }
    @media (max-width: 640px) {
      .card .interactive-image { width: 100%; margin: 8px 0; }
    }

    /* --- ClientLogo --- */
    .client-logo {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      min-width: 100px;
      padding: 12px;
    }
    .client-logo img {
      width: 56px;
      height: 56px;
      object-fit: contain;
      border-radius: 8px;
      filter: grayscale(100%);
      opacity: 0.7;
      transition: filter 0.2s, opacity 0.2s;
      margin: 0;
    }
    .client-logo:hover img {
      filter: grayscale(0%);
      opacity: 1;
    }
    .client-logo-name {
      font-size: 0.75rem;
      color: #64748b;
      text-align: center;
      max-width: 100px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .client-logo-fallback {
      width: 56px;
      height: 56px;
      border-radius: 8px;
      background: #e2e8f0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.4rem;
      font-weight: 700;
      color: #64748b;
    }

    /* --- Collapsible (details/summary) --- */
    .collapsible {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      margin: 1em 0;
      overflow: hidden;
    }
    .collapsible summary {
      padding: 12px 16px;
      font-weight: 600;
      cursor: pointer;
      background: #f8fafc;
      color: #334155;
      list-style: none;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .collapsible summary::before {
      content: '\\25B6';
      font-size: 0.7em;
      transition: transform 0.2s;
    }
    .collapsible[open] summary::before {
      transform: rotate(90deg);
    }
    .collapsible summary::-webkit-details-marker { display: none; }
    .collapsible-content {
      padding: 12px 16px 16px;
      border-top: 1px solid #e2e8f0;
    }

    /* --- JSX Card --- */
    .jsx-card {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      overflow: hidden;
      margin: 1em 0;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }
    .jsx-card-header {
      padding: 16px 20px 8px;
    }
    .jsx-card-title {
      font-size: 1.05rem;
      font-weight: 600;
      color: #0f172a;
    }
    .jsx-card-content {
      padding: 8px 20px 16px;
      color: #475569;
    }

    /* Logo grid layout — logos rendered side-by-side */
    .card p:has(.client-logo) {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 8px;
      margin: 1em 0;
    }

    /* --- Footer --- */
    .footer {
      max-width: 760px;
      margin: 0 auto;
      padding: 32px 24px 48px;
      text-align: center;
      font-size: 0.8rem;
      color: #94a3b8;
      border-top: 1px solid #e2e8f0;
    }

    /* --- Responsive --- */
    @media (max-width: 640px) {
      .header { padding: 40px 20px 36px; }
      .header-inner { gap: 16px; }
      .brand-logo { width: 48px; height: 48px; border-radius: 10px; }
      .header-text .page-title { font-size: 1.4rem; }
      .container { padding: 24px 16px 64px; }
      .content .card { padding: 20px 20px 18px; border-radius: 10px; margin: 14px 0; }
      .content h2 { font-size: 1.1rem; }
    }
  </style>
</head>
<body>
  <header class="header">
    <div class="header-inner">
      ${logoTag}
      <div class="header-text">
        <h1 class="page-title">${safeTitle}</h1>
        <div class="subtitle">Press Kit</div>
      </div>
    </div>
  </header>
  <main class="container">
    <div class="content">
      ${htmlContent}
    </div>
  </main>
  <footer class="footer">
    Powered by Distribute
  </footer>
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

    // Fetch logo.dev API token (cached, fire-and-forget on failure)
    const logoDevToken = await getPlatformKey("logo-dev").catch((err) => {
      console.error("[press-kits-service] Failed to fetch logo-dev key:", err);
      return null;
    });

    // Serve rendered HTML
    const title = kit.title || "Press Kit";
    const content = kit.mdxPageContent || "";
    const html = renderHtmlPage({
      title,
      mdxContent: content,
      iconUrl: kit.iconUrl,
      brandDomain: kit.brandDomain,
      logoDevToken,
    });
    res.type("html").send(html);
  } catch (err) {
    console.error("[press-kits-service] GET /public/:token error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
