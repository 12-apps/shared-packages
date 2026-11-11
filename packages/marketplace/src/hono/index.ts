import { Hono } from "hono";
import type { Context } from "hono";

import type { WireRoute } from "@12-apps/wiring";

import { createApiMarketplace, type ApiMarketplace, type MarketplaceActor, type MarketplaceApiConfig } from "../server";

/**
 * `@12-apps/marketplace/hono` — the marketplace routes as one mountable
 * router.
 *
 * The framework-neutral descriptors in `./server` are the contract; this is
 * the adapter for the framework the origin host runs, behind its own subpath
 * with `hono` as an OPTIONAL peer. A host writes:
 *
 *   const marketplace = marketplaceRouter({ engine, copy, tenantBySlug, logger, resolveActor });
 *   app.route("/api", marketplace.router);
 *
 * and keeps what is genuinely its own: who the caller is, and whether they
 * hold the route's declared permission (`authorize`). The webhook is never
 * guarded: it is a marketplace's server, verified by signature inside.
 */

/** Resolve the caller for an authenticated route. `null` answers 401. */
export type ResolveMarketplaceActor = (
  c: Context,
  permission: string | undefined,
) => Promise<MarketplaceActor | null> | MarketplaceActor | null;

export interface MarketplaceHonoConfig extends MarketplaceApiConfig {
  /**
   * Who the caller is, given the permission the route declares. The host
   * resolves the tenant from `:tenantSlug` and refuses a caller without the
   * permission by answering null (401) — or by throwing its own 403.
   */
  resolveActor: ResolveMarketplaceActor;
}

export interface MarketplaceHono extends ApiMarketplace {
  router: Hono;
}

/** A JSON body, only when the caller said it was JSON. */
async function readBody(c: Context): Promise<unknown> {
  if (c.req.method === "GET" || c.req.method === "DELETE") return undefined;
  const type = (c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (type !== "application/json" && !type.endsWith("+json")) return undefined;
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

export function marketplaceRouter(config: MarketplaceHonoConfig): MarketplaceHono {
  const api = createApiMarketplace(config);
  const router = new Hono();

  // Mounted IN DESCRIPTOR ORDER, which any adapter must preserve.
  for (const route of api.routes) {
    const handler = async (c: Context): Promise<Response> => {
      const params = c.req.param() as Record<string, string | undefined>;
      const query = c.req.query() as Record<string, string | undefined>;
      if (route.kind === "webhook") {
        // The raw request, untouched: the signature is over these bytes.
        const webhook = route as WireRoute<unknown>;
        const answer = await webhook.handle({ actor: undefined, params, query, request: c.req.raw });
        return c.json(answer.body as Record<string, unknown>, answer.status as 200);
      }
      const actor = await config.resolveActor(c, route.permission);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      const guarded = route as WireRoute<MarketplaceActor>;
      const answer = await guarded.handle({ actor, params, query, body: await readBody(c) });
      return c.json(answer.body as Record<string, unknown>, answer.status as 200);
    };
    switch (route.method) {
      case "GET":
        router.get(route.path, handler);
        break;
      case "POST":
        router.post(route.path, handler);
        break;
      case "PUT":
        router.put(route.path, handler);
        break;
      case "DELETE":
        router.delete(route.path, handler);
        break;
      default:
        throw new Error(`@12-apps/marketplace/hono cannot mount ${route.method} ${route.path}. Add a case.`);
    }
  }

  return { ...api, router };
}
