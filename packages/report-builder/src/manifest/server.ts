/**
 * `@12-apps/report-builder/manifest/server` — the server capabilities.
 *
 * One contribution: `http`, whose `create` IS `createApiReportBuilder`,
 * unchanged. The route descriptors it returns already satisfy the wiring
 * contract's `WireRoute` (the contract was shaped after them), so a host that
 * adopts this manifest mounts the same descriptors `/server` has always
 * produced — the difference is that `assemble()` now counts them, and
 * `unclaimedRoutes()` can name the ones a file-per-endpoint host forgot.
 *
 * Behind its own subpath so a web bundle importing `./manifest/web` never
 * resolves the server half. A plain `satisfies`-checked value — see
 * `./index` for why the contract package stays a type-only devDependency;
 * the inventory check against the shared manifest runs in the test suite.
 */

import type { AnyServerManifest } from '@12-apps/wiring';

import { createApiReportBuilder } from '../server/create-report-builder';

export const reportBuilderServerManifest = {
  name: '@12-apps/report-builder',
  http: { create: createApiReportBuilder },
} as const satisfies AnyServerManifest;
