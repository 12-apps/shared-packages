import type { RequestAuth } from "../types";

import type { ToolRegistry } from "./registry";

/**
 * The MCP JSON-RPC 2.0 request half of the Streamable HTTP transport.
 *
 * Implemented directly rather than via the MCP SDK because the SDK's transport is
 * Node-`http` oriented, and a host serving Web `Request`/`Response` (a Next route
 * handler, a Hono route) has no `http.IncomingMessage` to hand it. It covers the
 * methods a client needs to discover and call tools: `initialize`, `tools/list`,
 * `tools/call`, plus `ping`.
 *
 * WHAT IS MECHANISM AND LIVES HERE: the envelope, the method table, the error
 * codes, the well-formedness rule, and the notification convention. None of it
 * varies per host — it is JSON-RPC 2.0 and the MCP specification.
 *
 * WHAT IS VOCABULARY AND STAYS WITH THE HOST: the server's NAME, its version, and
 * the `instructions` string an agent reads on connect. Those describe one
 * particular product's tool surface, so they arrive as {@link McpJsonRpcOptions}
 * rather than being written here.
 */

/** The MCP protocol revision this transport implements. */
export const MCP_PROTOCOL_VERSION = "2025-06-18";

/**
 * JSON-RPC error code for "authentication required", returned by `tools/call`
 * when the request carried no valid bearer. Outside the reserved -32768..-32000
 * band's *defined* codes on purpose: it is an implementation-defined server
 * error, and a host maps it to HTTP 401.
 */
export const UNAUTHORIZED_CODE = -32001;

/** JSON-RPC "Invalid Request" — a payload that isn't a well-formed request object. */
const INVALID_REQUEST_CODE = -32600;

/** JSON-RPC "Method not found". */
const METHOD_NOT_FOUND_CODE = -32601;

/** JSON-RPC "Invalid params". */
const INVALID_PARAMS_CODE = -32602;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

/** What a client is told it connected to, in `initialize`'s `serverInfo`. */
export interface McpServerInfo {
  /** The server's name, as a connected host displays it. */
  name: string;
  /**
   * The advertised surface version.
   *
   * This is the ONLY signal a client gets that the tool surface changed: the
   * transport is request/response only, so `notifications/tools/list_changed`
   * can never be sent, and a host that cached `tools/list` at the handshake has
   * no other reason to ask again. See `server/surface-lock.ts` for the guard
   * that makes forgetting to move it a build error instead of a comment.
   */
  version: string;
}

export interface McpJsonRpcOptions {
  /** The host's identity, returned verbatim in `initialize`. */
  serverInfo: McpServerInfo;
  /**
   * Server-level guidance surfaced to the model on `initialize` (the MCP spec's
   * optional `instructions` field). Omitted from the result when absent, rather
   * than sent empty — a blank string is a claim that there is guidance.
   */
  instructions?: string;
  /**
   * Override the advertised protocol revision. Defaults to
   * {@link MCP_PROTOCOL_VERSION}; a host should not normally set it.
   */
  protocolVersion?: string;
}

function ok(id: JsonRpcRequest["id"], result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function fail(id: JsonRpcRequest["id"], code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

/** A parsed body is a usable request only if it's an object carrying a string `method`. */
function isWellFormed(request: JsonRpcRequest): boolean {
  return request != null && typeof request === "object" && typeof request.method === "string";
}

async function handleToolsCall(
  request: JsonRpcRequest,
  registry: ToolRegistry,
  auth: RequestAuth | null,
): Promise<JsonRpcResponse> {
  if (!auth) return fail(request.id, UNAUTHORIZED_CODE, "Authentication required");
  const params = (request.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
  if (!params.name) return fail(request.id, INVALID_PARAMS_CODE, "Missing tool name");
  const result = await registry.callTool(params.name, params.arguments ?? {}, auth);
  return ok(request.id, result);
}

function handleInitialize(
  request: JsonRpcRequest,
  options: McpJsonRpcOptions,
): JsonRpcResponse {
  return ok(request.id, {
    protocolVersion: options.protocolVersion ?? MCP_PROTOCOL_VERSION,
    // Deliberately does NOT claim `listChanged`: this transport has no
    // server→client stream, so the notification could never be sent, and
    // advertising it would stop a host from ever re-reading `tools/list`.
    capabilities: { tools: {} },
    serverInfo: options.serverInfo,
    ...(options.instructions ? { instructions: options.instructions } : {}),
  });
}

/**
 * Handle one MCP JSON-RPC request.
 *
 * Returns `null` for notifications (no id, no reply expected). `auth` is the
 * verified caller identity, or `null` when the request carried no valid bearer —
 * `tools/call` then returns {@link UNAUTHORIZED_CODE}, which the host surfaces as
 * HTTP 401. Discovery (`initialize`, `ping`, `tools/list`) stays open, so a client
 * can read the surface before it has a token.
 */
export async function handleMcpJsonRpc(
  request: JsonRpcRequest,
  registry: ToolRegistry,
  auth: RequestAuth | null,
  options: McpJsonRpcOptions,
): Promise<JsonRpcResponse | null> {
  // A host casts the parsed body to JsonRpcRequest without validating it, so a
  // malformed payload can arrive here: a `null` body/batch element, a non-object,
  // or an object with no `method`. Reject any of these as Invalid Request rather
  // than dereferencing `request`/`request.method` and throwing a 500 below.
  if (!isWellFormed(request)) {
    return fail(request?.id ?? null, INVALID_REQUEST_CODE, "Invalid Request");
  }
  switch (request.method) {
    case "initialize":
      return handleInitialize(request, options);
    case "ping":
      return ok(request.id, {});
    case "tools/list":
      return ok(request.id, { tools: registry.listTools(auth ?? undefined) });
    case "tools/call":
      return handleToolsCall(request, registry, auth);
    default:
      // JSON-RPC notifications (`notifications/*`) expect no reply — silently
      // ignore any we don't explicitly handle, rather than returning an error.
      if (request.method.startsWith("notifications/")) return null;
      return fail(request.id, METHOD_NOT_FOUND_CODE, `Method not found: ${request.method}`);
  }
}
