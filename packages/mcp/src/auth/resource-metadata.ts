/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728), as required by the MCP
 * authorization spec: the MCP endpoint is an OAuth *resource server*. Agent hosts
 * (Claude.ai / ChatGPT connectors) discover where to obtain a token by reading
 * `/.well-known/oauth-protected-resource`, and on a 401 the resource server points
 * them at that document via a `WWW-Authenticate` challenge.
 *
 * This module only builds the discovery documents/headers — validating the
 * resulting access token is the app's job (the {@link import("../types").AuthResolver}),
 * because it depends on the app's authorization server and key material.
 */

export interface ProtectedResourceMetadataInput {
  /** Canonical resource identifier — the MCP endpoint URL (the token audience). */
  resource: string;
  /** Authorization server issuer URLs that can mint tokens for this resource. */
  authorizationServers: string[];
  /** Scopes the resource server understands (advertised to clients). */
  scopesSupported?: string[];
  /** Human-facing docs URL for the protected resource, if any. */
  resourceDocumentation?: string;
}

/** The RFC 9728 metadata document served at `/.well-known/oauth-protected-resource`. */
export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: string[];
  scopes_supported?: string[];
  resource_documentation?: string;
}

export function buildProtectedResourceMetadata(
  input: ProtectedResourceMetadataInput,
): ProtectedResourceMetadata {
  return {
    resource: input.resource,
    authorization_servers: input.authorizationServers,
    // MCP clients present the token in the Authorization header only.
    bearer_methods_supported: ["header"],
    ...(input.scopesSupported ? { scopes_supported: input.scopesSupported } : {}),
    ...(input.resourceDocumentation
      ? { resource_documentation: input.resourceDocumentation }
      : {}),
  };
}

/**
 * Build the `WWW-Authenticate` value for an unauthorized MCP response, pointing
 * the client at the protected-resource metadata so it can start the OAuth flow.
 * Per RFC 9728 §5.1 the challenge carries a `resource_metadata` parameter.
 */
export function bearerChallenge(params: {
  resourceMetadataUrl: string;
  error?: "invalid_token" | "insufficient_scope";
  errorDescription?: string;
}): string {
  const parts = [`Bearer resource_metadata="${params.resourceMetadataUrl}"`];
  if (params.error) parts.push(`error="${params.error}"`);
  if (params.errorDescription) {
    parts.push(`error_description="${params.errorDescription}"`);
  }
  return parts.join(", ");
}

/** Standard path for the protected-resource metadata document. */
export const PROTECTED_RESOURCE_METADATA_PATH =
  "/.well-known/oauth-protected-resource";
