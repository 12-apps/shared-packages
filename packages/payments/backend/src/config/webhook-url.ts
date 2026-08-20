import type { ProviderRegistry } from '../core/registry';

/**
 * WHERE A MERCHANT'S WEBHOOKS LAND (ported from the first adopting host,
 * FUT-763).
 *
 * `PaymentProviderAdapter.webhookPath` has existed since FUT-557 and nothing in
 * this package ever read it: the adapter declared the fact and every host was
 * left to act on it. That is the shape this fixes — a declaration only one
 * reader honours is a declaration the next host silently ignores, and the
 * failure is invisible until a provider stops calling back.
 *
 * ## The two rules
 *
 * **A declared path is served byte-identically, forever.** An adapter that
 * predates the generic route names the exact path its merchants registered in
 * the provider's own dashboard — a page the platform cannot edit on their
 * behalf. Every other adapter omits it and lands on the host's generic route.
 * Both exist at once, so an owner is never shown a URL that 404s.
 *
 * **An override replaces the ORIGIN and nothing else.** A local tunnel needs
 * the deliveries to reach it, but the PATH must stay byte-identical to
 * production's: a tunnel that exercised a different route would prove nothing
 * about the route that actually runs. A malformed override is ignored rather
 * than allowed to produce a URL no provider can reach.
 */

export interface MerchantWebhookUrlOptions {
  /** The public origin a provider must be able to reach — `https://…`. */
  origin: string;
  /**
   * The host's own route for adapters that declare no historical path. Takes
   * the merchant's slug and the provider name; returns a path with a leading
   * slash. The host owns its URL shape, so this is config, not a default.
   */
  genericPath: (merchantSlug: string, provider: string) => string;
  /**
   * Replace the origin only — a tunnel, a preview box. Ignored when it is not
   * a parsable absolute URL.
   */
  originOverride?: string | undefined;
}

/**
 * Build the URL this merchant's `provider` deliveries are announced at.
 *
 * No URL-encoding is applied: slugs and provider names are URL-safe by
 * construction, and a setup guide may render a literal `{merchantSlug}`
 * placeholder that has to survive verbatim.
 */
export function merchantWebhookUrl(
  providers: Pick<ProviderRegistry, 'has' | 'get'>,
  provider: string,
  merchantSlug: string,
  options: MerchantWebhookUrlOptions,
): string {
  const declared = providers.has(provider)
    ? providers.get(provider).webhookPath?.(merchantSlug)
    : undefined;
  const path = declared ?? options.genericPath(merchantSlug, provider);
  const url = `${trimTrailingSlash(options.origin)}${path}`;

  const override = options.originOverride?.trim();
  if (!override) return url;
  try {
    // The PATH of the real URL, re-based on the override's origin. Built from
    // `url` rather than from `path` so a declared path and a generic one are
    // overridden identically.
    return new URL(new URL(url).pathname, override).toString();
  } catch {
    // An unparsable override is a misconfiguration, not an instruction. The
    // production URL is the safe answer: deliveries keep arriving.
    return url;
  }
}

/** Regex-free, so there is no pattern to reason about on repeated slashes. */
function trimTrailingSlash(origin: string): string {
  let trimmed = origin;
  while (trimmed.endsWith('/')) trimmed = trimmed.slice(0, -1);
  return trimmed;
}
