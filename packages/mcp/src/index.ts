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
  aiConnectPrompt,
  type AiConnectPromptSpec,
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
// The shape a route is DECLARED in, upstream of the OpenAPI document. It lives
// here so that packages which own a domain can ship that domain's endpoints and
// a host can concatenate them — which requires all of them to mean the same
// thing by "an endpoint". See `openapi/endpoint.ts`.
export type { McpEndpoint, HttpMethod } from "./openapi/endpoint";
export type {
  OpenApiDocument,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiRequestBody,
  OpenApiResponse,
} from "./openapi/generate";
export { dispatchTool, DispatchInputError } from "./dispatch/proxy";
// Both halves of the redaction contract. `redactResponseSchema` narrows what a
// tool ADVERTISES at generate time; `redactResponseBody` removes the same paths
// from what it RETURNS at dispatch. Taking one without the other reintroduces the
// schema/payload disagreement they exist to prevent — see `server/redact.ts`.
export { redactResponseSchema, redactResponseBody } from "./server/redact";
export {
  createToolRegistry,
  HTTP_STATUS_META_KEY,
  type ToolRegistry,
  type RegistryOptions,
  type McpToolDescriptor,
  type McpToolResult,
} from "./server/registry";
// The JSON-RPC 2.0 request half of the Streamable HTTP transport. The envelope,
// the method table and the error codes are the specification's and live here; the
// server NAME, its version and the `instructions` an agent reads on connect are
// one product's vocabulary and arrive as options.
export {
  handleMcpJsonRpc,
  MCP_PROTOCOL_VERSION,
  UNAUTHORIZED_CODE,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type McpJsonRpcOptions,
  type McpServerInfo,
} from "./server/jsonrpc";
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

export type { AiConnectPromptCopy } from "./guide";
export {
  PT_BR_AI_CAPABILITIES,
  PT_BR_AI_CONNECT_PROMPT,
  PT_BR_AI_HOST_GUIDES,
  PT_BR_AI_PERMISSION_MODEL,
} from "./pt-BR";
