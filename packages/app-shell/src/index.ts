/**
 * `@12-apps/app-shell` — the framework-free core of the shell three SPAs share (12-18).
 *
 * Nothing here imports React, a router, MUI or Hono. That is what makes it
 * importable from a worker, a test, a build script or the backend half, and it is
 * the reason the browser surface (`./react`), the backend surface (`./server`),
 * its Hono adapter (`./hono`) and the Vite preset (`./vite`) all sit behind their
 * own subpaths.
 *
 * What was extracted, and what deliberately was NOT:
 *
 *  - `session.tsx` did not come here. It had already been extracted as
 *    `@12-apps/auth/react`'s `createWebAuth`, so `./react` DEPENDS on it. Two
 *    implementations of one CSRF-protected sign-in is the drift this series keeps
 *    finding.
 *  - `realtime/` did not come here either — it is `@12-apps/realtime` (12-16). The
 *    consent gate's "tell them the moment it happens" accelerator arrives as a
 *    hook-shaped config seam instead, so this package carries no realtime code and
 *    no realtime dependency.
 *  - The Web Push subscribe flow belongs to `@12-apps/notifications` (12-15),
 *    which ships it beside the preferences screen that needs it.
 */
export {
  ApiError,
  apiFetch,
  joinApiPath,
  type ApiFetchOptions,
} from './core/api';

export { formatBRL, formatMinutesLabel, formatMoney, type MoneyFormat } from './core/format';

export {
  brandHex,
  brandTone,
  contrastRatio,
  hueGap,
  hueOfHex,
  readableInk,
  separateFromBrand,
  DEFAULT_SURFACE,
  EDGE_LIGHTNESS,
  MIN_TEXT_CONTRAST,
  SEMANTIC_HUE_GUARD,
  SEMANTIC_HUE_SHIFT,
  SURFACE_SATURATION,
  TINT_LIGHTNESS,
} from './core/brand-palette';

export { isChunkLoadError, loadRouteChunk } from './core/chunk-recovery';

export {
  CONSENT_ACCEPT_PATH,
  CONSENT_STATUS_PATH,
  type ConsentStatus,
} from './core/consent-wire';
