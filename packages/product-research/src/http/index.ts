/**
 * `createApiProductResearch` — the research HTTP surface as framework-neutral
 * route descriptors (the wiring contract's `http` capability; the shapes are
 * structural twins, checked in the manifest compliance suite).
 *
 * What used to be origin-host route files becomes sixteen descriptors, split
 * the way the pipeline's ports already split the world:
 *
 * - the PACKAGE owns the surface — paths, the `{ data }` envelopes, the 202
 *   accepted-then-poll posture, the credential-field completeness rule, the
 *   probe-before-persist ordering, the CSV/quote normalization it already
 *   ships, and every status code;
 * - the HOST owns what it always owned — the guards (each route declares the
 *   package's own permission id for the host to map), validation in its own
 *   schema language, storage, the connector probes and the SSRF gate, the
 *   credential encryption, and every operator-facing sentence (the `./pt-BR`
 *   named pack ships the origin host's set for a pt-BR host to pass, the
 *   realtime doctrine).
 *
 * ONE route of the eleven original files stays deliberately host code: the
 * history grid's `GET /research` listing. Its query grammar and result
 * envelope come from the host's own search machinery (facets, sort keys and
 * pagination derived from a host grid config over host-named columns), so a
 * descriptor here could only restate that config or drift from it. The start
 * POST on the same path is declared; the listing rides beside it as a host
 * route.
 */

import { integrationRoutes } from './integrations';
import { manualRoutes } from './manual';
import { requestRoutes } from './requests';
import { sourceRoutes } from './sources';
import type { ResearchApi, ResearchApiConfig } from './types';

export * from './types';

export function createApiProductResearch(config: ResearchApiConfig): ResearchApi {
  for (const key of ['store', 'checks', 'credentials', 'messages', 'connectors'] as const) {
    if (config?.[key] === undefined) {
      throw new Error(`createApiProductResearch needs ${key} — a host decision with no default.`);
    }
  }
  return {
    routes: [
      ...requestRoutes(config),
      ...integrationRoutes(config),
      ...sourceRoutes(config),
      ...manualRoutes(config),
    ],
  };
}
