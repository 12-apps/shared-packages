import { buildAuthorizationServerMetadata } from "../auth/authorization-server-metadata";
import { buildProtectedResourceMetadata } from "../auth/resource-metadata";

import { authorizeEndpoint } from "./authorize";
import { issuer, resourceAudience } from "./config";
import {
  notFound,
  resolveMcpOauthConfig,
  type McpOauthConfig,
  type McpOauthContext,
} from "./context";
import { registerEndpoint, registrationDisabled } from "./register";
import { tokenEndpoint } from "./token-grants";
import {
  verifyAccessToken,
  type VerifiedAccessToken,
  type VerifyAccessTokenOptions,
} from "./access-token";

/**
 * The OAuth 2.1 authorization server, as one mount (12-23).
 *
 * `@12-apps/mcp` shipped the OpenAPI→tools generator, the bearer proxy and the two
 * discovery BUILDERS, and held zero authorization logic — which meant every new app
 * still wrote the AS itself: ~1.5k LOC of authorize/token/register plus the code,
 * token, PKCE, rotation and replay machinery under them. All of that is the
 * surface's contract, not a host's, so it lives here.
 *
 * Routes are FRAMEWORK-NEUTRAL descriptors whose handler takes a Fetch `Request`
 * and answers a Fetch `Response`. Unlike the report-builder-shaped surfaces there
 * is no `{ data }` envelope to adapt: an OAuth response is a 302 with a `Location`,
 * a form-encoded exchange answering RFC 6749 §5.1/§5.2 JSON, or an RFC 8414/9728
 * document — shapes fixed by specification that a wrapper would only break. So the
 * adapters are one line each, and a host with a file-per-route layout can export
 * the named handlers directly:
 *
 *   export const GET = mcpOauth.handlers.authorize;      // app/api/oauth/authorize
 *   export const POST = mcpOauth.handlers.token;         // app/api/oauth/token
 *
 * What stays the HOST's: the cookie session (`resolveSession`), where the data
 * lives (`stores`), which origins are trusted, the operator gate, and its sign-in
 * path. Everything else is the RFCs'.
 */

export interface McpOauthRoute {
  method: "GET" | "POST";
  /** Absolute path from the ORIGIN ROOT — `.well-known/*` cannot live under a prefix. */
  path: string;
  handle(request: Request): Promise<Response>;
}

export interface McpOauthHandlers {
  /** `GET` — Authorization Code + PKCE, identity from the session only. */
  authorize: (request: Request) => Promise<Response>;
  /** `POST` — the two grants, form-encoded, RFC 6749 bodies. */
  token: (request: Request) => Promise<Response>;
  /** `POST` — RFC 7591 dynamic client registration (403 when the gate is off). */
  register: (request: Request) => Promise<Response>;
  /** `GET` — the public JWKS (503 while no key is provisioned). */
  jwks: (request: Request) => Promise<Response>;
  /** `GET` — RFC 8414 authorization-server metadata. */
  authorizationServerMetadata: (request: Request) => Promise<Response>;
  /** `GET` — RFC 9728 protected-resource metadata. */
  protectedResourceMetadata: (request: Request) => Promise<Response>;
}

export interface ApiMcpOauth {
  /** Every endpoint, in mount order. */
  routes: McpOauthRoute[];
  /** The same handlers by name, for a host whose router is its file tree. */
  handlers: McpOauthHandlers;
  /**
   * Verify a bearer token the way THIS surface mints them — the resource server's
   * half. Bound to the same signing key, resource path and trusted-origin
   * resolution, which is what stops "minted for origin A, verified against origin
   * B" from rejecting valid tokens.
   */
  verifyBearer: (
    token: string,
    request: Request,
    options?: Omit<VerifyAccessTokenOptions, "origin" | "resourcePath">,
  ) => Promise<VerifiedAccessToken>;
  /** The resolved config, for a host that needs the same origin/audience answers. */
  context: McpOauthContext;
}

