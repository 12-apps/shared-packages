/**
 * `@12-apps/entity-lifecycle/manifest` — the SHARED wiring manifest.
 *
 * Identity, the Prisma contribution and the runtime inventory. Three
 * absences are deliberate, not omissions, and the compliance suite pins
 * each one:
 *
 * - **No `mcp` contribution.** The tools are VOCABULARY-DEPENDENT:
 *   `lifecycleMcpEndpoints(vocabulary)` needs the host's nouns, collection
 *   paths and eight human summaries per collection, none of which this
 *   package can know. The wiring contract carves out exactly this case
 *   (`WireMcpTool`'s docs name this factory): the host calls the factory
 *   and its results join the aggregate through the adoption's
 *   `mcpEndpoints` extension.
 * - **No `permissions` contribution.** Every permission id this package
 *   touches is HOST vocabulary handed in at registration time
 *   (`routePermission`, `approvePermission`) — there is no package-owned id
 *   a manifest could declare without inventing one.
 * - **No `e2e`.** The package ships Storybook stories, not packaged
 *   journeys; declaring an entry it does not export would fail the exports
 *   tripwire in its own test run — which is the point of the tripwire.
 *
 * No `env` either: zero `process.env` reads in shipped source — every
 * deployment-shaped decision is an argument.
 *
 * `@12-apps/wiring` is a TYPE-ONLY devDependency (the report-builder move):
 * the manifests are plain `satisfies`-checked values, and the producer
 * factories' runtime assertions run in this package's own test suite.
 */

import type { PackageManifest } from '@12-apps/wiring';

export const entityLifecycleManifest = {
  name: '@12-apps/entity-lifecycle',
  contract: 1,
  db: { partial: 'prisma/entity-lifecycle.prisma', migrations: 'prisma/migrations' },
  /**
   * Mandatory for runtime manifests since wiring 1.3.0: the binder hands
   * this package a logger scoped to the namespace, so a failed restore or
   * a refused approval files under `entity-lifecycle`, not nowhere.
   */
  observability: { namespace: 'entity-lifecycle' },
  server: ['http'],
  web: ['surface', 'areas'],
} as const satisfies PackageManifest;
