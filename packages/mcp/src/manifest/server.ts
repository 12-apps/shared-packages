/**
 * `@12-apps/mcp/manifest/server` — the server capabilities.
 *
 * `http.create` wraps `createApiMcpOauth` in a WIRE VIEW, and the reason is
 * the shape of an OAuth answer. `McpOauthRoute.handle` takes a Fetch
 * `Request` and returns a Fetch `Response` — not a `{ status, body }` pair —
 * because every endpoint here answers something the JSON pair cannot say: a
 * 302 whose `Location` IS the payload, a form-encoded exchange answering
 * RFC 6749 §5.1/§5.2 with its own cache headers, a JWKS with a
 * `public, max-age=300`, an RFC 8414/9728 document. `create-api-mcp-oauth`'s
 * own docstring says a wrapper would only break those. So the view answers
 * the contract's RAW half (`{ response }`, wiring 1.9.0), which exists for
 * exactly this, and the descriptors stay untouched.
 *
 * ## THE RAW REQUEST IS REQUIRED, and the view says so out loud
 *
 * The contract obliges an adapter to fill `params`/`query`/`body` and lets it
 * fill `request`. Every handler here needs the whole request — the exact URL
 * (redirect_uri echo, PKCE parameters, the `Host` an issuer is derived
 * from), the form body byte-for-byte, the cookie header the session is read
 * off. So a missing `request` is refused loudly at the first call rather
 * than silently producing an authorization server that mints codes for the
 * wrong origin. `@12-apps/storage`'s view takes the same posture for the
 * same reason.
 *
 * ## THE MOUNT IS THE ORIGIN ROOT
 *
 * `McpOauthRoute.path` is absolute from the origin root — `.well-known/*`
 * cannot live under a prefix (RFC 8615), and a connector reads those
 * documents before it has ever spoken to us. The consumer joins
 * `mountPath + path`, so the ONLY correct binding is `mountPath: "/"`; the
 * paths themselves stay configurable per host through `config.paths`, which
 * is where a host that serves `authorize` somewhere else says so. Binding
 * this surface under a prefix would move the discovery documents off the
 * two URLs the specification reserves, and the symptom is a connector that
 * cannot find the authorization server at all.
 *
 * ## EVERY ROUTE IS `public`, and that is a decision
 *
 * Not "unguarded": these six ARE the authentication, so a host RBAC gate in
 * front of them would demand a token from the endpoint that issues tokens.
 * `authorize` reads the host's cookie session itself (`config.resolveSession`)
 * and sends an anonymous caller through the host's sign-in flow; `token` and
 * `register` authenticate the CLIENT per RFC; the three documents are public
 * by specification. `public` is also the contract's only kind that forbids a
 * `permission` while allowing the routes to be reached anonymously — which
 * is precisely the property that has to hold here.
 *
 * `@12-apps/wiring` is a TYPE-ONLY devDependency — see `./index`.
 */

import type { AnyServerManifest, WireRequest, WireRouteAnswer } from "@12-apps/wiring";

import {
  createApiMcpOauth,
  type ApiMcpOauth,
  type McpOauthConfig,
  type McpOauthRoute,
} from "../oauth";

/** One `McpOauthRoute` as the wiring contract reads it. */
function asWireRoute(route: McpOauthRoute): {
  method: McpOauthRoute["method"];
  path: string;
  kind: "public";
  handle(request: WireRequest): Promise<WireRouteAnswer>;
} {
  return {
    method: route.method,
    path: route.path,
    kind: "public",
    handle: async (request) => {
      if (!request.request) {
        throw new Error(
          "@12-apps/mcp/oauth needs the raw request — bind an adapter that forwards it.",
        );
      }
      return { response: await route.handle(request.request) };
    },
  };
}

/** `createApiMcpOauth`, its routes re-shaped for the aggregate. */
export function createWireApiMcpOauth(
  config: McpOauthConfig,
): Omit<ApiMcpOauth, "routes"> & { routes: ReturnType<typeof asWireRoute>[] } {
  const api = createApiMcpOauth(config);
  return { ...api, routes: api.routes.map(asWireRoute) };
}

export const mcpServerManifest = {
  name: "@12-apps/mcp",
  http: { create: createWireApiMcpOauth },
} as const satisfies AnyServerManifest;
