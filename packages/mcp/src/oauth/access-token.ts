import { SignJWT, jwtVerify, importJWK, type JWTPayload } from "jose";

import { issuer, resourceAudience, DEFAULT_MCP_RESOURCE_PATH, type McpScope } from "./config";
import { SIGNING_ALG, type McpSigningKeyProvider } from "./keys";

/**
 * JWT access-token issuer + verifier (12-23, ported from the origin host's
 * `lib/mcp/oauth/jwt.ts` — behaviour unchanged; the signing key arrives through a
 * provider and the resource path is config).
 *
 * The access token is a short-lived, ES256-signed JWT bound to the signed-in
 * user. It carries the claims the resource server checks LOCALLY against the
 * published JWKS (no introspection round-trip): `iss` (the issuer origin), `aud`
 * (`${origin}${resourcePath}`), `sub`, `email`, `scope` (space-delimited), `iat`,
 * `exp` (short TTL), and `jti`; the JWT header carries `kid` so the verifier can
 * select the public key during rotation.
 *
 * Failures are typed so the caller maps them to the right OAuth challenge
 * (`invalid_token` vs `insufficient_scope`).
 */

/** Access-token lifetime — short-lived (15 min) per the spec. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/** Clock skew tolerated on `exp`/`iat` validation, in seconds. */
const CLOCK_TOLERANCE_SECONDS = 5;

/** The identity a verified access token resolves to. */
export interface VerifiedAccessToken {
  email: string;
  subject: string;
  scopes: string[];
}

/** Distinct verification failure reasons the caller maps to OAuth challenges. */
export type AccessTokenErrorCode = "invalid_token" | "insufficient_scope";

/**
 * WHY verification failed, at the granularity an operator and an agent can act on.
 *
 * `code` above is the RFC 6750 challenge and there are only three of those, so it
 * cannot tell "your connection lapsed, refresh it" from "this token is not for
 * this server". That distinction is the whole difference between an assistant
 * that tells its user to reconnect this server and one that reports a generic
 * failure on every tool call, so it is carried alongside rather than folded
 * into `code`.
 *
 * `unverified` stays deliberately COARSE. Signature, issuer and audience collapse
 * into it because naming which one failed is an oracle for the next attempt.
 * Expiry is the documented exception — RFC 6750 names it in `error_description`
 * precisely because a client must be told to refresh — and it leaks nothing: a
 * token's `exp` is readable by whoever holds the token.
 */
export type AccessTokenFailureReason =
  /** Valid in every other respect, but `exp` has passed. Refresh, do not re-consent. */
  | "expired"
  /** Signature, issuer or audience did not hold. Deliberately not narrowed further. */
  | "unverified"
  /** Verified, but missing the `sub`/`email` the identity is built from. */
  | "incomplete"
  /** No signing key is provisioned, so nothing can verify. An operator problem. */
  | "not_provisioned"
  /** A valid token that simply lacks the scope this call needs. */
  | "insufficient_scope";

/**
 * A typed verification failure — `code` drives the `WWW-Authenticate` challenge,
 * {@link AccessTokenError.reason} drives what the caller is actually told.
 */
export class AccessTokenError extends Error {
  readonly code: AccessTokenErrorCode;

  readonly reason: AccessTokenFailureReason;

  constructor(code: AccessTokenErrorCode, reason: AccessTokenFailureReason, message?: string) {
    super(message ?? reason);
    this.name = "AccessTokenError";
    this.code = code;
    this.reason = reason;
  }
}

/** Inputs bound into a minted access token. */
export interface SignAccessTokenInput {
  email: string;
  subject: string;
  scopes: readonly McpScope[] | readonly string[];
  origin: string;
  /** Where the MCP resource is mounted. Default `/api/mcp`. */
  resourcePath?: string;
  /** Token lifetime in seconds. Default 15 minutes. */
  ttlSeconds?: number;
}

/** Deterministic-clock option shared by mint + verify. */
interface ClockOption {
  /** Epoch milliseconds; defaults to `Date.now()`. Injected for deterministic tests. */
  now?: number;
}

/** The full access-token claim set (beyond the registered JWT claims). */
interface AccessTokenClaims extends JWTPayload {
  email: string;
  scope: string;
}

function nowSeconds(now?: number): number {
  return Math.floor((now ?? Date.now()) / 1000);
}

/**
 * Mint an ES256-signed access token bound to the user.
 *
 * Returns `null` when no signing key is configured (safe-by-default: the AS
 * refuses to issue rather than falling back to a weaker mode). Sets the `kid`
 * header from the loaded key so the verifier can resolve the public JWK during
 * rotation.
 */