/** JSON, with the status and cache policy each document wants. */
function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

/**
 * The public key set, or a 503.
 *
 * Safe-by-default: an unprovisioned AS answers 503 rather than an empty or
 * partial key set, so a client never mistakes "no key yet" for "a usable key".
 */
async function jwksResponse(context: McpOauthContext): Promise<Response> {
  const key = await context.signingKey();
  if (!key) return jsonResponse({ error: "signing_key_unavailable" }, 503);
  return jsonResponse({ keys: [key.publicJwk] }, 200, {
    // Public, cacheable key set; hosts may cache it and re-fetch on a `kid` miss
    // (rotation). A short max-age keeps the rotation overlap tight.
    "cache-control": "public, max-age=300",
  });
}

/** The two discovery documents, built from ONE origin and ONE scope source. */
function discoveryHandlers(
  context: McpOauthContext,
): Pick<McpOauthHandlers, "authorizationServerMetadata" | "protectedResourceMetadata"> {
  return {
    authorizationServerMetadata: async (request) =>
      jsonResponse(
        buildAuthorizationServerMetadata({
          issuer: issuer(context.originOf(request)),
          scopesSupported: [...context.scopes],
          // The RESOLVED paths, so what a connector reads before its first request
          // is where the endpoints actually are.
          paths: context.paths,
        }),
      ),
    protectedResourceMetadata: async (request) => {
      const origin = context.originOf(request);
      return jsonResponse(
        buildProtectedResourceMetadata({
          resource: resourceAudience(origin, context.resourcePath),
          authorizationServers: [issuer(origin)],
          scopesSupported: [...context.scopes],
        }),
      );
    },
  };
}

/**
 * Every endpoint, behind the operator gate.
 *
 * With the gate off the surface is INERT and answers 404, so a probe cannot tell
 * a disabled AS from an app that has none. Registration is the one exception: it
 * answers 403, because RFC 7591 has a code for "the endpoint is here, but
 * registration is closed" and the documented static-client path is the answer.
 */
function buildHandlers(context: McpOauthContext): McpOauthHandlers {
  const gated =
    (handler: (request: Request) => Promise<Response>) =>
    async (request: Request): Promise<Response> =>
      context.enabled() ? handler(request) : notFound();
  const discovery = discoveryHandlers(context);

  return {
    authorize: gated((request) => authorizeEndpoint(context, request)),
    token: gated((request) => tokenEndpoint(context, request)),
    register: async (request) =>
      context.enabled() ? registerEndpoint(context, request) : registrationDisabled(),
    jwks: gated(() => jwksResponse(context)),
    authorizationServerMetadata: gated(discovery.authorizationServerMetadata),
    protectedResourceMetadata: gated(discovery.protectedResourceMetadata),
  };
}

/** Mount order, and the paths a host may have moved. */
function buildRoutes(context: McpOauthContext, handlers: McpOauthHandlers): McpOauthRoute[] {
  const { paths } = context;
  return [
    {
      method: "GET",
      path: paths.authorizationServerMetadata,
      handle: handlers.authorizationServerMetadata,
    },
    {
      method: "GET",
      path: paths.protectedResourceMetadata,
      handle: handlers.protectedResourceMetadata,
    },
    { method: "GET", path: paths.jwks, handle: handlers.jwks },
    { method: "GET", path: paths.authorize, handle: handlers.authorize },
    { method: "POST", path: paths.token, handle: handlers.token },
    { method: "POST", path: paths.register, handle: handlers.register },
  ];
}

export function createApiMcpOauth(config: McpOauthConfig): ApiMcpOauth {
  const context = resolveMcpOauthConfig(config);
  const handlers = buildHandlers(context);

  return {
    routes: buildRoutes(context, handlers),
    handlers,
    verifyBearer: (token, request, options) =>
      verifyAccessToken(context.signingKey, token, {
        ...options,
        origin: context.originOf(request),
        resourcePath: context.resourcePath,
      }),
    context,
  };
}
