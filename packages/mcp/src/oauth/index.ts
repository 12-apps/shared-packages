/**
 * `@12-apps/mcp/oauth` — the OAuth 2.1 authorization server behind an MCP surface
 * (12-23): register / authorize / token, the JWKS, and the two `.well-known`
 * discovery documents, plus the primitives under them (stateless codes, ES256
 * access tokens, PKCE, hashed rotating refresh tokens with replay revocation).
 *
 * Its own subpath because this half is Node-only — `jose`, `node:crypto` — and the
 * package root is also imported by browsers through `@12-apps/mcp/react`. A barrel
 * is evaluated whole by Node's ESM loader, so mixing the two would drag key
 * material handling into a bundle that has no business with it.
 */
export {
  createApiMcpOauth,
  type ApiMcpOauth,
  type McpOauthHandlers,
  type McpOauthRoute,
} from "./create-api-mcp-oauth";
export {
  DEFAULT_OAUTH_PATHS,
  resolveMcpOauthConfig,
  type McpConnectionRecording,
  type McpOauthConfig,
  type McpOauthContext,
  type McpOauthPaths,
  type McpOauthSession,
} from "./context";
export {
  DEFAULT_MCP_RESOURCE_PATH,
  MCP_SUPPORTED_SCOPES,
  issuer,
  originFromRequest,
  resolveTrustedOrigin,
  resourceAudience,
  trustedOriginsFromEnv,
  type McpScope,
} from "./config";
export {
  ACCESS_TOKEN_TTL_SECONDS,
  AccessTokenError,
  signAccessToken,
  verifyAccessToken,
  type AccessTokenErrorCode,
  type SignAccessTokenInput,
  type VerifiedAccessToken,
  type VerifyAccessTokenOptions,
} from "./access-token";
export {
  AUTHORIZATION_CODE_AUDIENCE,
  AUTHORIZATION_CODE_TTL_SECONDS,
  AuthorizationCodeError,
  mintCode,
  verifyCode,
  type AuthorizationCodeErrorCode,
  type MintCodeInput,
  type VerifiedAuthorizationCode,
  type VerifyCodeOptions,
} from "./authorization-code";
export {
  SUPPORTED_CHALLENGE_METHOD,
  UnsupportedChallengeMethodError,
  computeChallenge,
  verifyChallenge,
  type CodeChallengeMethod,
} from "./pkce";
export {
  DEFAULT_SIGNING_KEY_ENV,
  DEFAULT_SIGNING_KEY_ID_ENV,
  SIGNING_ALG,
  loadSigningKeyFromEnv,
  signingKeyProvider,
  type McpSigningKey,
  type McpSigningKeyProvider,
  type PublicSigningJwk,
} from "./keys";
export {
  DEFAULT_PROVIDER_ROOTS,
  hashSecret,
  matchesRedirectUri,
  providerFromRedirectUris,
  registerClient,
  type ProviderAttributionRule,
  type RegisterClientInput,
  type RegisteredClient,
} from "./clients";
export {
  REFRESH_TOKEN_TTL_MS,
  RefreshTokenError,
  getRefreshTokenIdentity,
  hashToken,
  issueRefreshToken,
  rotateRefreshToken,
  type IssuedRefreshToken,
  type RefreshTokenContext,
  type RefreshTokenErrorCode,
  type RefreshTokenIdentity,
} from "./refresh";
export {
  inProcessCodeReplayStore,
  type CodeReplayStore,
} from "./code-replay";
export {
  createPrismaMcpStores,
  type McpOauthPrisma,
  type McpOauthPrismaProvider,
} from "./prisma-stores";
export type {
  McpConnectionStore,
  McpOauthStores,
  NewOAuthClient,
  NewRefreshToken,
  OAuthClientStore,
  RefreshTokenStore,
  StoredMcpConnection,
  StoredOAuthClient,
  StoredRefreshToken,
  TokenEndpointAuthMethod,
} from "./stores";
