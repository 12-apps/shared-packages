/**
 * `@12-apps/product-research/manifest` — the SHARED wiring manifest.
 *
 * Identity, the Prisma contribution, the permission contribution, the MCP
 * tools, and the runtime inventory: `http` and `jobs`. Three narrowings are
 * deliberate, not omissions:
 *
 * - **The MCP tools cover the operations whose whole wire contract this
 *   package states** (start/poll/run, the manual price list and quotes).
 *   The source-roster and integration tools stay host-authored — their
 *   response shapes carry the host's connector roster views — and join the
 *   assembled surface through the adoption's `mcpEndpoints` extension; the
 *   history LISTING's query grammar is likewise the host's own search-grid
 *   config, so its route and tool both stay host code (see `../http`).
 * - **No static `notifications` capability.** The budget alert's words and
 *   CTA are host copy, so a blueprint pre-worded here would be a silent
 *   pt-BR default. The capability ships as the factory
 *   `createResearchBudgetBlueprint(copy)` (`../notifications`; the `./pt-BR`
 *   named pack carries the origin host's words) — the host builds it and
 *   feeds its own notifications mount, a line in its diff.
 * - **No `e2e`, no `env`** — no packaged journeys, and zero `process.env`
 *   reads in shipped source (every deployment decision is an argument).
 *
 * `@12-apps/wiring` is a TYPE-ONLY devDependency (the report-builder move):
 * the manifests are plain `satisfies`-checked values, and the producer
 * factories' runtime assertions run in this package's own test suite.
 */

import type { PackageManifest } from '@12-apps/wiring';

import { PRODUCT_RESEARCH_PERMISSIONS } from '../contribution';
import { PRODUCT_RESEARCH_MCP_TOOLS } from './mcp';

export {
  PRODUCT_RESEARCH_MCP_TOOLS,
  productResearchMcpTools,
  type ResearchMcpConfig,
  type ResearchMcpTool,
} from './mcp';
export {
  PRODUCT_RESEARCH_PERMISSIONS,
  type ResearchPermissionsContribution,
} from '../contribution';
export {
  createResearchBudgetBlueprint,
  RESEARCH_BUDGET_NOTIFICATION_TYPE,
  type ResearchBudgetCopy,
  type ResearchBudgetPayload,
  type ResearchBudgetScope,
  type ResearchNotificationBlueprint,
  type ResearchNotificationContent,
  type ResearchNotificationContext,
} from '../notifications';

export const productResearchManifest = {
  name: '@12-apps/product-research',
  contract: 1,
  permissions: PRODUCT_RESEARCH_PERMISSIONS,
  mcp: { endpoints: PRODUCT_RESEARCH_MCP_TOOLS },
  db: { partial: 'prisma/product-research.prisma', migrations: 'prisma/migrations' },
  /**
   * Mandatory for runtime manifests since wiring 1.3.0: a run that dies on
   * its last attempt files under `product-research`, not nowhere.
   */
  observability: { namespace: 'product-research' },
  server: ['http', 'jobs'],
} as const satisfies PackageManifest;
