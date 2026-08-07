import { createWebReportBuilder } from '@12-apps/report-builder/react';

import { memoryBackend } from '../lib/memory-backend';

/**
 * The whole wiring a frontend host performs for this package.
 *
 * Everything the reports feature IS — the list, the viewer, the editor, the
 * config panel, the pickers, the routes between them — lives inside
 * @12-apps/report-builder. This file names the tenant and says how to reach
 * the API, which is the only part that is genuinely the host's.
 *
 * The harness supplies an in-memory backend because it has no server. A real
 * host omits `transport` entirely and gets same-origin fetch.
 */
const { page } = createWebReportBuilder({
  tenantSlug: 'harness',
  transport: memoryBackend(),
  // The harness has no router or query client of its own, so the surface
  // stands up both. A host that already renders them omits this and the
  // reports screens mount into the host's, sharing its cache.
  standalone: true,
});

export const ReportBuilderPage = page;
