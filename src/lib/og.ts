export interface OgMeta {
  title: string;
  description: string;
  imageUrl: string;
  url: string;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Inserts Open Graph + Twitter Card meta tags into a static index.html before `</head>`,
 * so links to a specific game/showcase page unfurl in Slack/iMessage/Twitter with the
 * squad share image rather than the generic app icon. Harmless to serve to real browsers
 * too - React renders over the body regardless of what's in `<head>`.
 */
export function injectOgMeta(html: string, meta: OgMeta): string {
  const tags = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escapeAttr(meta.title)}" />`,
    `<meta property="og:description" content="${escapeAttr(meta.description)}" />`,
    `<meta property="og:image" content="${escapeAttr(meta.imageUrl)}" />`,
    `<meta property="og:url" content="${escapeAttr(meta.url)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeAttr(meta.title)}" />`,
    `<meta name="twitter:description" content="${escapeAttr(meta.description)}" />`,
    `<meta name="twitter:image" content="${escapeAttr(meta.imageUrl)}" />`,
  ].join("\n    ");

  return html.replace("</head>", `    ${tags}\n  </head>`);
}
