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
import type { McpOauthStores, StoredOAuthClient } from "./stores";

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
   * The OAuth subject (the origin host passes the Google `sub`, falling back to the
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
  // the origin host's paths, and the ones the RFC 8414 document has always advertised.
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
   * answer 404 and registration answers 403 — which is how the origin host ships it OFF
   * by default (`MCP_BEARER_ENABLED`). Default: enabled (mounting is the opt-in).
   */
  enabled?: boolean | (() => boolean);
  /**
   * Signing material. Default: the env-backed provider with the origin host's variable
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
  /**
   * The single-use guard for authorization codes — REQUIRED, and required on
   * purpose. Pass a shared atomic store, or the literal `'in-process'` to accept
   * the single-instance limitation explicitly.
   *
   * There is deliberately NO default, because a default here would be the only one
   * in this config that fails OPEN. Every other one fails closed: no signing key
   * mints nothing and answers JWKS 503; `enabled: false` is 404 everywhere; an
   * empty `trustedOrigins` never trusts a forwarded host. An in-process default
   * instead silently permits cross-instance code replay — against an OAuth 2.1
   * MUST, on the very deployment shape a reusable package exists for (two pods
   * behind one load balancer), with nothing in the types to notice. Scaling out
   * must not be able to weaken the guard without somebody having typed something.
   */
  codeReplay: CodeReplayStore | "in-process";
  /**
   * Approve an authorize request before a code is minted — the CONSENT step.
   *
   * Registration is open whenever `enabled` is true (RFC 7591), so without an
   * approval step anyone may register a client carrying their OWN redirect URI and
   * their OWN scope ceiling, send a signed-in admin one link, and have the endpoint
   * mint them a code with no interaction: the redirect URI is exact-matched against
   * the attacker's own registration and the scope ceiling is the attacker's too, so
   * every other guard here holds and none of them helps.
   *
   * Until a host supplies this, `authorize` REFUSES any client it cannot see the
   * operator behind — i.e. any client not named in {@link preApprovedClientIds}.
   * Return `false` to deny (the caller gets an `access_denied` redirect, exactly as
   * a human refusal would).
   */
  resolveApproval?: (
    request: Request,
    client: StoredOAuthClient,
    scopes: readonly string[],
  ) => Promise<boolean> | boolean;
  /**
   * Client ids the OPERATOR registered, exempt from the approval gate above — the
   * escape hatch for a host that ships its own first-party clients and has no
   * consent screen to offer. Anything NOT listed here is treated as dynamically
   * registered, i.e. as attacker-controllable.
   */
  preApprovedClientIds?: readonly string[];
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
  /**
   * The resolved consent decision for one authorize request. Always present: with
   * no host seam it refuses every client the operator did not pre-approve, so the
   * handler has no "unset" case to forget.
   */
  approve: (
    request: Request,
    client: StoredOAuthClient,
    scopes: readonly string[],
  ) => Promise<boolean>;
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
    // surface dark passes its own flag (the origin host: `MCP_BEARER_ENABLED`).
    enabled: typeof enabled === "function" ? enabled : () => enabled,
    // `null` from the provider means "not provisioned": nothing is minted and the
    // JWKS answers 503 rather than falling back to a weaker mode.
    signingKey: config.signingKey ?? loadSigningKeyFromEnv(),
    trustedOrigins,
    ...resolveSurface(config),
    // `'in-process'` is an ACKNOWLEDGEMENT, not a default — see the field's docs.
    codeReplay:
      config.codeReplay === "in-process" ? inProcessCodeReplayStore() : config.codeReplay,
    approve: resolveApprover(config),
    ...(config.connections ? { connections: config.connections } : {}),
    originOf: (request) => originFromRequest(request, trustedOrigins),
  };
}

/**
 * The consent decision, resolved once. A host seam wins; otherwise only a client
 * the OPERATOR named may proceed, so an open registration endpoint cannot mint a
 * code for a client nobody approved.
 */
function resolveApprover(config: McpOauthConfig): McpOauthContext["approve"] {
  const preApproved = new Set(config.preApprovedClientIds ?? []);
  const { resolveApproval } = config;
  return async (request, client, scopes) => {
    if (preApproved.has(client.clientId)) return true;
    if (!resolveApproval) return false;
    return resolveApproval(request, client, scopes);
  };
}

/** The gate's own answer: 404, so a disabled surface looks like no surface. */
export function notFound(): Response {
  return new Response("Not Found", { status: 404 });
}
