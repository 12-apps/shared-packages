/**
 * `@12-apps/product-research/manifest` — the SHARED wiring manifest.
 *
 * Identity, the Prisma contribution, the permission contribution, the MCP
 * tools, the budget notification blueprint, and the runtime inventory:
 * `http` and `jobs`. Three narrowings are deliberate, not omissions:
 *
 * - **The MCP tools cover the operations whose whole wire contract this
 *   package states** (start/poll/run, the manual price list and quotes).
 *   The source-roster and integration tools stay host-authored — their
 *   response shapes carry the host's connector roster views — and join the
 *   assembled surface through the adoption's `mcpEndpoints` extension; the
 *   history LISTING's query grammar is likewise the host's own search-grid
 *   config, so its route and tool both stay host code (see `../http`).
 * - **The notification blueprint carries the origin host's pt-BR pack.**
 *   The words and the CTA link are host copy, so the blueprint is built by
 *   `createResearchBudgetBlueprint(copy)` — a host with other words builds
 *   its own through the same factory and feeds it to its mount.
 * - **No `e2e`, no `env`** — no packaged journeys, and zero `process.env`
 *   reads in shipped source (every deployment decision is an argument).
 *
 * `@12-apps/wiring` is a TYPE-ONLY devDependency (the report-builder move):
 * the manifests are plain `satisfies`-checked values, and the producer
 * factories' runtime assertions run in this package's own test suite.
 */

import type { PackageManifest } from '@12-apps/wiring';

import { PRODUCT_RESEARCH_PERMISSIONS } from '../contribution';
import { RESEARCH_NOTIFICATIONS } from '../notifications';
import { PRODUCT_RESEARCH_MCP_TOOLS } from './mcp';

export {
  PRODUCT_RESEARCH_MCP_TOOLS,
  productResearchMcpTools,
  type ResearchMcpConfig,
  type ResearchMcpTool,
} from './mcp';
export { PRODUCT_RESEARCH_PERMISSIONS } from '../contribution';
export {
  createResearchBudgetBlueprint,
  PT_BR_RESEARCH_BUDGET_COPY,
  RESEARCH_BUDGET_NOTIFICATION_TYPE,
  RESEARCH_NOTIFICATIONS,
  type ResearchBudgetCopy,
  type ResearchBudgetPayload,
  type ResearchBudgetScope,
} from '../notifications';

export const productResearchManifest = {
  name: '@12-apps/product-research',
  contract: 1,
  permissions: PRODUCT_RESEARCH_PERMISSIONS,
  mcp: { endpoints: PRODUCT_RESEARCH_MCP_TOOLS },
  notifications: RESEARCH_NOTIFICATIONS,
  db: { partial: 'prisma/product-research.prisma', migrations: 'prisma/migrations' },
  /**
   * Mandatory for runtime manifests since wiring 1.3.0: a run that dies on
   * its last attempt files under `product-research`, not nowhere.
   */
  observability: { namespace: 'product-research' },
  server: ['http', 'jobs'],
} as const satisfies PackageManifest;
