/**
 * @12-apps/mcp — app-agnostic MCP server core.
 *
 * Turn an OpenAPI document into MCP tools (one per operation) and dispatch each
 * tool call by proxying to the endpoint with the caller's bearer token, so an
 * agent inherits exactly the user's permissions. The consuming app supplies the
 * spec, the base URL, and an AuthResolver, and binds the ToolRegistry to the MCP
 * transport (mounted at `/api/mcp`).
 */

export * from "./types";
// Shared AI-connect guide content (pure data, no React) — the single source of
// truth for BOTH the `@12-apps/mcp/react` onboarding UI and the server-side connect
// tools, so what an agent reads via MCP cannot drift from what owners see.
export {
  AI_HOST_GUIDES,
  AI_CAPABILITIES,
  AI_PERMISSION_MODEL,
  AI_CONNECT_PROMPT,
  providerForHostId,
  type AiHostBrand,
  type AiHostLink,
  type AiHostConfigureStage,
  type AiHostGuide,
  type AiProvider,
  type AiCapability,
} from "./guide";
export { generateTools } from "./openapi/generate";
export { inlineSchemaRefs, UnsupportedSchemaError } from "./openapi/refs";
export type {
  OpenApiDocument,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiRequestBody,
  OpenApiResponse,
} from "./openapi/generate";
export { dispatchTool, DispatchInputError } from "./dispatch/proxy";
export {
  createToolRegistry,
  HTTP_STATUS_META_KEY,
  type ToolRegistry,
  type RegistryOptions,
  type McpToolDescriptor,
  type McpToolResult,
} from "./server/registry";
export {
  buildManifest,
  serializeManifest,
  type BuildManifestOptions,
} from "./server/manifest";
// The advertised-version guard: a server whose `serverInfo.version` never moves
// gives a connected host no reason to re-read `tools/list`, so a shipped tool
// stays invisible to it. These let a consumer's generator make that bump a build
// error instead of a comment nobody reads — see `server/surface-lock.ts`.
export {
  serializeSurfaceLock,
  surfaceDigest,
  surfaceLockProblem,
  type SurfaceLock,
  type SurfaceLockCheck,
} from "./server/surface-lock";
// OAuth discovery — both halves of the MCP auth story kept together so the
// future `@12-apps/mcp` extraction inherits them as one surface:
// RFC 9728 protected-resource metadata + RFC 8414 authorization-server metadata.
export {
  buildProtectedResourceMetadata,
  bearerChallenge,
  PROTECTED_RESOURCE_METADATA_PATH,
  type ProtectedResourceMetadata,
  type ProtectedResourceMetadataInput,
} from "./auth/resource-metadata";
export {
  buildAuthorizationServerMetadata,
  type AuthorizationServerMetadata,
  type AuthorizationServerMetadataInput,
  type AuthorizationServerPaths,
} from "./auth/authorization-server-metadata";
