import { lazy } from 'react';

import { loadRouteChunk } from '../core/chunk-recovery';

/**
 * `React.lazy` for a routed page — same call shape, plus the stale-chunk recovery
 * in `../core/chunk-recovery`. Use this instead of `lazy()` for anything reached by
 * navigation.
 *
 * Typed as `typeof lazy` rather than with its own generic: React's signature is the
 * only one that infers a page's props correctly for BOTH prop-less pages and the
 * handful that take a flag (`<LedgerPage readOnly />`), and restating it here just
 * reintroduces the variance holes React already solved.
 */
export const lazyRoute: typeof lazy = (loader) => lazy(() => loadRouteChunk(loader));
