import type { WireResponse, WireRoute } from "@12-apps/wiring";

import type { MarketplaceIntegrationView } from "../core/integration";
import type { MarketplaceMenuLinkView } from "../core/menu-links";
import { MARKETPLACE_DECIDE, MARKETPLACE_MANAGE } from "./contribution";
import { iso, ok, parse, refuse, type MarketplaceActor, type MarketplaceApiConfig } from "./http";
import {
  decideMarketplaceOrderBody,
  deleteMarketplaceIntegrationQuery,
  listMarketplaceMenuLinksQuery,
  marketplaceOrderParams,
  saveMarketplaceIntegrationBody,
  setMarketplaceMenuLinkBody,
} from "./mcp";
import { webhookRoute } from "./webhook";

/**
 * The marketplace HTTP surface as framework-neutral wiring descriptors: the
 * webhook every marketplace posts to, and the seven authenticated routes a
 * store's staff (and its MCP tools) use — connect, map, and answer the queue.
 *
 * There is no authentication, tenant resolution or RBAC in here: each
 * descriptor DECLARES the permission it needs and the host's guard answers
 * it; the actor arrives already resolved. Paths are relative to the host's
 * mount (`/api` reproduces the origin host's URLs exactly).
 */

export type MarketplaceRoute = WireRoute<MarketplaceActor> | WireRoute<unknown>;

const BASE = "/admin/:tenantSlug/marketplace";

/** A connection as the read returns it: dates as ISO, the adapter's half beside it. */
function integrationOut(config: MarketplaceApiConfig, row: MarketplaceIntegrationView) {
  const adapter = config.engine.adapter(row.provider);
  return {
    ...row,
    lastEventAt: iso(row.lastEventAt),
    lastVerifiedAt: iso(row.lastVerifiedAt),
    capabilities: adapter ? adapter.capabilities : null,
    reasons: adapter ? [...adapter.cancellationReasons()] : [],
  };
}

function linkOut(link: MarketplaceMenuLinkView) {
  return { ...link, lastSeenAt: link.lastSeenAt.toISOString() };
}

/** The provider is a registered adapter's, or the request is refused. */
function unknownProvider(config: MarketplaceApiConfig, provider: string | undefined): WireResponse | null {
  if (provider === undefined || config.engine.knows(provider)) return null;
  return refuse(422, config.copy.unknownProvider);
}

function integrationRoutes(config: MarketplaceApiConfig): WireRoute<MarketplaceActor>[] {
  const { engine, copy } = config;
  return [
    {
      method: "GET",
      path: BASE,
      permission: MARKETPLACE_MANAGE,
      handle: async ({ actor }) => {
        const rows = await engine.integrations(actor.clientId);
        return ok(rows.map((row) => integrationOut(config, row)));
      },
    },
    {
      method: "PUT",
      path: BASE,
      permission: MARKETPLACE_MANAGE,
      handle: async ({ actor, body }) => {
        const parsed = parse(saveMarketplaceIntegrationBody, body, copy);
        if (!parsed.ok) return parsed.response;
        const { provider, credentials, ...settings } = parsed.value;
        const refused = unknownProvider(config, provider);
        if (refused) return refused;
        if (credentials === undefined && Object.values(settings).every((value) => value === undefined)) {
          return refuse(422, copy.nothingToUpdate);
        }
        const saved = await engine.saveIntegration({
          clientId: actor.clientId,
          provider,
          ...settings,
          credentials: credentials
            ? { ...credentials, webhookSecret: credentials.webhookSecret ?? null }
            : undefined,
        });
        return ok(integrationOut(config, saved));
      },
    },
    {
      method: "DELETE",
      path: BASE,
      permission: MARKETPLACE_MANAGE,
      handle: async ({ actor, query }) => {
        const parsed = parse(deleteMarketplaceIntegrationQuery, query, copy);
        if (!parsed.ok) return parsed.response;
        await engine.deleteIntegration(actor.clientId, parsed.value.provider);
        return ok({ ok: true });
      },
    },
  ];
}

function menuLinkRoutes(config: MarketplaceApiConfig): WireRoute<MarketplaceActor>[] {
  const { engine, copy } = config;
  return [
    {
      method: "GET",
      path: `${BASE}/menu-links`,
      permission: MARKETPLACE_MANAGE,
      handle: async ({ actor, query }) => {
        const parsed = parse(listMarketplaceMenuLinksQuery, query, copy);
        if (!parsed.ok) return parsed.response;
        const links = await engine.menuLinks({
          clientId: actor.clientId,
          provider: parsed.value.provider,
          unmappedOnly: parsed.value.unmapped === "true",
        });
        return ok(links.map(linkOut));
      },
    },
    {
      method: "PUT",
      path: `${BASE}/menu-links`,
      permission: MARKETPLACE_MANAGE,
      handle: async ({ actor, body }) => {
        const parsed = parse(setMarketplaceMenuLinkBody, body, copy);
        if (!parsed.ok) return parsed.response;
        const refused = unknownProvider(config, parsed.value.provider);
        if (refused) return refused;
        const link = await engine.setMenuLink({ clientId: actor.clientId, ...parsed.value });
        // `null` is the engine saying the catalog id is not this tenant's.
        return link ? ok(linkOut(link)) : refuse(404, copy.catalogItemNotFound);
      },
    },
  ];
}

function acceptanceRoutes(config: MarketplaceApiConfig): WireRoute<MarketplaceActor>[] {
  const { engine, copy } = config;
  return [
    {
      method: "GET",
      path: `${BASE}/acceptances`,
      permission: MARKETPLACE_DECIDE,
      handle: async ({ actor }) => {
        const pending = await engine.pending(actor.clientId);
        return ok(
          pending.map((order) => ({
            ...order,
            acknowledgeBy: iso(order.acknowledgeBy),
            externalDueAt: iso(order.externalDueAt),
          })),
        );
      },
    },
    {
      method: "POST",
      path: `${BASE}/acceptances/:orderId`,
      permission: MARKETPLACE_DECIDE,
      handle: async ({ actor, params, body }) => {
        const route = parse(marketplaceOrderParams, params, copy);
        if (!route.ok) return route.response;
        const parsed = parse(decideMarketplaceOrderBody, body, copy);
        if (!parsed.ok) return parsed.response;
        const result = await engine.decide({
          clientId: actor.clientId,
          orderId: route.value.orderId,
          decision: parsed.value.decision,
          reasonCode: parsed.value.decision === "REJECT" ? parsed.value.reasonCode : undefined,
        });
        if (result.kind === "stale") return refuse(409, copy.orderNoLongerPending);
        if (result.kind === "invalidReason") {
          return refuse(422, copy.invalidReason, { validCodes: result.validCodes });
        }
        return ok({
          id: result.orderId,
          ackStatus: result.status,
          cancellation: result.cancellation,
          reasonCode: result.reasonCode,
        });
      },
    },
  ];
}

/** The whole surface, in mount order. */
export function marketplaceRoutes(config: MarketplaceApiConfig): MarketplaceRoute[] {
  return [
    webhookRoute(config),
    ...integrationRoutes(config),
    ...menuLinkRoutes(config),
    ...acceptanceRoutes(config),
  ];
}
