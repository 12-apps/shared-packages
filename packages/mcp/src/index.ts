/**
 * @repo/mcp — app-agnostic MCP server core.
 *
 * Turn an OpenAPI document into MCP tools (one per operation) and dispatch each
 * tool call by proxying to the endpoint with the caller's bearer token, so an
 * agent inherits exactly the user's permissions. The consuming app supplies the
 * spec, the base URL, and an AuthResolver, and binds the ToolRegistry to the MCP
 * transport (mounted at `/api/mcp`).
 */

export * from "./types";
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
} from "./auth/authorization-server-metadata";
