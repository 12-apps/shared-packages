import type { ConnectorContext } from '../connectors/types';
import type { RateLimiterPort } from '../ports';

/**
 * Per-domain pacing for the connector fetch path (FUT-416).
 *
 * Applied at the `ConnectorContext` seam rather than per connector: every
 * outbound call any connector makes — including EAN fallbacks and OAuth token
 * exchanges — flows through `fetchJson`/`postForm`, so wrapping the context is
 * the one place that covers connectors not written yet. Cache hits never reach
 * the wrapper (the pipeline answers them before calling the connector), so a
 * cached research costs zero limiter waits.
 */

/** Conservative default: two requests per second per domain. */
export const DEFAULT_DOMAIN_RATE_PER_SECOND = 2;

/** Sanity ceiling for a per-source override — a config typo must not turn the limiter off. */
const MAX_RATE_PER_SECOND = 50;

/**
 * The effective rate for one source: a positive, finite
 * `config.rateLimitPerSecond` (clamped to a sane ceiling) or the default.
 * Anything else — absent, zero, negative, NaN, a string — is the default.
 */
export const sourceRatePerSecond = (config: Record<string, unknown>): number => {
  const declared = config['rateLimitPerSecond'];
  if (typeof declared !== 'number' || !Number.isFinite(declared) || declared <= 0) {
    return DEFAULT_DOMAIN_RATE_PER_SECOND;
  }
  return Math.min(declared, MAX_RATE_PER_SECOND);
};

/** The limiter key for one URL: its hostname, or null when unparsable. */
const domainOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};

/**
 * Wrap a connector context so every outbound call first acquires a limiter
 * slot for the URL's domain. An unparsable URL skips the limiter and proceeds
 * — the transport will refuse it anyway, and a limiter must never invent a
 * failure mode of its own.
 */
/**
 * The pipeline's per-source entry point: the wrapped context when a limiter is
 * mounted (at the source's configured rate), the bare one otherwise.
 */
export const pacedContext = (
  ctx: ConnectorContext,
  limiter: RateLimiterPort | undefined,
  sourceConfig: Record<string, unknown>,
): ConnectorContext =>
  limiter ? rateLimitedContext(ctx, limiter, sourceRatePerSecond(sourceConfig)) : ctx;

export const rateLimitedContext = (
  ctx: ConnectorContext,
  limiter: RateLimiterPort,
  ratePerSecond: number,
): ConnectorContext => {
  const acquire = async (url: string): Promise<void> => {
    const domain = domainOf(url);
    if (domain !== null) await limiter.acquire(domain, ratePerSecond);
  };
  const wrapped: ConnectorContext = {
    ...ctx,
    fetchJson: async (url, init) => {
      await acquire(url);
      return ctx.fetchJson(url, init);
    },
  };
  // The reason-carrying GET (FUT-495) is a fetch path like any other: paced
  // here too, or a connector that adopts it would quietly escape the limiter.
  const fetchJsonResult = ctx.fetchJsonResult?.bind(ctx);
  if (fetchJsonResult) {
    wrapped.fetchJsonResult = async (url, init) => {
      await acquire(url);
      return fetchJsonResult(url, init);
    };
  }
  // …and so is the status-carrying GET. It began as the save-time credential
  // probe (FUT-434), but `fetchJsonOutcome` made it the middle SEARCH tier for a
  // host that has not adopted `fetchJsonResult` — so on such a host every
  // catalog GET, EAN fallback, regions probe and intelligent-search request
  // rode through the `{...ctx}` spread unpaced.
  const fetchJsonStatus = ctx.fetchJsonStatus?.bind(ctx);
  if (fetchJsonStatus) {
    wrapped.fetchJsonStatus = async (url, init) => {
      await acquire(url);
      return fetchJsonStatus(url, init);
    };
  }
  const postForm = ctx.postForm?.bind(ctx);
  if (postForm) {
    wrapped.postForm = async (url, form, init) => {
      await acquire(url);
      return postForm(url, form, init);
    };
  }
  // …and the reason-carrying POST (FUT-514), which was the LAST seam still
  // riding the `{...ctx}` spread unpaced. It is the VTEX delivery simulation:
  // one request per search, to the same storefront domain the catalog tiers
  // just hammered, so it was the one call most likely to be the one a store
  // rate-limits — and the sixth exchange the per-source ceiling (FUT-516) now
  // bounds. Both wrappers must cover the same seam set or a connector escapes
  // whichever one forgot it.
  const postJsonResult = ctx.postJsonResult?.bind(ctx);
  if (postJsonResult) {
    wrapped.postJsonResult = async (url, body, init) => {
      await acquire(url);
      return postJsonResult(url, body, init);
    };
  }
  return wrapped;
};
