import { ACCESS_TOKEN_TTL_SECONDS, signAccessToken } from "./access-token";
import { AuthorizationCodeError, verifyCode } from "./authorization-code";
import { providerFromRedirectUris } from "./clients";
import type { McpConnectionRecording, McpOauthContext } from "./context";
import { verifyChallenge } from "./pkce";
import {
  RefreshTokenError,
  getRefreshTokenIdentity,
  issueRefreshToken,
  rotateRefreshToken,
} from "./refresh";
import type { McpConnectionStore } from "./stores";
import {
  authenticateClient,
  readClientCredentials,
  tokenError,
  tokenSuccess,
  type ClientCredentials,
} from "./token-response";

/**
 * The two grant handlers of the token endpoint (12-23, ported from the origin host's
 * `lib/mcp/oauth/token-grants.ts`).
 *
 * Security invariants enforced here, unchanged:
 *   - **Single-use codes:** the code's `jti` is consumed the moment it is
 *     redeemed; a replay of the same code is `invalid_grant`.
 *   - **PKCE:** a `code_verifier` that does not S256-match the code's
 *     `code_challenge` is `invalid_grant`.
 *   - **Client auth:** a public client's `client_id` must equal the code's bound
 *     client; a confidential client must present a secret whose SHA-256 matches
 *     the stored hash, else `invalid_client` (401).
 *   - **Bound `redirect_uri`:** it must equal the one the code was minted with
 *     (RFC 6749 §4.1.3).
 *   - **Refresh rotation:** client-bound, replay-revoking, narrow-only scope.
 */

/** Throttle default: don't rewrite liveness on every grant. */
const DEFAULT_ACTIVITY_THROTTLE_MS = 60_000;

/**
 * Best-effort: record that this user's AI host (OAuth client) is live, so an
 * account page can show "connected via Claude · active 2 min ago". Runs on the
 * token grant, not the per-request hot path; hosts refresh every ~15 min so
 * liveness stays fresh.
 *
 * NEVER lets a failure break token issuance — a recording error is swallowed, and
 * nothing about it is logged, because the only interesting values here are an
 * email and a client id. Skipped when the host resolves no user row (email is the
 * identity) or when no connection recording is configured at all.
 */
async function recordHostConnection(
  context: McpOauthContext,
  email: string,
  clientId: string,
): Promise<void> {
  const recording = context.connections;
  const store = context.stores.connections;
  if (!recording || !store) return;
  try {
    await writeConnectionActivity(context, { recording, store }, email, clientId);
  } catch {
    // Liveness is non-critical — never fail the grant on it. Nothing is logged
    // either: the only values here are an email and a client id.
  }
}

/** The write itself, once the recording ports are known to exist. */
async function writeConnectionActivity(
  context: McpOauthContext,
  ports: { recording: McpConnectionRecording; store: McpConnectionStore },
  email: string,
  clientId: string,
): Promise<void> {
  const { recording, store } = ports;
  const [userId, client] = await Promise.all([
    recording.resolveUserId(email),
    context.stores.clients.findByClientId(clientId),
  ]);
  // No user row yet: email is the identity the AS binds to, so the grant stands
  // and there is simply nothing to attribute it to.
  if (!userId) return;

  const throttleMs = recording.activityThrottleMs ?? DEFAULT_ACTIVITY_THROTTLE_MS;
  const lastActiveAt = await store.lastActiveAt(userId, clientId);
  const now = new Date();
  if (lastActiveAt && now.getTime() - lastActiveAt.getTime() < throttleMs) return;

  await store.recordActivity({
    userId,
    oauthClientId: clientId,
    clientName: client?.clientName ?? null,
    // Attribute to a provider from the client's redirect URIs (claude.ai →
    // claude, chatgpt.com → chatgpt) so an account page lights the right card.
    host: client ? providerFromRedirectUris(client.redirectUris, recording.providerRules) : null,
    at: now,
  });
}

/** The presented `authorization_code` grant parameters, once validated present. */
interface AuthorizationCodeParams {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}

/**
 * Read + presence-check the `authorization_code` form parameters. Returns the three
 * required values, or an `invalid_request` (400) naming the first missing field.
 */
function readAuthorizationCodeParams(form: URLSearchParams): AuthorizationCodeParams | Response {
  const code = form.get("code");
  const redirectUri = form.get("redirect_uri");
  const codeVerifier = form.get("code_verifier");

  if (!code) return tokenError("invalid_request", 400, "missing code");
  if (!redirectUri) return tokenError("invalid_request", 400, "missing redirect_uri");
  if (!codeVerifier) return tokenError("invalid_request", 400, "missing code_verifier");

  return { code, redirectUri, codeVerifier };
}

/**
 * Redeem a presented code, or refuse.
 *
 * The ORDER is the security contract, and it is the order the origin host established:
 * verify the code's signature, authenticate the presenting client against the
 * client the code was bound to, check the bound `redirect_uri`, check PKCE — and
 * only THEN consume the single-use `jti`. Consuming earlier would let a failed
 * attempt (a wrong secret, a mismatched verifier) burn a legitimate code.
 */
