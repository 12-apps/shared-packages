import { SignJWT, jwtVerify, importJWK, type JWTPayload } from "jose";

import { issuer } from "./config";
import { SIGNING_ALG, type McpSigningKeyProvider } from "./keys";

/**
 * Stateless authorization-code mint/verify (12-23, ported from the origin host's
 * `lib/mcp/oauth/authorization-code.ts` — behaviour unchanged; the signing key
 * arrives through a provider instead of an env read).
 *
 * The authorization code is a short-lived (<=60s) ES256-signed JWT — no DB table,
 * no cleanup job. It binds the signed-in user (`sub`/`email`), the `client_id`,
 * the `redirect_uri`, the PKCE `code_challenge`, and the requested `scope`, plus a
 * unique `jti` the token endpoint records once to enforce single-use (replay)
 * semantics on top of the short expiry.
 *
 * The code carries a DISTINCT audience (`oauth:code`) from the access token
 * (`${origin}/api/mcp`), so a code can never be presented to the resource server
 * as a bearer access token (and vice versa): {@link verifyCode} pins
 * `audience: "oauth:code"`, and the access-token verifier pins the resource
 * audience — each rejects the other's blobs.
 */

/**
 * Audience pinning the code to the OAuth code-exchange step only. Distinct from
 * the access-token audience so a code cannot be replayed as an access token.
 */
export const AUTHORIZATION_CODE_AUDIENCE = "oauth:code";

/** Authorization-code lifetime — single-use and short-lived (<=60s per spec). */
export const AUTHORIZATION_CODE_TTL_SECONDS = 60;

/** Clock skew tolerated on `exp`/`iat` validation, in seconds. */
const CLOCK_TOLERANCE_SECONDS = 5;

/** Fields bound into a minted authorization code. */
export interface MintCodeInput {
  /** The OAuth subject bound to the code (identity from the cookie session). */
  sub: string;
  /** The signed-in user's email (the identity all downstream tokens bind to). */
  email: string;
  /** The OAuth client the code is issued to. */
  clientId: string;
  /** The exact registered redirect URI the flow started with. */
  redirectUri: string;
  /** The PKCE S256 `code_challenge` the token endpoint verifies against. */
  codeChallenge: string;
  /** The requested scope (space-delimited), carried through to the token. */
  scope: string;
  /** The deployment origin — derives the code's `iss`. */
  origin: string;
}

/** The bound fields a verified authorization code resolves to. */
export interface VerifiedAuthorizationCode {
  sub: string;
  email: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  /** The one-time identifier the token endpoint records to enforce single-use. */
  jti: string;
}

/** The single failure discriminator for the OAuth token endpoint. */
export type AuthorizationCodeErrorCode = "invalid_grant";

/**
 * A typed authorization-code failure. Every rejection (expired, wrong-audience,
 * wrong-issuer, tampered, bad-signature, unconfigured key) surfaces as
 * `invalid_grant` per RFC 6749 §5.2 for the token endpoint.
 */
export class AuthorizationCodeError extends Error {
  readonly code: AuthorizationCodeErrorCode;

  constructor(message?: string) {
    super(message ?? "invalid_grant");
    this.name = "AuthorizationCodeError";
    this.code = "invalid_grant";
  }
}

/** Deterministic-clock option shared by mint + verify. */
interface ClockOption {
  /** Epoch milliseconds; defaults to `Date.now()`. Injected for deterministic tests. */
  now?: number;
}

/** The JWT claim shape of an authorization code. */
interface AuthorizationCodeClaims extends JWTPayload {
  email: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string;
}

function nowSeconds(now?: number): number {
  return Math.floor((now ?? Date.now()) / 1000);
}

/** Read a required string claim, or `null` when absent/wrong-typed. */
function stringClaim(payload: JWTPayload, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" ? value : null;
}

/**
 * Extract the bound fields from an already-signature/iss/aud/exp-validated code
 * payload, enforcing that every required claim is a present string (`scope` may be
 * the empty string but must be present). Throws {@link AuthorizationCodeError}
 * when any required bound field is missing or wrong-typed.
 */
function extractBoundFields(payload: JWTPayload): VerifiedAuthorizationCode {
  const sub = stringClaim(payload, "sub");
  const email = stringClaim(payload, "email");
  const clientId = stringClaim(payload, "client_id");
  const redirectUri = stringClaim(payload, "redirect_uri");
  const codeChallenge = stringClaim(payload, "code_challenge");
  const scope = stringClaim(payload, "scope");
  const jti = stringClaim(payload, "jti");

  if (!sub || !email || !clientId || !redirectUri || !codeChallenge || scope === null || !jti) {
    throw new AuthorizationCodeError("code is missing required bound fields");
  }

  return { sub, email, clientId, redirectUri, codeChallenge, scope, jti };
}

/**
 * Mint a single-use, stateless authorization code bound to the flow inputs.
 *
 * Returns `null` when no signing key is configured (safe-by-default: the AS
 * refuses to issue rather than falling back to a weaker mode). Sets the `kid`
 * header so the same key resolves the code at verify time.
 */
export async function mintCode(
  loadSigningKey: McpSigningKeyProvider,
  input: MintCodeInput,
  options?: ClockOption,
): Promise<string | null> {
  const key = await loadSigningKey();
  if (!key) return null;

  const iat = nowSeconds(options?.now);
  const exp = iat + AUTHORIZATION_CODE_TTL_SECONDS;

  const claims: AuthorizationCodeClaims = {
    email: input.email,
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    code_challenge: input.codeChallenge,
    scope: input.scope,
  };

  return new SignJWT(claims)
    .setProtectedHeader({ alg: SIGNING_ALG, kid: key.kid })
    .setIssuer(issuer(input.origin))
    .setAudience(AUTHORIZATION_CODE_AUDIENCE)
    .setSubject(input.sub)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .setJti(crypto.randomUUID())
    .sign(key.privateKey);
}

/** Options for {@link verifyCode}. */
export interface VerifyCodeOptions extends ClockOption {
  /** The deployment origin — derives the expected `iss`. */
  origin: string;
}

/**
 * Verify a stateless authorization code and return its bound fields.
 *
 * Validates signature (via the public JWK selected by `kid`), `iss`, the
 * `oauth:code` audience, and `exp`. Every failure — expired, wrong-audience (e.g.
 * an access token), wrong-issuer, tampered, bad-signature, or no configured key —
 * throws an {@link AuthorizationCodeError} (`invalid_grant`).
 *
 * The returned `jti` is the one-time identifier the token endpoint records to
 * enforce single-use on top of the short expiry (replay guard).
 */
export async function verifyCode(
  loadSigningKey: McpSigningKeyProvider,
  code: string,
  options: VerifyCodeOptions,
): Promise<VerifiedAuthorizationCode> {
  const key = await loadSigningKey();
  if (!key) {
    // No signing key configured → nothing can verify (safe-by-default).
    throw new AuthorizationCodeError("no signing key configured");
  }

  const publicKey = await importJWK(key.publicJwk, SIGNING_ALG);

  let payload: JWTPayload;
  try {
    const result = await jwtVerify(code, publicKey, {
      algorithms: [SIGNING_ALG],
      issuer: issuer(options.origin),
      audience: AUTHORIZATION_CODE_AUDIENCE,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      currentDate: options.now === undefined ? undefined : new Date(options.now),
    });
    payload = result.payload;
  } catch {
    // jose throws on bad signature, wrong iss/aud, expiry, malformed token,
    // unknown key — all map to a single opaque `invalid_grant`.
    throw new AuthorizationCodeError("code verification failed");
  }

  return extractBoundFields(payload);
}
