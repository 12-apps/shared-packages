/**
 * What a performance span may carry off the device.
 *
 * Web Vitals travel as STREAMED spans: `traceLifecycle: "stream"` is a client
 * option, not a per-integration one, so every span this package lets through
 * reaches Sentry via `beforeSendSpan` and never via `beforeSendTransaction`.
 * That makes `beforeSendSpan` the one choke point, the same way `beforeSend` is
 * for errors.
 *
 * A span names a page three ways: its own `name`, the `sentry.transaction` and
 * `sentry.segment.name` attributes the SDK stamps on every span, and the URL a
 * vital attributes itself to (`browser.web_vital.lcp.url`, …). A URL is run
 * through `scrubUrl` first, which drops the query and fragment, but `scrubUrl`
 * KEEPS the path, and on a host whose paths name a tenant the path is the
 * leak. This package cannot know which segment that is, so the host registers
 * the rule (`span-rule.ts`), in the same shape as `setErrorClassifiers`.
 *
 * It loads with the Web Vitals, after `load`, and `installWebVitals` installs
 * the hook before any integration that makes a span: nothing here is on the
 * critical path, and no span leaves before the hook is in place.
 */
import { scrubUrl } from "./scrub";
import { spanTextRule } from "./span-rule";

/** Attributes that carry the page's NAME. */
const NAME_ATTRIBUTES = new Set(["sentry.transaction", "sentry.segment.name"]);

/** A key that carries a URL: `url.full`, `http.url`, `browser.web_vital.lcp.url`… */
const isUrlKey = (key: string): boolean => key === "url" || key.endsWith(".url") || key.startsWith("url.");

/**
 * A URL with its query and fragment gone and the host's rule run over its PATH
 * only: the rule is about paths and page names, and an origin is neither.
 */
function scrubPageUrl(value: string): string {
  const bare = scrubUrl(value);
  try {
    const url = new URL(bare);
    return `${url.origin}${spanTextRule()(url.pathname)}`;
  } catch {
    return spanTextRule()(bare);
  }
}

/**
 * A page NAME, which is usually a path but can be the whole URL: the browser
 * timing spans (`domContentLoadedEvent`, `connect`, `request`…) are named by
 * the document's URL. Measured on the adopting storefront, eight of them
 * carried the tenant's path until a URL name was scrubbed as a URL.
 */
function scrubName(value: string): string {
  return /^https?:\/\//i.test(value) ? scrubPageUrl(value) : spanTextRule()(value);
}

function scrubAttribute(key: string, value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (NAME_ATTRIBUTES.has(key)) return scrubName(value);
  if (isUrlKey(key)) return scrubPageUrl(value);
  return value;
}

/** The shape of a streamed span, as far as scrubbing is concerned. */
interface ScrubbableSpan {
  name: string;
  attributes?: Record<string, unknown>;
}

/** A span with its name and every page-naming attribute run through the rules. */
export function scrubSpan<T extends ScrubbableSpan>(span: T): T {
  const attributes = span.attributes
    ? Object.fromEntries(Object.entries(span.attributes).map(([k, v]) => [k, scrubAttribute(k, v)]))
    : span.attributes;
  return { ...span, name: scrubName(span.name), attributes };
}
