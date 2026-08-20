/**
 * `@12-apps/report-builder/manifest/server` — the server capabilities.
 *
 * One contribution: `http`, whose `create` IS `createApiReportBuilder`,
 * unchanged. The route descriptors it returns already satisfy the wiring
 * contract's `WireRoute` (the contract was shaped after them), so a host that
 * adopts this manifest mounts the same eleven descriptors `/server` has
 * always produced — the difference is that `assemble()` now counts them, and
 * `unclaimedRoutes()` can name the ones a file-per-endpoint host forgot.
 *
 * Behind its own subpath so a web bundle importing `./manifest/web` never
 * resolves the server half.
 */

import { defineServerManifest } from '@12-apps/wiring/producer';

import { createApiReportBuilder } from '../server/create-report-builder';
import { reportBuilderManifest } from './index';

export const reportBuilderServerManifest = defineServerManifest(reportBuilderManifest, {
  name: '@12-apps/report-builder',
  http: { create: createApiReportBuilder },
});
