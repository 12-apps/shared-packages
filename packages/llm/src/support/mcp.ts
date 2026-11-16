/**
 * Tools from an MCP server, allow-listed per tier.
 *
 * `mcpTools` is a tool source: for each `handle()` call it asks the host to
 * `connect(scope)` (the host's per-call auth hook: the scope's own token or
 * headers reach the server there, never through the model) and offers the
 * tier ONLY the tools named in `allow`. The rest of the server's list is never
 * shown to the model, and a call to a tool outside it never reaches the server.
 *
 * A server whose tools take the tenant as an ARGUMENT gets it from `bindArgs`
 * (host-supplied, merged after the model's input, hidden from the model).
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
  /**
   * Arguments the HOST supplies, for a server whose tools take the tenant (or
   * any scope field) as an argument. They are merged AFTER the model's input,
   * so the host's value always wins; their names are removed from the schema
   * the model sees, and a model call that sets one is refused without
   * reaching the server.
   */
  bindArgs?(scope: Scope, toolName: string): Readonly<Record<string, unknown>>;
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

/** A schema without the host-bound property names, at its top level. */
function withoutFields(schema: JsonSchema, fields: readonly string[]): JsonSchema {
  if (fields.length === 0) return schema;
  const properties = (schema.properties ?? {}) as Record<string, unknown>;
  const kept = Object.fromEntries(Object.entries(properties).filter(([key]) => !fields.includes(key)));
  const required = Array.isArray(schema.required) ? schema.required.filter((key) => !fields.includes(key as string)) : schema.required;
  return { ...schema, properties: kept, ...(required === undefined ? {} : { required }) };
}

function definitionOf(info: McpToolInfo, override: McpToolsOptions<unknown>["overrides"], bound: readonly string[]): ToolDefinition {
  const own = override?.[info.name] ?? {};
  return {
    name: info.name,
    description: own.description ?? info.description ?? info.name,
    inputSchema: withoutFields(own.inputSchema ?? info.inputSchema, bound),
  };
}

/** Run one allowed tool: the model's object input, then the host's bound arguments over it. */
async function callAllowed(client: McpClientLike, name: string, input: unknown, bound: Readonly<Record<string, unknown>>): Promise<ToolOutput> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { output: "The arguments must be an object.", isError: true };
  const set = Object.keys(bound).find((key) => Object.hasOwn(input, key));
  if (set) return { output: `Refused: "${set}" is set by the host, never by the assistant.`, isError: true };
  return mcpResultToOutput(await client.callTool({ name, arguments: { ...(input as Record<string, unknown>), ...bound } }));
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
      return offered.map((info): SupportTool<Scope, Context> => {
        const bound = options.bindArgs?.(scope, info.name) ?? {};
        return {
          definition: definitionOf(info, options.overrides, Object.keys(bound)),
          run: (input) => callAllowed(client, info.name, input, bound),
        };
      });
    },
  };
}
