/**
 * `@12-apps/rbac/manifest` — the SHARED wiring manifest.
 *
 * Identity, the permission contribution, the Prisma contribution (the five
 * owned models) and the runtime inventory: `http` on the server.
 *
 * `permissions` is `RBAC_PERMISSIONS` (`../permissions`) — the three ids
 * guarding this package's OWN screens and endpoints, unlabelled on purpose.
 * The words they read in are UI copy and arrive as required host config
 * (`RbacWebCopy.permissionLabels`), so the contribution ships ids and specs
 * only; `wiring`'s `WirePermissionsContribution` makes `labels` optional for
 * exactly this reason, and an rbac contribution satisfies it unchanged.
 *
 * Two narrowings are deliberate:
 *
 * - **No `env`.** This package reads `process.env` nowhere; every
 *   deployment decision reaches it as an argument.
 * - **No static `notifications` capability**, though this package now owns
 *   one event. The invite notice's words and CTA are host copy, so a
 *   blueprint pre-worded here would be a silent pt-BR default — the exact
 *   thing the copy gate refuses. It ships as the factory
 *   `createTeamInvitedBlueprint(copy)` (`../server/notifications`, with
 *   `PT_BR_TEAM_INVITED_COPY` carrying the origin host's words), the same
 *   carve-out `createResearchBudgetBlueprint` documents one package over.
 *
 * The `web` inventory USED to be a third narrowing, on a premise that is
 * false: it claimed a server host adopting this manifest would be obliged to
 * answer for a React surface it never mounts. The consumer reports a
 * capability declared for the OTHER runtime as `out-of-scope` and returns
 * fine — only an applicable, unanswered capability is `unbound`, which
 * `@12-apps/wiring`'s own fixture suite asserts. The narrowing protected
 * nothing and made the role editor and team screens undeclarable to any web
 * host; `./manifest/web` declares them now.
 *
 * ON THE `db` DECLARATION, and what it does NOT claim. It says this package
 * SHIPS `prisma/rbac.prisma` — five models plus the migration that built
 * them. Whether a given host composes that partial is the host's answer, not
 * this declaration's: a host that declared the same tables first carves the
 * partial out by file name (the origin host does, with the migration half
 * carved out beside it), and its assembler skips the copy whether it learned
 * about the partial from this declaration or from the structural fallback
 * that preceded it. So declaring is safe for such a host and correct for a
 * new one — and it moves the carve-out from answering a filesystem scan to
 * answering something a package actually said.
 *
 * `@12-apps/wiring` is a TYPE-ONLY devDependency (the report-builder move):
 * the manifest is a plain `satisfies`-checked value, and the producer
 * factories' runtime assertions run in this package's own test suite.
 */

import type { PackageManifest } from '@12-apps/wiring';

import { RBAC_PERMISSIONS } from '../permissions';

export const rbacManifest = {
  name: '@12-apps/rbac',
  contract: 1,
  permissions: RBAC_PERMISSIONS,
  db: { partial: 'prisma/rbac.prisma', migrations: 'prisma/migrations' },
  /**
   * Mandatory for runtime manifests since wiring 1.3.0: a refused grant or a
   * failed role write files under `rbac`, not nowhere.
   */
  observability: { namespace: 'rbac' },
  server: ['http'],
  web: ['surface', 'areas'],
} as const satisfies PackageManifest;
