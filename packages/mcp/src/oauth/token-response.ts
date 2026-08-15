import { createHash, timingSafeEqual } from "node:crypto";

import type { OAuthClientStore } from "./stores";

/**
 * The token endpoint's wire helpers: the RFC 6749 §5.1/§5.2 bodies and client
 * authentication (12-23, split out of the grant handlers so each file stays under
 * the size gate — the same split the origin host made).
 *
 * These bodies are NOT the house `{ data }` envelope, deliberately: they are read
 * by OAuth clients that expect the RFC shapes at the top level, and `Cache-Control:
 * no-store` is required on every one of them because they carry credentials.
 */

/** OAuth 2.1 / RFC 6749 §5.2 error codes the token endpoint can emit. */
type TokenErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "invalid_scope"
  | "unsupported_grant_type";

/** The RFC 6749 §5.1 successful token response. */
interface TokenSuccessResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
} as const;

/** A JSON error response in the RFC 6749 §5.2 shape. */
export function tokenError(
  error: TokenErrorCode,
  status: number,
  description?: string,
  headers: Record<string, string> = {},
): Response {
  const body: { error: TokenErrorCode; error_description?: string } = { error };
  if (description) body.error_description = description;
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

/** A JSON success response with `Cache-Control: no-store` (RFC 6749 §5.1). */
export function tokenSuccess(payload: TokenSuccessResponse): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { ...JSON_HEADERS } });
}

/** Constant-time equality of two SHA-256 hex digests. */
function hashesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

/** SHA-256 hex digest — matches the at-rest client-secret hashing convention. */
function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Client credentials extracted from HTTP Basic auth or the form body. */
export interface ClientCredentials {
  clientId: string | null;
  clientSecret: string | null;
}

/**
 * Resolve the presented client credentials. HTTP Basic (`client_secret_basic`)
 * takes precedence over the form-body `client_id` per RFC 6749 §2.3.1; a malformed
 * Basic header is treated as absent (the form body still applies).
 */
export function readClientCredentials(
  request: Request,
  form: URLSearchParams,
): ClientCredentials {
  const authorization = request.headers.get("authorization");
  if (authorization && authorization.startsWith("Basic ")) {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator !== -1) {
      return {
        clientId: decoded.slice(0, separator),
        clientSecret: decoded.slice(separator + 1),
      };
    }
  }
  return { clientId: form.get("client_id"), clientSecret: form.get("client_secret") };
}

/** The 401 challenge issued on a client-authentication failure. */
const CLIENT_AUTH_CHALLENGE = { "www-authenticate": 'Basic realm="oauth-token"' };

/**
 * Authenticate the client that presents the request. A public client is identified
 * by `client_id` alone (which must equal `expectedClientId` when provided). A
 * confidential client (`client_secret_basic`) MUST present a secret whose SHA-256
 * matches the stored hash. Returns `null` on success, or a 401 `invalid_client`
 * response on failure — never a body that says which half was wrong.
 */
export async function authenticateClient(
  clients: OAuthClientStore,
  credentials: ClientCredentials,
  expectedClientId?: string,
): Promise<Response | null> {
  const clientId = credentials.clientId;
  if (!clientId) {
    return tokenError("invalid_client", 401, "missing client_id", CLIENT_AUTH_CHALLENGE);
  }
  if (expectedClientId && clientId !== expectedClientId) {
    // The presenting client does not match the client the code was issued to.
    return tokenError(
      "invalid_client",
      401,
      "client_id does not match the grant",
      CLIENT_AUTH_CHALLENGE,
    );
  }

  const client = await clients.findByClientId(clientId);
  if (!client) {
    return tokenError("invalid_client", 401, "unknown client", CLIENT_AUTH_CHALLENGE);
  }

  if (client.tokenEndpointAuthMethod === "client_secret_basic") {
    const secret = credentials.clientSecret;
    if (!secret || !client.clientSecretHash) {
      return tokenError(
        "invalid_client",
        401,
        "client authentication required",
        CLIENT_AUTH_CHALLENGE,
      );
    }
    if (!hashesEqual(sha256Hex(secret), client.clientSecretHash)) {
      return tokenError(
        "invalid_client",
        401,
        "invalid client credentials",
        CLIENT_AUTH_CHALLENGE,
      );
    }
  }

  return null;
}
