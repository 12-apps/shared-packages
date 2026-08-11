/**
 * Where the harness backend listens.
 *
 * One constant rather than three literals: the server binds it, the SPA's Vite
 * proxy forwards to it and Playwright waits on it, and a port that is right in
 * two of those places and stale in the third fails as "the page loaded and
 * every report is empty" — which reads like a broken package.
 *
 * The backend is the SPA's port + 1, so the pair is legible as one pair, and
 * BOTH are named here: the SPA's number used to be a literal in three places in
 * `playwright.config.ts`, which is precisely the "right in two places, stale in
 * the third" this comment warns about, one file away from where it warns.
 *
 * `HARNESS_SPA_PORT` moves the pair; `HARNESS_BACKEND_PORT` moves only the
 * backend when something already holds that one number. Every reader imports
 * this module, so there is no second place to remember.
 */
export const HARNESS_SPA_PORT = Number(process.env.HARNESS_SPA_PORT ?? 4319);

/** Where Playwright points the browser, and what `vite preview` binds. */
export const HARNESS_SPA_ORIGIN = `http://localhost:${HARNESS_SPA_PORT}`;

export const HARNESS_BACKEND_PORT = Number(
  process.env.HARNESS_BACKEND_PORT ?? HARNESS_SPA_PORT + 1,
);

/** The same thing a proxy target and a health check need spelled out. */
export const HARNESS_BACKEND_ORIGIN = `http://localhost:${HARNESS_BACKEND_PORT}`;
