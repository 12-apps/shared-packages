/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414), the discovery half that
 * complements the RFC 9728 protected-resource metadata in `resource-metadata.ts`.
 * Agent hosts (Claude.ai / ChatGPT connectors) read
 * `/.well-known/oauth-authorization-server` to learn where to start the OAuth
 * 2.1 Authorization Code + PKCE flow.
 *
 * This builder is a pure function of `(issuer, scopes)` with no Next.js/request
 * coupling, so it can move verbatim into the future `@12-apps/mcp` extraction.
 * It derives every endpoint from the same issuer origin the resource metadata
 * advertises, so the two discovery documents cannot drift.
 */

export interface AuthorizationServerMetadataInput {
  /** Authorization server issuer URL (origin) — also the resource issuer. */
  issuer: string;
  /** Scopes the authorization server advertises (from the shared scope source). */
  scopesSupported: string[];
  /**
   * Client authentication methods the token endpoint accepts. Defaults to
   * public PKCE clients (`none`) plus HTTP Basic client-secret auth.
   */
  tokenEndpointAuthMethods?: string[];
}

/** The RFC 8414 document served at `/.well-known/oauth-authorization-server`. */
export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  jwks_uri: string;
  scopes_supported: string[];
  response_types_supported: string[];
  grant_types_supported: string[];
  code_challenge_methods_supported: string[];
  token_endpoint_auth_methods_supported: string[];
}

const AUTHORIZE_PATH = "/api/oauth/authorize";
const TOKEN_PATH = "/api/oauth/token";
const REGISTRATION_PATH = "/api/oauth/register";
const JWKS_PATH = "/.well-known/jwks.json";

const DEFAULT_TOKEN_ENDPOINT_AUTH_METHODS = [
  "none",
  "client_secret_basic",
] as const;

/**
 * Build the RFC 8414 authorization-server metadata document from an issuer
 * origin and the supported scopes. Endpoints are derived from `issuer`; the
 * OAuth 2.1 + PKCE contract fixes `response_types_supported`,
 * `grant_types_supported`, and `code_challenge_methods_supported`.
 */
export function buildAuthorizationServerMetadata(
  input: AuthorizationServerMetadataInput,
): AuthorizationServerMetadata {
  const origin = input.issuer;
  return {
    issuer: origin,
    authorization_endpoint: `${origin}${AUTHORIZE_PATH}`,
    token_endpoint: `${origin}${TOKEN_PATH}`,
    registration_endpoint: `${origin}${REGISTRATION_PATH}`,
    jwks_uri: `${origin}${JWKS_PATH}`,
    scopes_supported: input.scopesSupported,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported:
      input.tokenEndpointAuthMethods ?? [...DEFAULT_TOKEN_ENDPOINT_AUTH_METHODS],
  };
}
