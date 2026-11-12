import type { WireResponse, WireRoute } from "@12-apps/wiring";

import type { BulkProblem } from "../core/bulk";
import type { DecisionProblem } from "../core/cancellation";
import type { MarketplaceIntegrationView } from "../core/integration";
import type { MarketplaceMenuLinkView } from "../core/menu-links";
import { MARKETPLACE_DECIDE, MARKETPLACE_MANAGE } from "./contribution";
import type { MarketplaceServerCopy } from "./copy";
import { iso, ok, parse, refuse, type MarketplaceActor, type MarketplaceApiConfig } from "./http";
import {
  decideMarketplaceOrdersBody,
  listMarketplaceAcceptancesQuery,
  listMarketplaceIntegrationsQuery,
  listMarketplaceMenuLinksQuery,
  upsertMarketplaceIntegrationsBody,
  upsertMarketplaceMenuLinksBody,
} from "./mcp";
import { webhookRoute } from "./webhook";

/**
 * The marketplace HTTP surface as framework-neutral wiring descriptors: the
 * webhook every marketplace posts to, and, per entity, one read and one bulk
 * write — connections, SKU links, decisions — for a store's staff and its MCP
 * tools alike.
 *
 * There is no authentication, tenant resolution or RBAC in here: each
 * descriptor DECLARES the permission it needs and the host's guard answers it;
 * the actor arrives already resolved. Paths are relative to the host's mount.
 */

export type MarketplaceRoute = WireRoute<MarketplaceActor> | WireRoute<unknown>;

const BASE = "/admin/:tenantSlug/marketplace";

/** The 409 code of a decision on an order that is no longer on the clock. */
export const ORDER_NOT_PENDING_CODE = "MARKETPLACE_ORDER_NOT_PENDING";

const NOT_PENDING = new Set(["NOT_FOUND", "ALREADY_DECIDED", "EXPIRED", "CONFLICT"]);

/** A connection as the read returns it: dates as ISO, the adapter's half beside it. */
function integrationOut(config: MarketplaceApiConfig, row: MarketplaceIntegrationView) {
  const adapter = config.engine.adapter(row.provider);
  return {
    ...row,
    lastEventAt: iso(row.lastEventAt),
    lastVerifiedAt: iso(row.lastVerifiedAt),
    archivedAt: iso(row.archivedAt),
    capabilities: adapter ? adapter.capabilities : null,
    reasons: adapter ? [...adapter.cancellationReasons()] : [],
  };
}

function linkOut(link: MarketplaceMenuLinkView) {
  return { ...link, lastSeenAt: link.lastSeenAt.toISOString() };
}

/** Each problem with its sentence; a host refusal keeps the host's own words. */
function problemsOut(copy: MarketplaceServerCopy, problems: readonly (BulkProblem | DecisionProblem)[]) {
  return problems.map((problem) => {
    const host = "host" in problem ? problem.host : undefined;
    return {
      ...problem,
      message: host?.message ?? copy.problems[problem.code],
      ...(host ? { hostCode: host.code, details: host.details } : {}),
    };
  });
}

/** A refused bulk write: 422, nothing saved, every problem with its path. */
function refusedBulk(copy: MarketplaceServerCopy, problems: readonly BulkProblem[]): WireResponse {
  return refuse(422, copy.nothingSaved, { problems: problemsOut(copy, problems) });
}

/**
 * A refused decision call. The host's own refusal is a 409 carrying ITS code
 * (`MARKETPLACE_STOCK_ASK` and the short lines in `details`); an order no
 * longer on the clock a 409; anything else (a reason, an item) a 422.
 */
function refusedDecisions(copy: MarketplaceServerCopy, problems: readonly DecisionProblem[]): WireResponse {
  const out = problemsOut(copy, problems);
  const host = problems.find((problem) => problem.code === "HOST_REFUSED")?.host;
  if (host) return refuse(409, host.message, { code: host.code, details: host.details, problems: out });
  if (problems.some((problem) => NOT_PENDING.has(problem.code))) {
    return refuse(409, copy.orderNoLongerPending, { code: ORDER_NOT_PENDING_CODE, problems: out });
  }
  return refuse(422, copy.nothingSaved, { problems: out });
}

function integrationRoutes(config: MarketplaceApiConfig): WireRoute<MarketplaceActor>[] {
  const { engine, copy } = config;
  return [
    {
      method: "GET",
      path: BASE,
      permission: MARKETPLACE_MANAGE,
      handle: async ({ actor, query }) => {
        const parsed = parse(listMarketplaceIntegrationsQuery, query, copy);
        if (!parsed.ok) return parsed.response;
        const rows = await engine.integrations(actor.clientId, {
          providers: parsed.value.ids,
          includeArchived: parsed.value.includeArchived === "true",
        });
        return ok(rows.map((row) => integrationOut(config, row)));
      },
    },
    {
      method: "PUT",
      path: BASE,
      permission: MARKETPLACE_MANAGE,
      handle: async ({ actor, body }) => {
        const parsed = parse(upsertMarketplaceIntegrationsBody, body, copy);
        if (!parsed.ok) return parsed.response;
        const result = await engine.upsertIntegrations({
          clientId: actor.clientId,
          actorId: actor.userId ?? null,
          validateOnly: parsed.value.validateOnly,
          rows: parsed.value.integrations.map((row) =>
            "credentials" in row && row.credentials
              ? { ...row, credentials: { ...row.credentials, webhookSecret: row.credentials.webhookSecret ?? null } }
              : row,
          ) as Parameters<typeof engine.upsertIntegrations>[0]["rows"],
        });
        if (result.kind === "refused") return refusedBulk(copy, result.problems);
        return ok({ validateOnly: result.validateOnly, integrations: result.rows.map((row) => integrationOut(config, row)) });
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
          ids: parsed.value.ids,
        });
        return ok(links.map(linkOut));
      },
    },
    {
      method: "PUT",
      path: `${BASE}/menu-links`,
      permission: MARKETPLACE_MANAGE,
      handle: async ({ actor, body }) => {
        const parsed = parse(upsertMarketplaceMenuLinksBody, body, copy);
        if (!parsed.ok) return parsed.response;
        const result = await engine.upsertMenuLinks({
          clientId: actor.clientId,
          rows: parsed.value.links,
          validateOnly: parsed.value.validateOnly,
        });
        if (result.kind === "refused") return refusedBulk(copy, result.problems);
        return ok({ validateOnly: result.validateOnly, links: result.rows.map(linkOut) });
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
      handle: async ({ actor, query }) => {
        const parsed = parse(listMarketplaceAcceptancesQuery, query, copy);
        if (!parsed.ok) return parsed.response;
        const pending = await engine.pending(actor.clientId, parsed.value.ids);
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
      path: `${BASE}/acceptances`,
      permission: MARKETPLACE_DECIDE,
      handle: async ({ actor, body }) => {
        const parsed = parse(decideMarketplaceOrdersBody, body, copy);
        if (!parsed.ok) return parsed.response;
        const result = await engine.decideMany({
          clientId: actor.clientId,
          decisions: parsed.value.decisions,
          validateOnly: parsed.value.validateOnly,
        });
        if (result.kind === "refused") return refusedDecisions(copy, result.problems);
        return ok({ validateOnly: result.validateOnly, decisions: result.rows });
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
