/**
 * `@12-apps/product-research/manifest/server` — the server capability: the
 * run blueprint, unchanged from `./jobs`. A host adopting this manifest
 * binds `ResearchJobDeps` (registry, connector context and overrides closed
 * over into one `runResearch` call) or declines the jobs capability in
 * writing; the consumer refuses a silent third state.
 */

import type { AnyServerManifest } from '@12-apps/wiring';

import { RESEARCH_JOBS } from '../jobs';

export const productResearchServerManifest = {
  name: '@12-apps/product-research',
  jobs: RESEARCH_JOBS,
} as const satisfies AnyServerManifest;
