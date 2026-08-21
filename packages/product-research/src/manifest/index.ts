/**
 * `@12-apps/product-research/manifest` — the SHARED wiring manifest.
 *
 * Identity, the Prisma contribution, and `jobs` as the one runtime
 * capability. The rest of the surface is deliberately UNDECLARED, and the
 * compliance suite pins each absence:
 *
 * - **No `http`.** This is a library-with-ports: connectors, a pipeline and
 *   zod wire schemas — no route descriptors and no `createApi*` factory.
 *   The origin host's eleven research routes are host code over the ports,
 *   and `schemas.ts` says so in as many words.
 * - **No `mcp`.** The research tools are HOST-authored CRUD over
 *   host-mounted routes; with no `http` capability, any declared tool path
 *   would be a guess at the host's URL space. The package contributes the
 *   wire schemas (`researchQuerySchema`, `startResearchSchema`, …) as plain
 *   exports the host's tools import.
 * - **No `permissions`**, **no `e2e`**, **no `env`** — host vocabulary, no
 *   packaged journeys, and zero `process.env` reads respectively.
 *
 * `@12-apps/wiring` is a TYPE-ONLY devDependency (the report-builder move):
 * the manifests are plain `satisfies`-checked values, and the producer
 * factories' runtime assertions run in this package's own test suite.
 */

import type { PackageManifest } from '@12-apps/wiring';

export const productResearchManifest = {
  name: '@12-apps/product-research',
  contract: 1,
  db: { partial: 'prisma/product-research.prisma', migrations: 'prisma/migrations' },
  /**
   * Mandatory for runtime manifests since wiring 1.3.0: a run that dies on
   * its last attempt files under `product-research`, not nowhere.
   */
  observability: { namespace: 'product-research' },
  server: ['jobs'],
} as const satisfies PackageManifest;
