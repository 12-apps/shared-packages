import type { WireResponse, WireRoute } from "@12-apps/wiring";

import type { MarketplaceIntegrationView } from "../core/integration";
import type { LinkFailure, LinkPendingView, LinkRefusalCode } from "../core/linking";
import { MARKETPLACE_MANAGE } from "./contribution";
import { iso, ok, parse, refuse, type MarketplaceActor, type MarketplaceApiConfig } from "./http";
import { finishLinkBody, linkMerchantsQuery, linkStateQuery, selectLinkMerchantBody, startLinkBody } from "./mcp-link";

/**
 * Linking a store through the software's own marketplace app (FUT-5613), as
 * HTTP, beside the connection routes and behind the same permission:
 *
 * - `GET  …/marketplace/link?provider=` — whether linking is available, and the code in progress;
 * - `POST …/marketplace/link/start` — a new portal code (the verifier stays on the server);
 * - `POST …/marketplace/link/finish` — the pasted authorization code, for the store's tokens;
 * - `GET  …/marketplace/link/merchants?provider=` — the marketplace stores the grant covers;
 * - `PUT  …/marketplace/link/merchant` — which of them this store is.
 *
 * No answer ever carries a token, a verifier or the app's credentials.
 */

const BASE = "/admin/:tenantSlug/marketplace/link";

/** The HTTP status each refusal answers. */
const STATUS: Readonly<Record<LinkRefusalCode, number>> = {
  UNAVAILABLE: 409,
  NO_LINK_IN_PROGRESS: 409,
  LINK_EXPIRED: 409,
  CODE_REFUSED: 422,
  MARKETPLACE_REFUSED: 502,
  NOT_LINKED: 409,
  UNKNOWN_MERCHANT: 422,
  MERCHANT_TAKEN: 409,
};

/** A failure as the routes answer it: the host's sentence, the code, and the marketplace's own words. */
function failed(config: MarketplaceApiConfig, failure: LinkFailure): WireResponse {
  const words = config.copy.link;
  if (failure.kind === "retry") {
    return refuse(503, words?.tryAgain ?? "MARKETPLACE_UNREACHABLE", { code: "MARKETPLACE_UNREACHABLE" });
  }
  return refuse(STATUS[failure.code], words?.problems[failure.code] ?? failure.code, {
    code: failure.code,
    ...(failure.message === null ? {} : { marketplaceStatus: failure.status, marketplaceMessage: failure.message }),
  });
}

const pendingOut = (pending: LinkPendingView | null) => (pending ? { ...pending, expiresAt: pending.expiresAt.toISOString() } : null);

function connectionOut(row: MarketplaceIntegrationView) {
  return { ...row, lastEventAt: iso(row.lastEventAt), lastVerifiedAt: iso(row.lastVerifiedAt), archivedAt: iso(row.archivedAt) };
}

/** An unknown provider, before anything is asked of the engine. */
function unknown(config: MarketplaceApiConfig, id: string): WireResponse | null {
  return config.engine.knows(id) ? null : refuse(422, config.copy.problems.UNKNOWN_PROVIDER, { code: "UNKNOWN_PROVIDER" });
}

function readRoutes(config: MarketplaceApiConfig): WireRoute<MarketplaceActor>[] {
  const { engine, copy } = config;
  return [
    {
      method: "GET",
      path: BASE,
      permission: MARKETPLACE_MANAGE,
      handle: async ({ actor, query }) => {
        const parsed = parse(linkStateQuery, query, copy);
        if (!parsed.ok) return parsed.response;
        const refusal = unknown(config, parsed.value.provider);
        if (refusal) return refusal;
        const state = await engine.linkState({ clientId: actor.clientId, ...parsed.value });
        return ok({ available: state.available, pending: pendingOut(state.pending) });
      },
    },
    {
      method: "GET",
      path: `${BASE}/merchants`,
      permission: MARKETPLACE_MANAGE,
      handle: async ({ actor, query }) => {
        const parsed = parse(linkMerchantsQuery, query, copy);
        if (!parsed.ok) return parsed.response;
        const refusal = unknown(config, parsed.value.provider);
        if (refusal) return refusal;
        const result = await engine.linkedMerchants({ clientId: actor.clientId, provider: parsed.value.provider });
        return result.kind === "listed" ? ok(result.merchants) : failed(config, result);
      },
    },
  ];
}

function writeRoutes(config: MarketplaceApiConfig): WireRoute<MarketplaceActor>[] {
  const { engine, copy } = config;
  return [
    {
      method: "POST",
      path: `${BASE}/start`,
      permission: MARKETPLACE_MANAGE,
      handle: async ({ actor, body }) => {
        const parsed = parse(startLinkBody, body, copy);
        if (!parsed.ok) return parsed.response;
        const refusal = unknown(config, parsed.value.provider);
        if (refusal) return refusal;
        const result = await engine.startLink({ clientId: actor.clientId, ...parsed.value });
        return result.kind === "started" ? ok(pendingOut(result.pending)) : failed(config, result);
      },
    },
    {
      method: "POST",
      path: `${BASE}/finish`,
      permission: MARKETPLACE_MANAGE,
      handle: async ({ actor, body }) => {
        const parsed = parse(finishLinkBody, body, copy);
        if (!parsed.ok) return parsed.response;
        const refusal = unknown(config, parsed.value.provider);
        if (refusal) return refusal;
        const result = await engine.finishLink({ clientId: actor.clientId, actorId: actor.userId ?? null, ...parsed.value });
        if (result.kind !== "linked") return failed(config, result);
        return ok({ integration: connectionOut(result.integration), merchants: result.merchants });
      },
    },
    {
      method: "PUT",
      path: `${BASE}/merchant`,
      permission: MARKETPLACE_MANAGE,
      handle: async ({ actor, body }) => {
        const parsed = parse(selectLinkMerchantBody, body, copy);
        if (!parsed.ok) return parsed.response;
        const refusal = unknown(config, parsed.value.provider);
        if (refusal) return refusal;
        const result = await engine.selectLinkedMerchant({ clientId: actor.clientId, ...parsed.value });
        return result.kind === "selected" ? ok({ integration: connectionOut(result.integration) }) : failed(config, result);
      },
    },
  ];
}

/** The linking routes, in mount order. */
export function linkRoutes(config: MarketplaceApiConfig): WireRoute<MarketplaceActor>[] {
  return [...readRoutes(config), ...writeRoutes(config)];
}
