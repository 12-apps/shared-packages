import {
  DEFAULT_MCP_RESOURCE_PATH,
  MCP_SUPPORTED_SCOPES,
  originFromRequest,
} from "./config";
import {
  inProcessCodeReplayStore,
  type CodeReplayStore,
} from "./code-replay";
import { ACCESS_TOKEN_TTL_SECONDS } from "./access-token";
import { REFRESH_TOKEN_TTL_MS } from "./refresh";
import { loadSigningKeyFromEnv, type McpSigningKeyProvider } from "./keys";
import type { ProviderAttributionRule } from "./clients";
import type { McpOauthStores } from "./stores";

/**
 * The config seam of the authorization server, and its resolved form (12-23).
 *
 * Everything a HOST knows and the package cannot: who the signed-in caller is,
 * where the data lives, which origins are trusted, whether the surface is turned
 * on at all, and where its endpoints are mounted. Everything else — the RFC wire,
 * PKCE, rotation, replay, the discovery documents — is the package's.
 */

/** The identity an authorize request binds a code to. From the SESSION only. */
export interface McpOauthSession {
  /**
   * The OAuth subject (future-pay passes the Google `sub`, falling back to the
   * email). Carried through every rotation so a refreshed token keeps the same
   * stable `sub`.
   */
  subject: string;
  /** The signed-in user's email — the identity the AS binds to. */
  email: string;
}

/** Where each endpoint of the surface lives, from the origin root. */
export interface McpOauthPaths {
  authorize: string;
  token: string;
  register: string;
  jwks: string;
  authorizationServerMetadata: string;
  protectedResourceMetadata: string;
}

export const DEFAULT_OAUTH_PATHS: McpOauthPaths = {
  // future-pay's paths, and the ones the RFC 8414 document has always advertised.
  authorize: "/api/oauth/authorize",
  token: "/api/oauth/token",
  register: "/api/oauth/register",
  jwks: "/.well-known/jwks.json",
  authorizationServerMetadata: "/.well-known/oauth-authorization-server",
  protectedResourceMetadata: "/.well-known/oauth-protected-resource",
};

/** How a connection's liveness is recorded on a successful grant. */
export interface McpConnectionRecording {
  /**
   * The host's DB user id for a token's email, or `null` when there is no user row
   * yet (recording is then skipped — email is the identity, not the id).
   */
  resolveUserId: (email: string) => Promise<string | null> | string | null;
  /** Provider attribution rules; defaults to claude/chatgpt roots. */
  providerRules?: readonly ProviderAttributionRule[];
  /** Don't rewrite on every grant — refresh liveness at most this often. */
  activityThrottleMs?: number;
}

export interface McpOauthConfig {
  /** Where the three owned tables live (see `./stores.ts`). */
  stores: McpOauthStores;
  /**
   * Resolve the caller's COOKIE SESSION for the authorize endpoint. `null` sends
   * the caller through the host's sign-in flow; no code is ever minted for an
   * unauthenticated request, and a client can never supply the identity itself.
   */
  resolveSession: (request: Request) => Promise<McpOauthSession | null> | McpOauthSession | null;
  /**
   * The operator gate. `false` makes the whole surface inert — authorize/token/jwks
   * answer 404 and registration answers 403 — which is how future-pay ships it OFF
   * by default (`MCP_BEARER_ENABLED`). Default: enabled (mounting is the opt-in).
   */
  enabled?: boolean | (() => boolean);
  /**
   * Signing material. Default: the env-backed provider with future-pay's variable
   * names. `null` from the provider means "not provisioned": nothing is minted and
   * the JWKS answers 503 rather than falling back to a weaker mode.
   */
  signingKey?: McpSigningKeyProvider;
  /**
   * The trusted PUBLIC origin allowlist — REQUIRED behind a reverse proxy, where
   * the server sees only its internal bind. The FIRST entry is canonical. With
   * none configured a forwarded host is never trusted (see `resolveTrustedOrigin`).
   */
  trustedOrigins?: readonly string[];
  /** Scopes the AS advertises and validates against. Default `mcp:read mcp:write`. */
  scopes?: readonly string[];
  /** Where the MCP resource is mounted — the token audience. Default `/api/mcp`. */
  resourcePath?: string;
  /** Endpoint paths, if the host mounts them somewhere else. */
  paths?: Partial<McpOauthPaths>;
  /** Where an unauthenticated authorize request is sent. Default `/login`. */
  loginPath?: string;
  /**
   * The query parameter carrying the post-login return path. Default
   * `callbackUrl` (Auth.js's name).
   */
  loginCallbackParam?: string;
  accessTokenTtlSeconds?: number;
  refreshTokenTtlMs?: number;
  /** Single-use code guard. Default in-process — read its multi-instance caveat. */
  codeReplay?: CodeReplayStore;
  /** Liveness recording on a grant; omit to record nothing. */
  connections?: McpConnectionRecording;
}

/** The config with every default applied — what the handlers actually read. */
export interface McpOauthContext {
  stores: McpOauthStores;
  resolveSession: McpOauthConfig["resolveSession"];
  enabled: () => boolean;
  signingKey: McpSigningKeyProvider;
  trustedOrigins: readonly string[];
  scopes: readonly string[];
  resourcePath: string;
  paths: McpOauthPaths;
  loginPath: string;
  loginCallbackParam: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlMs: number;
  codeReplay: CodeReplayStore;
  connections?: McpConnectionRecording;
  /** The trusted public origin for THIS request (issuance and verification agree). */
  originOf: (request: Request) => string;
}

/** The surface's own shape: what it advertises, where it lives, how long it lasts. */
function resolveSurface(
  config: McpOauthConfig,
): Pick<
  McpOauthContext,
  | "scopes"
  | "resourcePath"
  | "paths"
  | "loginPath"
  | "loginCallbackParam"
  | "accessTokenTtlSeconds"
  | "refreshTokenTtlMs"
> {
  return {
    scopes: config.scopes ?? [...MCP_SUPPORTED_SCOPES],
    resourcePath: config.resourcePath ?? DEFAULT_MCP_RESOURCE_PATH,
    paths: { ...DEFAULT_OAUTH_PATHS, ...config.paths },
    loginPath: config.loginPath ?? "/login",
    loginCallbackParam: config.loginCallbackParam ?? "callbackUrl",
    accessTokenTtlSeconds: config.accessTokenTtlSeconds ?? ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlMs: config.refreshTokenTtlMs ?? REFRESH_TOKEN_TTL_MS,
  };
}

export function resolveMcpOauthConfig(config: McpOauthConfig): McpOauthContext {
  const enabled = config.enabled ?? true;
  const trustedOrigins = config.trustedOrigins ?? [];
  return {
    stores: config.stores,
    resolveSession: config.resolveSession,
    // Mounting is the opt-in, so the gate defaults to ON; a host that ships the
    // surface dark passes its own flag (future-pay: `MCP_BEARER_ENABLED`).
    enabled: typeof enabled === "function" ? enabled : () => enabled,
    // `null` from the provider means "not provisioned": nothing is minted and the
    // JWKS answers 503 rather than falling back to a weaker mode.
    signingKey: config.signingKey ?? loadSigningKeyFromEnv(),
    trustedOrigins,
    ...resolveSurface(config),
    codeReplay: config.codeReplay ?? inProcessCodeReplayStore(),
    ...(config.connections ? { connections: config.connections } : {}),
    originOf: (request) => originFromRequest(request, trustedOrigins),
  };
}

/** The gate's own answer: 404, so a disabled surface looks like no surface. */
export function notFound(): Response {
  return new Response("Not Found", { status: 404 });
}
