/**
 * `@12-apps/report-builder/manifest` — the SHARED wiring manifest.
 *
 * Data every runtime can hold: identity, the permission contribution, the
 * MCP tools, the Prisma contribution and the e2e pointer, plus the INVENTORY
 * of the two runtime manifests (`./manifest/server`, `./manifest/web`). A
 * host adopts this through `@12-apps/wiring/consumer`, and the inventory is
 * what makes an unanswered capability a red `assemble()` instead of a silent
 * gap — the working-copy endpoints shipped for a release with no host
 * mounting them, and nothing said so; this file is the mechanism that says
 * so.
 *
 * `@12-apps/wiring` is a TYPE-ONLY devDependency here, on purpose: the
 * manifests are plain values `satisfies`-checked against the contract, and
 * the producer factories' assertions run in this package's own test suite
 * (`__tests__/manifest.test.ts`) — the same "fails in the package's own test
 * run" guarantee with zero runtime dependencies added, so this package's
 * release never waits on the contract package's, and a host that never
 * adopts the contract never installs it.
 */

import type { PackageManifest } from '@12-apps/wiring';

import { REPORT_BUILDER_PERMISSIONS } from '../server/contribution';
import { REPORT_BUILDER_MCP_TOOLS } from './mcp';

export {
  REPORT_BUILDER_MCP_TOOLS,
  reportBuilderMcpTools,
  type ReportBuilderMcpConfig,
} from './mcp';

export const reportBuilderManifest = {
  name: '@12-apps/report-builder',
  contract: 1,
  permissions: REPORT_BUILDER_PERMISSIONS,
  mcp: { endpoints: REPORT_BUILDER_MCP_TOOLS },
  db: { partial: 'prisma/report-builder.prisma', migrations: 'prisma/migrations' },
  e2e: { entry: '@12-apps/report-builder/e2e' },
  server: ['http'],
  web: ['surface', 'areas'],
} as const satisfies PackageManifest;
