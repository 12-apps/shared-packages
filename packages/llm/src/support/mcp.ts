/**
 * Tools from an MCP server, allow-listed per tier.
 *
 * `mcpTools` is a tool source: for each `handle()` call it asks the host to
 * `connect(scope)` (the host's per-call auth hook: the scope's own token or
 * headers reach the server there, never through the model) and offers the
 * tier ONLY the tools named in `allow`. The rest of the server's list is never
 * shown to the model, and a call to a tool outside it never reaches the server.
 *
 * The client is structural (`listTools` / `callTool`, as the official MCP SDK's
 * `Client` has them), so this package depends on no MCP SDK.
 */
import { SupportLadderError } from "../errors";
import type { ToolOutput } from "../loop";
import type { JsonSchema, ToolDefinition } from "../types";
import type { SupportTool, SupportToolSource } from "./tools";

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
}

export interface McpListToolsResult {
  tools: McpToolInfo[];
  nextCursor?: string;
}

/** The two calls this source makes; the official SDK's `Client` has both. */
export interface McpClientLike {
  listTools(params?: { cursor?: string }): Promise<McpListToolsResult>;
  callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<unknown>;
}

export interface McpToolsOptions<Scope> {
  /**
   * A client for this scope. Put the scope's credentials or headers on its
   * transport here; cache connections per scope if they are costly.
   */
  connect(scope: Scope): McpClientLike | Promise<McpClientLike>;
  /** The ONLY tools offered, by name. Every one must exist on the server. */
  allow: readonly string[];
  /**
   * Replace an allowed tool's description or input schema, for a server
   * whose schema is not strict (every tool schema must be; see `assertStrictTools`).
   */
  overrides?: Readonly<Record<string, Partial<Pick<ToolDefinition, "description" | "inputSchema">>>>;
}

async function listAll(client: McpClientLike, cursor?: string, found: McpToolInfo[] = []): Promise<McpToolInfo[]> {
  const page = await client.listTools(cursor === undefined ? undefined : { cursor });
  const all = [...found, ...page.tools];
  return page.nextCursor ? listAll(client, page.nextCursor, all) : all;
}

function isTextPart(part: unknown): part is { type: "text"; text: string } {
  const candidate = part as { type?: unknown; text?: unknown } | null;
  return candidate?.type === "text" && typeof candidate.text === "string";
}

/** An MCP `CallToolResult` as tool output: its text parts, else its structured content. */
export function mcpResultToOutput(result: unknown): ToolOutput {
  const shape = (result && typeof result === "object" ? result : {}) as { content?: unknown; structuredContent?: unknown; isError?: unknown };
  const text = Array.isArray(shape.content) ? shape.content.filter(isTextPart).map((part) => part.text).join("\n") : "";
  const output = text || (shape.structuredContent === undefined ? "" : JSON.stringify(shape.structuredContent));
  return shape.isError === true ? { output, isError: true } : output;
}

function definitionOf(info: McpToolInfo, override: McpToolsOptions<unknown>["overrides"]): ToolDefinition {
  const own = override?.[info.name] ?? {};
  return {
    name: info.name,
    description: own.description ?? info.description ?? info.name,
    inputSchema: own.inputSchema ?? info.inputSchema,
  };
}

export function mcpTools<Scope = unknown, Context = unknown>(options: McpToolsOptions<Scope>): SupportToolSource<Scope, Context> {
  const allow = new Set(options.allow);
  if (allow.size === 0) throw new SupportLadderError("tool_missing", "mcpTools needs at least one allow-listed tool.");
  return {
    async resolve(scope) {
      const client = await options.connect(scope);
      const offered = (await listAll(client)).filter((info) => allow.has(info.name));
      const missing = [...allow].filter((name) => !offered.some((info) => info.name === name));
      if (missing.length > 0) {
        throw new SupportLadderError("tool_missing", `the MCP server has no tool named ${missing.map((name) => `"${name}"`).join(", ")}.`);
      }
      return offered.map((info): SupportTool<Scope, Context> => ({
        definition: definitionOf(info, options.overrides),
        async run(input) {
          if (!input || typeof input !== "object" || Array.isArray(input)) return { output: "The arguments must be an object.", isError: true };
          return mcpResultToOutput(await client.callTool({ name: info.name, arguments: input as Record<string, unknown> }));
        },
      }));
    },
  };
}
