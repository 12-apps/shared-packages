import { exportJWK, importPKCS8, type CryptoKey, type JWK } from "jose";

/**
 * Signing-key / JWK loading for the OAuth authorization server (12-23, ported
 * from the origin host's `lib/mcp/oauth/keys.ts`).
 *
 * ES256 (P-256) from PEM material, the published public JWK (with `kid` for
 * rotation), and a safe-by-default absence signal (`null`) when no key is
 * configured — callers then refuse to issue tokens and serve the JWKS as 503
 * rather than falling back to a weaker mode while the surface is mounted.
 *
 * WHERE the PEM comes from is the host's business: `loadSigningKeyFromEnv` keeps
 * the origin host's env-var wiring, and any other provider (a secrets manager, a KMS
 * export) satisfies the same `McpSigningKeyProvider` shape.
 */

/** JWS algorithm for the signing key pair (asymmetric, self-validated via JWKS). */
export const SIGNING_ALG = "ES256";

/** A public JWK safe to publish at the JWKS endpoint (never carries `d`). */
export interface PublicSigningJwk extends JWK {
  kid: string;
  kty: "EC";
  crv: "P-256";
  alg: typeof SIGNING_ALG;
  use: "sig";
}

/** The loaded signing material: the private key for signing + its public JWK. */
export interface McpSigningKey {
  privateKey: CryptoKey;
  publicJwk: PublicSigningJwk;
  kid: string;
}

/**
 * How the surface obtains signing material. Returning `null` means "not
 * provisioned": the AS then mints nothing and the JWKS answers 503.
 */
export type McpSigningKeyProvider = () => Promise<McpSigningKey | null>;

async function parseSigningKey(pem: string, kid: string): Promise<McpSigningKey> {
  // `extractable: true` is required so `exportJWK` can derive the public JWK;
  // jose imports keys as non-extractable by default, which blocks the export.
  const privateKey = await importPKCS8(pem, SIGNING_ALG, { extractable: true });
  const jwk = await exportJWK(privateKey);
  // Strip the private component; publish only the public half.
  const { d: _private, ...publicHalf } = jwk;
  void _private;

  const publicJwk: PublicSigningJwk = {
    ...publicHalf,
    kty: "EC",
    crv: "P-256",
    alg: SIGNING_ALG,
    use: "sig",
    kid,
  };

  return { privateKey, publicJwk, kid };
}

/**
 * Build a provider over a PKCS#8 PEM + `kid` pair, with a per-process cache.
 *
 * Parsing PKCS#8 and exporting the JWK is pure for a given (pem, kid), so the
 * promise is cached keyed on the material itself. A rotated key (different pem or
 * kid) produces a different cache key and re-parses — the cache never masks a
 * rotation.
 *
 * Rotation is BY `kid`: each key is published in the JWKS and selected by the
 * `kid` header on issued JWTs, so publishing old + new during an overlap window
 * lets both verify.
 */
export function signingKeyProvider(
  read: () => { pem: string | undefined; kid: string | undefined },
): McpSigningKeyProvider {
  let cache: { key: string; promise: Promise<McpSigningKey> } | null = null;
  return async () => {
    const { pem, kid } = read();
    if (!pem || !kid) return null;
    const cacheKey = `${kid} ${pem}`;
    if (cache?.key === cacheKey) return cache.promise;
    const promise = parseSigningKey(pem, kid);
    cache = { key: cacheKey, promise };
    return promise;
  };
}

/** Env var carrying the ES256 private key as a PKCS#8 PEM (the origin host's name). */
export const DEFAULT_SIGNING_KEY_ENV = "MCP_OAUTH_SIGNING_KEY";
/** Env var carrying the key id (`kid`) used to select the key during rotation. */
export const DEFAULT_SIGNING_KEY_ID_ENV = "MCP_OAUTH_SIGNING_KEY_ID";

/**
 * The env-backed provider — the origin host's wiring, kept identical, with the
 * variable names as arguments so the package states no host's vocabulary.
 */
export function loadSigningKeyFromEnv(
  keyEnv: string = DEFAULT_SIGNING_KEY_ENV,
  kidEnv: string = DEFAULT_SIGNING_KEY_ID_ENV,
): McpSigningKeyProvider {
  return signingKeyProvider(() => ({
    pem: typeof process === "undefined" ? undefined : process.env?.[keyEnv],
    kid: typeof process === "undefined" ? undefined : process.env?.[kidEnv],
  }));
}
