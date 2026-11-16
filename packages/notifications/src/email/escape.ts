/**
 * The two helpers every piece of the layout's HTML goes through. Their own module so
 * the layout can grow parts without growing past the size gate; `safeHref` is still
 * exported from `./template`, where callers have always found it.
 */

/**
 * Escape everything that reaches the HTML body.
 *
 * A store name, a buyer's display name and a product title are all user input
 * that reaches a mail, and the ONE thing a shared layout must guarantee is that
 * none of them can close a tag. Single quotes are escaped too: attribute values
 * below are double-quoted, but a caller reading this should not have to check.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * The schemes a link in a mail may use.
 *
 * `javascript:` is inert in every mail client, so this is not the XSS guard it
 * would be on a page — it is the guard for the PREVIEW, which renders the same
 * HTML in a browser, and for the day some part of this markup is reused on a
 * screen. A rejected href drops to `#`, which fails visibly rather than
 * silently linking somewhere unexpected.
 */
const SAFE_LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/** A URL as an attribute value, or `#` when it is not one this layout will emit. */
export function safeHref(href: string): string {
  const trimmed = href.trim();
  // A relative link is fine and common — every caller that has an origin
  // resolves it before it gets here, and one that does not is better off with
  // a path than with nothing.
  if (trimmed.startsWith("/")) return escapeHtml(trimmed);
  try {
    const url = new URL(trimmed);
    return SAFE_LINK_SCHEMES.has(url.protocol) ? escapeHtml(url.toString()) : "#";
  } catch {
    return "#";
  }
}
