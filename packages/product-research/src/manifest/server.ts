/**
 * `@12-apps/product-research/manifest/server` — the server capabilities.
 *
 * `http.create` IS `createApiProductResearch` (`../http`): sixteen
 * descriptors over the store, checks, codec and connector seams the host
 * binds, each marked with one of this package's own permission ids. The
 * `jobs` half is the run blueprint, unchanged from `../jobs`. A host
 * adopting this manifest binds both or declines each in writing; the
 * consumer refuses a silent third state.
 */

import type { AnyServerManifest } from '@12-apps/wiring';

import { createApiProductResearch } from '../http';
import { RESEARCH_JOBS } from '../jobs';

export const productResearchServerManifest = {
  name: '@12-apps/product-research',
  http: { create: createApiProductResearch },
  jobs: RESEARCH_JOBS,
} as const satisfies AnyServerManifest;