async function redeemCode(
  context: McpOauthContext,
  params: AuthorizationCodeParams,
  credentials: ClientCredentials,
  origin: string,
): Promise<Awaited<ReturnType<typeof verifyCode>> | Response> {
  const { code, redirectUri, codeVerifier } = params;

  // Every code-level failure (expired, tampered, wrong-audience) is invalid_grant.
  let verified;
  try {
    verified = await verifyCode(context.signingKey, code, { origin });
  } catch (error) {
    if (error instanceof AuthorizationCodeError) {
      return tokenError("invalid_grant", 400, "invalid or expired authorization code");
    }
    throw error;
  }

  const authError = await authenticateClient(
    context.stores.clients,
    credentials,
    verified.clientId,
  );
  if (authError) return authError;

  // The redirect_uri MUST match the one the code was bound to (RFC 6749 §4.1.3).
  if (redirectUri !== verified.redirectUri) {
    return tokenError("invalid_grant", 400, "redirect_uri mismatch");
  }

  // PKCE: the presented verifier must S256-match the bound challenge.
  if (!(await verifyChallenge(codeVerifier, verified.codeChallenge))) {
    return tokenError("invalid_grant", 400, "PKCE verification failed");
  }

  // Single-use: consume the code's jti; a replay of the same code fails.
  if (!(await context.codeReplay.consume(verified.jti, Date.now()))) {
    return tokenError("invalid_grant", 400, "authorization code already used");
  }

  return verified;
}

/** Handle the `authorization_code` grant. */
async function handleAuthorizationCode(
  context: McpOauthContext,
  form: URLSearchParams,
  credentials: ClientCredentials,
  origin: string,
): Promise<Response> {
  const params = readAuthorizationCodeParams(form);
  if (params instanceof Response) return params;

  const verified = await redeemCode(context, params, credentials, origin);
  if (verified instanceof Response) return verified;

  const scopes = verified.scope.split(/\s+/).filter(Boolean);

  const accessToken = await signAccessToken(context.signingKey, {
    email: verified.email,
    subject: verified.sub,
    scopes,
    origin,
    resourcePath: context.resourcePath,
    ttlSeconds: context.accessTokenTtlSeconds,
  });
  if (!accessToken) {
    // No signing key configured while the surface is on — refuse rather than fall
    // back to a weaker mode (safe-by-default).
    return tokenError("invalid_request", 400, "token issuance unavailable");
  }

  const refresh = await issueRefreshToken(
    { store: context.stores.refreshTokens, ttlMs: context.refreshTokenTtlMs },
    {
      userEmail: verified.email,
      userSub: verified.sub,
      clientId: verified.clientId,
      scopes,
    },
  );

  await recordHostConnection(context, verified.email, verified.clientId);

  return tokenSuccess({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: context.accessTokenTtlSeconds ?? ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refresh.refreshToken,
    scope: refresh.scopes.join(" "),
  });
}

/** Handle the `refresh_token` grant. */
async function handleRefreshToken(
  context: McpOauthContext,
  form: URLSearchParams,
  credentials: ClientCredentials,
  origin: string,
): Promise<Response> {
  const refreshToken = form.get("refresh_token");
  const requestedScope = form.get("scope");

  if (!refreshToken) return tokenError("invalid_request", 400, "missing refresh_token");

  // Authenticate the presenting client (public: client_id present; confidential:
  // secret checked). `authenticateClient` rejects a missing client_id, so on
  // success `credentials.clientId` is non-null and is the identity the rotation is
  // bound to below.
  const authError = await authenticateClient(context.stores.clients, credentials);
  if (authError) return authError;
  const clientId = credentials.clientId as string;

  const newScopes = requestedScope ? requestedScope.split(/\s+/).filter(Boolean) : undefined;
  const refreshContext = {
    store: context.stores.refreshTokens,
    ttlMs: context.refreshTokenTtlMs,
  };

  // Rotation enforces client binding (the token's stored clientId must equal the
  // authenticated one, else invalid_grant — OAuth 2.1 §4.3), plus
  // replay-revocation and scope-narrowing.
  let rotated;
  try {
    rotated = await rotateRefreshToken(refreshContext, refreshToken, clientId, newScopes);
  } catch (error) {
    if (error instanceof RefreshTokenError) {
      return tokenError(error.code, 400, error.message);
    }
    throw error;
  }

  // The refresh token binds the user's email AND original OAuth `sub`; recover both
  // so the successor access token carries the SAME stable `sub` as the initial
  // token (RFC 6749 §5.1 / OIDC §2), not the email.
  const identity = await getRefreshTokenIdentity(refreshContext, rotated.refreshToken);
  if (!identity) return tokenError("invalid_grant", 400, "refresh token binding not found");

  const accessToken = await signAccessToken(context.signingKey, {
    email: identity.userEmail,
    subject: identity.userSub,
    scopes: rotated.scopes,
    origin,
    resourcePath: context.resourcePath,
    ttlSeconds: context.accessTokenTtlSeconds,
  });
  if (!accessToken) return tokenError("invalid_request", 400, "token issuance unavailable");

  await recordHostConnection(context, identity.userEmail, clientId);

  return tokenSuccess({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: context.accessTokenTtlSeconds ?? ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: rotated.refreshToken,
    scope: rotated.scopes.join(" "),
  });
}

/**
 * `POST <token>` — the endpoint itself: gate → parse form → dispatch by
 * `grant_type`. Thin on purpose; the flows above are where the invariants live.
 */
export async function tokenEndpoint(
  context: McpOauthContext,
  request: Request,
): Promise<Response> {
  const origin = context.originOf(request);

  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await request.text());
  } catch {
    return tokenError("invalid_request", 400, "malformed request body");
  }

  const grantType = form.get("grant_type");
  if (!grantType) return tokenError("invalid_request", 400, "missing grant_type");

  const credentials = readClientCredentials(request, form);

  switch (grantType) {
    case "authorization_code":
      return handleAuthorizationCode(context, form, credentials, origin);
    case "refresh_token":
      return handleRefreshToken(context, form, credentials, origin);
    default:
      return tokenError(
        "unsupported_grant_type",
        400,
        `grant_type '${grantType}' is not supported`,
      );
  }
}
