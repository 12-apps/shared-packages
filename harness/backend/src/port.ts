/**
 * Where the harness backend listens.
 *
 * One constant rather than three literals: the server binds it, the SPA's Vite
 * proxy forwards to it and Playwright waits on it, and a port that is right in
 * two of those places and stale in the third fails as "the page loaded and
 * every report is empty" — which reads like a broken package.
 *
 * 4319 + 1 on purpose: 4319 is the SPA's preview port, so the pair is legible
 * as one pair. `HARNESS_BACKEND_PORT` moves both halves at once for the
 * machine where something else already holds it; every reader below imports
 * this module, so there is no second place to remember.
 */
export const HARNESS_BACKEND_PORT = Number(process.env.HARNESS_BACKEND_PORT ?? 4320);

/** The same thing a proxy target and a health check need spelled out. */
export const HARNESS_BACKEND_ORIGIN = `http://localhost:${HARNESS_BACKEND_PORT}`;
