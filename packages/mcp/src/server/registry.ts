import { dispatchTool } from "../dispatch/proxy";
import type {
  GeneratedTool,
  JsonSchema,
  RequestAuth,
  ToolAnnotations,
} from "../types";
import { redactResponseBody } from "./redact";

/**
 * The registry is the transport-agnostic seam between the generated tools and the
 * MCP SDK. The consuming app owns the HTTP/JSON-RPC transport (mounting it at
 * `/api/mcp`) and, per request, resolves {@link RequestAuth} and calls
 * {@link ToolRegistry.listTools} / {@link ToolRegistry.callTool}. Keeping the
 * SDK out of this package means the core stays testable and portable.
 */

/** An MCP tool descriptor as advertised to clients (subset of the MCP schema). */
export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  annotations: ToolAnnotations;
}

/**
 * `_meta` key carrying the upstream HTTP status of a dispatched call.
 *
 * `isError` is one bit, and it collapses answers that mean opposite things: a
 * 404 for a record that does not exist, a 403 a guard correctly refused, a
 * domain refusal ("this store does not use comandas"), and a 500 where the route
 * threw all arrive identical. Callers that need to tell "correctly refused" from
 * "actually broken" — `mcp:smoke` above all — cannot, because the status is
 * known at dispatch and then dropped. Publishing it under a namespaced `_meta`
 * key (permitted by the MCP result schema) keeps `isError` as the agent-facing
 * signal while making the distinction recoverable.
 */
export const HTTP_STATUS_META_KEY = "dispatch/httpStatus";

/** An MCP tool-call result (subset of the MCP schema). */
export interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
  /** Machine-readable output matching the advertised outputSchema. */
  structuredContent?: Record<string, unknown>;
  /** Out-of-band metadata; carries {@link HTTP_STATUS_META_KEY} when dispatched. */
  _meta?: Record<string, unknown>;
}

export interface ToolRegistry {
  listTools(auth?: RequestAuth): McpToolDescriptor[];
  callTool(
    name: string,
    args: Record<string, unknown>,
    auth: RequestAuth,
  ): Promise<McpToolResult>;
}

export interface RegistryOptions {
  tools: GeneratedTool[];
  /** Origin the tools proxy to (usually the app's own public URL). */
  baseUrl: string;
  fetchImpl?: typeof fetch;
  /**
   * Optional visibility filter — e.g. hide mutating tools, or tools whose
   * required scope the caller lacks. Authorization is still enforced upstream;
   * this only shapes what the agent is shown.
   */
  isVisible?: (tool: GeneratedTool, auth?: RequestAuth) => boolean;
}

function textResult(
  value: unknown,
  isError: boolean,
  httpStatus?: number,
): McpToolResult {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const result: McpToolResult = { content: [{ type: "text", text }], isError };
  if (httpStatus !== undefined) {
    result._meta = { [HTTP_STATUS_META_KEY]: httpStatus };
  }
  return result;
}

function successfulResult(tool: GeneratedTool, value: unknown): McpToolResult {
  // Redact BEFORE rendering the text block: the agent reads `content` even when
  // it ignores `structuredContent`, so stripping only the latter would still
  // hand over the field.
  const safe = redactResponseBody(value, tool.redactResponse);
  const result = textResult(safe, false);
  if (
    tool.outputSchema &&
    safe !== null &&
    typeof safe === "object" &&
    !Array.isArray(safe)
  ) {
    result.structuredContent = safe as Record<string, unknown>;
  }
  return result;
}

export function createToolRegistry(options: RegistryOptions): ToolRegistry {
  const byName = new Map(options.tools.map((tool) => [tool.name, tool]));

  return {
    listTools(auth) {
      return options.tools
        .filter((tool) =>
          options.isVisible ? options.isVisible(tool, auth) : true,
        )
        .map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
          annotations: tool.annotations,
        }));
    },

    async callTool(name, args, auth) {
      const tool = byName.get(name);
      if (!tool) return textResult(`Unknown tool: ${name}`, true);

      try {
        const result = await dispatchTool(tool, args, {
          baseUrl: options.baseUrl,
          bearer: auth.bearer,
          fetchImpl: options.fetchImpl,
        });
        // A non-2xx from the endpoint (e.g. 403 tenant-forbidden) is surfaced to
        // the agent as an error result, NOT thrown — the permission decision was
        // made upstream and its message is the useful signal. The status rides
        // along in `_meta` so a caller can tell a correct refusal from a break.
        return result.ok
          ? successfulResult(tool, result.body)
          : textResult(result.body, true, result.status);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return textResult(`Tool dispatch failed: ${message}`, true);
      }
    },
  };
}
