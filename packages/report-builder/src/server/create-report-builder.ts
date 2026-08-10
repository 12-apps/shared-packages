import { createSavedReportStore } from './saved';

import { catalogRoute } from './routes-catalog';
import { runRoute } from './routes-run';
import { savedReadRoutes } from './routes-saved-read';
import { savedWorkingCopyRoutes } from './routes-saved-working-copy';
import { savedWriteRoutes } from './routes-saved-write';
import { systemRoutes } from './routes-system';
import type { ReportBuilderServerConfig, ReportRoute } from './context';

/**
 * The one thing this package exposes to a BACKEND host (FUT-391).
 *
 * The endpoints used to live in the host: eight route files that parsed a
 * request, called into this package, and shaped a response. Only the middle
 * step was ever the host's business — the parsing and the response shape are
 * this surface's contract, and the frontend half of that contract already
 * lives here. Splitting one contract across two repositories is how the client
 * and the server drift, and they had: the client had been calling `PUT` at a
 * server that only answered `PATCH` for as long as both halves existed.
 *
 * Routes are FRAMEWORK-NEUTRAL descriptors, not a Hono/Express router. This
 * package must not take a web framework as a dependency — a host on a
 * different one could then never adopt it, and a host on the same one would
 * still be pinned to our version of it. `@12-apps/report-builder/hono` adapts
 * them in forty lines; another framework's adapter is about the same.
 *
 * What stays the HOST's, and is passed in rather than guessed at:
 *
 *  - **Authentication and tenant resolution** — who is calling, on which
 *    tenant. The host hands over a {@link ReportActor}.
 *  - **RBAC** — the actor's permission ids. This narrows against them; it does
 *    not compute them.
 *  - **Entitlements and quota** — whether the plan includes reports at all,
 *    and whether the tenant may save another. Those are billing questions, and
 *    a host answers them before the request ever reaches a descriptor.
 */
export function createApiReportBuilder(config: ReportBuilderServerConfig): {
  routes: ReportRoute[];
} {
  const store = createSavedReportStore(config.db);
  return {
    routes: [
      catalogRoute(config),
      ...systemRoutes(config),
      ...savedReadRoutes(config, store),
      ...savedWriteRoutes(config, store),
      ...savedWorkingCopyRoutes(config, store),
      runRoute(config),
    ],
  };
}

export {
  type ReportActor,
  type ReportAdapterFactory,
  type ReportBuilderServerConfig,
  type ReportRequest,
  type ReportResponse,
  type ReportRoute,
} from './context';
export { documentShape } from './summary';
