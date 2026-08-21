/**
 * The endpoint-adapter mechanics every host copy repeats.
 *
 * Eleven hand-written adapters in the origin host translate a package's
 * framework-neutral route descriptors into the route files its gates scan —
 * and each restates the same three moves around genuinely host-owned config:
 * look a descriptor up and THROW on a miss, flatten validated params into
 * the wire's `Record<string, string | undefined>`, and turn `{status, body}`
 * into a fetch `Response`. Those moves are this module. What stays in the
 * host adapter is exactly what its gates and its domain require to stay:
 * the guard named in the route file's own source (`rbac:coverage` reads the
 * identifier out of the file text), the actor resolution, the plan gates,
 * the audit stamping, and the wire schemas.
 *
 * Deliberately primitives rather than a whole endpoint factory: across the
 * eleven copies the lookup timing, the tenant-param policy, the query
 * source and the response extras all diverge (streams, cookies, reshaped
 * envelopes) — a factory would carry a knob for every divergence and fit
 * none of them well. Each primitive is one shared sentence; the adapter
 * keeps its own paragraph.
 */

import type { MountedRoute, WireHttpMethod, WireResponse, WireRoute } from "../contract/http";

const WIRE_METHODS: readonly WireHttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/**
 * Split a route file's `"GET /reports/custom/:id"` claim into its halves,
 * refusing anything that is not a method the contract knows followed by a
 * path — a typo here should fail the first test that imports the file, not
 * answer 500s in production.
 */
export function parseWireRouteKey(key: string): { method: WireHttpMethod; path: string } {
  const separator = key.indexOf(" ");
  const method = (separator === -1 ? key : key.slice(0, separator)) as WireHttpMethod;
  const path = separator === -1 ? "" : key.slice(separator + 1);
  if (!WIRE_METHODS.includes(method) || !path.startsWith("/")) {
    throw new Error(
      `"${key}" is not a wire route key — expected "<METHOD> /path" with one of ${WIRE_METHODS.join("/")}.`,
    );
  }
  return { method, path };
}

export interface WireRouteTable {
  /** The descriptor at `method path`, or a throw naming the package. */
  route(method: WireHttpMethod, path: string): WireRoute<never>;
}

/**
 * The lookup-or-throw every adapter builds by hand: a `Map` keyed by
 * `"METHOD path"` over either raw descriptors or the consumer's
 * `MountedRoute`s (the mount prefix is accounting; the descriptor keeps its
 * package-relative path). Call `route()` at module load to fail a typo in
 * the unit test that imports the file, or per request where module-load
 * construction is impossible — the table itself does not care.
 */
export function createWireRouteTable(
  packageName: string,
  routes: readonly (WireRoute<never> | MountedRoute)[],
): WireRouteTable {
  const byKey = new Map(
    routes
      .map((entry) => ("route" in entry ? entry.route : entry))
      .map((route) => [`${route.method} ${route.path}`, route] as const),
  );
  return {
    route(method, path) {
      const route = byKey.get(`${method} ${path}`);
      if (!route) throw new Error(`No ${packageName} route for ${method} ${path}`);
      return route;
    },
  };
}

/**
 * Validated params/query, as the wire wants them: every value coerced to
 * its string form (`WireRequest` carries `Record<string, string |
 * undefined>`), `undefined` preserved as absence rather than the string
 * "undefined", and the host's routing-only keys dropped — `tenantSlug`
 * addresses the TENANT, which the guard already resolved into the actor,
 * not the record.
 */
export function forwardWireParams(
  values: Record<string, unknown> | undefined,
  options: { readonly drop?: readonly string[] } = {},
): Record<string, string | undefined> {
  if (!values) return {};
  const drop = options.drop ?? [];
  return Object.fromEntries(
    Object.entries(values)
      .filter(([key]) => !drop.includes(key))
      .map(([key, value]) => [key, value === undefined ? undefined : String(value)]),
  );
}

/**
 * The package's answer as a fetch `Response`, on the contract's own terms:
 * `body === undefined` means NO body at all — the bodyless 204 — which is
 * not the same as `null`, whose four serialized bytes would contradict a
 * status that promises none. Everything else passes through as JSON with
 * no re-wrapping: the packages already answer in the envelope their wire
 * schemas advertise, and wrapping again would nest it one level deeper for
 * every consumer at once.
 */
export function wireResponse(response: WireResponse): Response {
  if (response.body === undefined) return new Response(null, { status: response.status });
  return Response.json(response.body, { status: response.status });
}