export async function signAccessToken(
  loadSigningKey: McpSigningKeyProvider,
  input: SignAccessTokenInput,
  options?: ClockOption,
): Promise<string | null> {
  const key = await loadSigningKey();
  if (!key) return null;

  const iat = nowSeconds(options?.now);
  const exp = iat + (input.ttlSeconds ?? ACCESS_TOKEN_TTL_SECONDS);
  const scope = input.scopes.join(" ");

  return new SignJWT({ email: input.email, scope } satisfies AccessTokenClaims)
    .setProtectedHeader({ alg: SIGNING_ALG, kid: key.kid })
    .setIssuer(issuer(input.origin))
    .setAudience(resourceAudience(input.origin, input.resourcePath ?? DEFAULT_MCP_RESOURCE_PATH))
    .setSubject(input.subject)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .setJti(crypto.randomUUID())
    .sign(key.privateKey);
}

/** Options for {@link verifyAccessToken}. */
export interface VerifyAccessTokenOptions extends ClockOption {
  /** The deployment origin — derives the expected `iss` and `aud`. */
  origin: string;
  /** Where the MCP resource is mounted. Default `/api/mcp`. */
  resourcePath?: string;
  /** When set, the token must carry this scope or verification fails `insufficient_scope`. */
  requiredScope?: McpScope | string;
}

/** Parse the space-delimited `scope` claim into a de-duplicated string array. */
function parseScopes(scope: unknown): string[] {
  if (typeof scope !== "string" || scope.trim() === "") return [];
  return [...new Set(scope.trim().split(/\s+/))];
}

/**
 * Verify a bearer access token locally against the published JWKS public key.
 *
 * Checks signature (via the public JWK selected by the token's `kid`), `iss`,
 * `aud`, and `exp`. When `requiredScope` is supplied, also enforces scope. On
 * success returns `{ email, subject, scopes }`; on failure throws an
 * {@link AccessTokenError} whose `code` distinguishes `invalid_token` (bad
 * signature / wrong issuer / wrong audience / expired / malformed / unconfigured
 * key) from `insufficient_scope` (a valid token lacking the required scope).
 */
/** jose's code for a token that parsed and verified but whose `exp` has passed. */
const JWT_EXPIRED_CODE = "ERR_JWT_EXPIRED";

/** Whether a thrown value is jose's expiry error, by its stable `code`. */
function isExpiry(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === JWT_EXPIRED_CODE
  );
}

/**
 * The cryptographic half: signature, `iss`, `aud`, `exp`.
 *
 * Bad signature, wrong issuer, wrong audience, malformed token and unknown key
 * all collapse into ONE opaque `unverified`. A message naming the failed claim
 * would be an oracle for the next attempt.
 *
 * EXPIRY is separated out, and only expiry. It is the one failure a
 * well-behaved client is supposed to act on — refresh and retry — and it is the
 * one the RFC gives a description for, so collapsing it left every lapsed
 * connection indistinguishable from a broken one. It is not an oracle either:
 * `exp` is a readable claim of a token the caller already holds.
 */
async function verifiedPayload(
  loadSigningKey: McpSigningKeyProvider,
  token: string,
  options: VerifyAccessTokenOptions,
): Promise<JWTPayload> {
  const key = await loadSigningKey();
  // No signing key configured → nothing can verify (safe-by-default).
  if (!key) {
    throw new AccessTokenError("invalid_token", "not_provisioned", "no signing key configured");
  }

  try {
    const { payload } = await jwtVerify(token, await importJWK(key.publicJwk, SIGNING_ALG), {
      algorithms: [SIGNING_ALG],
      issuer: issuer(options.origin),
      audience: resourceAudience(options.origin, options.resourcePath ?? DEFAULT_MCP_RESOURCE_PATH),
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      currentDate: options.now === undefined ? undefined : new Date(options.now),
    });
    return payload;
  } catch (error) {
    if (isExpiry(error)) {
      throw new AccessTokenError("invalid_token", "expired", "access token expired");
    }
    throw new AccessTokenError("invalid_token", "unverified", "token verification failed");
  }
}

export async function verifyAccessToken(
  loadSigningKey: McpSigningKeyProvider,
  token: string,
  options: VerifyAccessTokenOptions,
): Promise<VerifiedAccessToken> {
  const payload = await verifiedPayload(loadSigningKey, token, options);

  const email = typeof payload.email === "string" ? payload.email : null;
  const subject = typeof payload.sub === "string" ? payload.sub : null;
  if (!email || !subject) {
    throw new AccessTokenError(
      "invalid_token",
      "incomplete",
      "missing subject or email claim",
    );
  }

  const scopes = parseScopes(payload.scope);
  if (options.requiredScope && !scopes.includes(options.requiredScope)) {
    throw new AccessTokenError(
      "insufficient_scope",
      "insufficient_scope",
      `token lacks required scope '${options.requiredScope}'`,
    );
  }

  return { email, subject, scopes };
}
