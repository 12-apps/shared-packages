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

/** A typed verification failure — `code` drives the `WWW-Authenticate` challenge. */
export class AccessTokenError extends Error {
  readonly code: AccessTokenErrorCode;

  constructor(code: AccessTokenErrorCode, message?: string) {
    super(message ?? code);
    this.name = "AccessTokenError";
    this.code = code;
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
/**
 * The cryptographic half: signature, `iss`, `aud`, `exp`.
 *
 * Every jose failure — bad signature, wrong issuer, wrong audience, expiry,
 * malformed token, unknown key — collapses into ONE opaque `invalid_token`. A
 * message naming the failed claim would be an oracle for the next attempt.
 */
async function verifiedPayload(
  loadSigningKey: McpSigningKeyProvider,
  token: string,
  options: VerifyAccessTokenOptions,
): Promise<JWTPayload> {
  const key = await loadSigningKey();
  // No signing key configured → nothing can verify (safe-by-default).
  if (!key) throw new AccessTokenError("invalid_token", "no signing key configured");

  try {
    const { payload } = await jwtVerify(token, await importJWK(key.publicJwk, SIGNING_ALG), {
      algorithms: [SIGNING_ALG],
      issuer: issuer(options.origin),
      audience: resourceAudience(options.origin, options.resourcePath ?? DEFAULT_MCP_RESOURCE_PATH),
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      currentDate: options.now === undefined ? undefined : new Date(options.now),
    });
    return payload;
  } catch {
    throw new AccessTokenError("invalid_token", "token verification failed");
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
    throw new AccessTokenError("invalid_token", "missing subject or email claim");
  }

  const scopes = parseScopes(payload.scope);
  if (options.requiredScope && !scopes.includes(options.requiredScope)) {
    throw new AccessTokenError(
      "insufficient_scope",
      `token lacks required scope '${options.requiredScope}'`,
    );
  }

  return { email, subject, scopes };
}
