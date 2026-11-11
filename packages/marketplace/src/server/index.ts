import type { MarketplaceEngine } from "../core/engine";
import type { MarketplaceApiConfig } from "./http";
import { marketplaceRoutes, type MarketplaceRoute } from "./routes";

/**
 * `@12-apps/marketplace/server` — the engine's HTTP surface, jobs, MCP tools
 * and permissions, as wiring-contract values.
 *
 * ```ts
 * const engine = createMarketplaceEngine({ …ports, adapters });
 * const api = createApiMarketplace({ engine, copy, tenantBySlug, logger });
 * // api.routes: mount under `/api` (the hono adapter does it in one line)
 * ```
 */

/** What `createApiMarketplace` hands back: the routes, and the engine they serve. */
export interface ApiMarketplace {
  routes: MarketplaceRoute[];
  engine: MarketplaceEngine;
}

/** Build the route table over a mounted engine. */
export function createApiMarketplace(config: MarketplaceApiConfig): ApiMarketplace {
  if (!config.logger) {
    throw new Error("@12-apps/marketplace: the observability namespace needs a logger; pass `logger`.");
  }
  return { routes: marketplaceRoutes(config), engine: config.engine };
}

export type { MarketplaceActor, MarketplaceApiConfig } from "./http";
export type { MarketplaceRoute } from "./routes";
export type { MarketplaceServerCopy } from "./copy";
export {
  MARKETPLACE_DECIDE,
  MARKETPLACE_MANAGE,
  MARKETPLACE_PERMISSIONS,
} from "./contribution";
export {
  MARKETPLACE_JOBS,
  MARKETPLACE_OUTBOUND_ATTEMPTS,
  MARKETPLACE_SWEEP_QUEUE,
  type MarketplaceJobDeps,
} from "./jobs";
export {
  MARKETPLACE_MCP_TOOLS,
  decideMarketplaceOrderBody,
  deleteMarketplaceIntegrationQuery,
  listMarketplaceMenuLinksQuery,
  marketplaceOrderParams,
  marketplaceParams,
  saveMarketplaceIntegrationBody,
  setMarketplaceMenuLinkBody,
} from "./mcp";
