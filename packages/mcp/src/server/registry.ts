import { dispatchTool } from "../dispatch/proxy";
import type { GeneratedTool, JsonSchema, RequestAuth } from "../types";

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
}

/** An MCP tool-call result (subset of the MCP schema). */
export interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
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

function textResult(value: unknown, isError: boolean): McpToolResult {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }], isError };
}

export function createToolRegistry(options: RegistryOptions): ToolRegistry {
  const byName = new Map(options.tools.map((tool) => [tool.name, tool]));

  return {
    listTools(auth) {
      return options.tools
        .filter((tool) => (options.isVisible ? options.isVisible(tool, auth) : true))
        .map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
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
        // made upstream and its message is the useful signal.
        return textResult(result.body, !result.ok);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return textResult(`Tool dispatch failed: ${message}`, true);
      }
    },
  };
}
