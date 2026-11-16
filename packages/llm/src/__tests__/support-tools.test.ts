import { describe, expect, it, vi } from "vitest";

import { createSupportLadder } from "../support/ladder";
import type { McpClientLike, McpToolInfo } from "../support/mcp";
import { mcpResultToOutput, mcpTools } from "../support/mcp";
import type { SupportTool, SupportToolEntry } from "../support/tools";
import type { ModelClient } from "../client";
import { memoryState, objectSchema, reactiveClient, tierClient, toolCall } from "./support-helpers";

type Script = Parameters<typeof tierClient>[1] | ModelClient;

interface Tenant {
  tenantId: string;
}

const request = (scope: Tenant, message = "help", conversationId = "c1") => ({ conversationId, message, transcript: [{ role: "user" as const, text: "hi" }], context: null, scope });

function tool(name: string, run: SupportTool<Tenant>["run"] = () => "ok", field = "query"): SupportTool<Tenant> {
  return { definition: { name, description: `The ${name} tool.`, inputSchema: objectSchema(field) }, run };
}

/** A ladder whose tiers each have their own script and tool list. */
function ladderOf(tiers: Array<{ script: Script; tools: SupportToolEntry<Tenant, null>[] }>, scopeFields = ["tenantId"]) {
  const clients = tiers.map((tier, index) =>
    Array.isArray(tier.script) ? tierClient(`provider-${index}`, tier.script) : { client: tier.script as ModelClient, calls: [] },
  );
  const ladder = createSupportLadder<Tenant, null>({
    tiers: tiers.map((tier, index) => ({ id: `tier-${index}`, client: clients[index]?.client as ModelClient, instructions: "help", tools: tier.tools })),
    person: { handOff: vi.fn() },
    state: memoryState(),
    scopeFields,
  });
  return { ladder, calls: clients.map((client) => client.calls) };
}

/** A fake MCP server with paging, recording every call and the scope it was connected for. */
function fakeServer(tools: McpToolInfo[]) {
  const connected: Tenant[] = [];
  const called: Array<{ tenant: string; name: string; arguments?: Record<string, unknown> }> = [];
  const connect = (scope: Tenant): McpClientLike => {
    connected.push(scope);
    return {
      listTools: async (params) =>
        params?.cursor ? { tools: tools.slice(1) } : { tools: tools.slice(0, 1), ...(tools.length > 1 ? { nextCursor: "page-2" } : {}) },
      callTool: async (params) => {
        called.push({ tenant: scope.tenantId, ...params });
        return { content: [{ type: "text", text: `${params.name} for ${scope.tenantId}` }] };
      },
    };
  };
  return { connect, connected, called };
}

const faq: McpToolInfo = { name: "faq_search", description: "Search the FAQ.", inputSchema: objectSchema("query") };
const wipe: McpToolInfo = { name: "delete_account", description: "Delete an account.", inputSchema: objectSchema("account") };

describe("support tools: least privilege per tier", () => {
  it("offers each tier exactly its own tools, and refuses a call to another tier's tool", async () => {
    const read = vi.fn(() => "article");
    const write = vi.fn(() => "saved");
    const { ladder, calls } = ladderOf([
      { script: [{ toolCalls: [toolCall("update_settings", { query: "x" })] }, { text: "I cannot do that here." }], tools: [tool("read_knowledge", read)] },
      { script: [{ text: "never" }], tools: [tool("read_knowledge", read), tool("update_settings", write)] },
    ]);
    const result = await ladder.handle(request({ tenantId: "a" }));
    expect(result).toMatchObject({ kind: "model", tier: "tier-0" });
    expect(calls[0]?.[0]?.request.tools?.map((definition) => definition.name)).toEqual(["read_knowledge", "escalate"]);
    expect(write).not.toHaveBeenCalled();
    expect(calls[0]?.[1]?.request.messages.at(-1)).toMatchObject({ role: "tool", results: [{ name: "update_settings", output: "This tool does not exist.", isError: true }] });
  });

  it("refuses a tier tool named like the ladder's escalate, or offered twice", () => {
    expect(() => ladderOf([{ script: [{ text: "x" }], tools: [tool("escalate")] }])).toThrow(expect.objectContaining({ code: "tool_conflict" }));
    expect(() => ladderOf([{ script: [{ text: "x" }], tools: [tool("a"), tool("a")] }])).toThrow(expect.objectContaining({ code: "tool_conflict" }));
  });

  it("drops a host tool's halt: only the ladder ends a tier", async () => {
    const { ladder } = ladderOf([{ script: [{ toolCalls: [toolCall("read_knowledge", { query: "x" })] }, { text: "answered" }], tools: [tool("read_knowledge", () => ({ output: "x", halt: true }))] }]);
    expect(await ladder.handle(request({ tenantId: "a" }))).toMatchObject({ kind: "model", reply: "answered" });
  });
});

describe("support tools: scope binding", () => {
  it("hands the scope given to handle() to the tool, and never mixes two calls' scopes", async () => {
    const seen: string[] = [];
    const lookup = tool("read_knowledge", (_input, context) => {
      seen.push(context.scope.tenantId);
      return `for ${context.scope.tenantId}`;
    });
    const { ladder } = ladderOf([{ script: reactiveClient(toolCall("read_knowledge", { query: "x" })), tools: [lookup] }]);
    await Promise.all([ladder.handle(request({ tenantId: "a" }, "q", "c-a")), ladder.handle(request({ tenantId: "b" }, "q", "c-b"))]);
    expect(seen.sort()).toEqual(["a", "b"]);
  });

  it("refuses a model call whose arguments try to set a scope-bound field, without running the tool", async () => {
    const run = vi.fn(() => "ok");
    const { ladder, calls } = ladderOf([
      { script: [{ toolCalls: [toolCall("read_knowledge", { query: "x", filter: { tenantId: "b" } })] }, { text: "done" }], tools: [tool("read_knowledge", run)] },
    ]);
    await ladder.handle(request({ tenantId: "a" }));
    expect(run).not.toHaveBeenCalled();
    expect(calls[0]?.[1]?.request.messages.at(-1)).toMatchObject({ role: "tool", results: [{ isError: true, output: expect.stringContaining('"tenantId"') }] });
  });

  it("refuses a tool whose schema lets the model set a scope-bound field", () => {
    expect(() => ladderOf([{ script: [{ text: "x" }], tools: [tool("read_knowledge", () => "ok", "tenantId")] }])).toThrow(
      expect.objectContaining({ code: "scope_exposed" }),
    );
  });
});

describe("mcpTools", () => {
  it("offers only the allow-listed tools, connected for the call's scope", async () => {
    const server = fakeServer([faq, wipe]);
    const { ladder, calls } = ladderOf([
      { script: [{ toolCalls: [toolCall("faq_search", { query: "hours" })] }, { text: "We open at 9." }], tools: [mcpTools({ connect: server.connect, allow: ["faq_search"] })] },
    ]);
    const result = await ladder.handle(request({ tenantId: "a" }));
    expect(result).toMatchObject({ kind: "model", reply: "We open at 9." });
    expect(calls[0]?.[0]?.request.tools?.map((definition) => definition.name)).toEqual(["faq_search", "escalate"]);
    expect(server.connected).toEqual([{ tenantId: "a" }]);
    expect(server.called).toEqual([{ tenant: "a", name: "faq_search", arguments: { query: "hours" } }]);
    expect(calls[0]?.[1]?.request.messages.at(-1)).toMatchObject({ results: [{ output: "faq_search for a" }] });
  });

  it("refuses a call to a tool the allow-list leaves out; it never reaches the server", async () => {
    const server = fakeServer([faq, wipe]);
    const { ladder } = ladderOf([
      { script: [{ toolCalls: [toolCall("delete_account", { account: "x" })] }, { text: "I can't." }], tools: [mcpTools({ connect: server.connect, allow: ["faq_search"] })] },
    ]);
    await ladder.handle(request({ tenantId: "a" }));
    expect(server.called).toEqual([]);
  });

  it("reaches the server with each call's own scope", async () => {
    const server = fakeServer([faq]);
    const { ladder } = ladderOf([
      { script: reactiveClient(toolCall("faq_search", { query: "q" })), tools: [mcpTools({ connect: server.connect, allow: ["faq_search"] })] },
    ]);
    await ladder.handle(request({ tenantId: "a" }, "q", "c-a"));
    await ladder.handle(request({ tenantId: "b" }, "q", "c-b"));
    expect(server.called.map((call) => call.tenant)).toEqual(["a", "b"]);
  });

  it("refuses an empty allow-list, and an allowed tool the server does not have", async () => {
    expect(() => mcpTools({ connect: fakeServer([faq]).connect, allow: [] })).toThrow(expect.objectContaining({ code: "tool_missing" }));
    const source = mcpTools<Tenant>({ connect: fakeServer([faq]).connect, allow: ["faq_search", "nope"] });
    await expect(source.resolve({ tenantId: "a" })).rejects.toMatchObject({ code: "tool_missing" });
  });

  it("refuses an allowed server tool whose schema exposes a scope-bound field", async () => {
    const leaky: McpToolInfo = { name: "lookup", inputSchema: objectSchema("tenantId") };
    const { ladder } = ladderOf([{ script: [{ text: "x" }], tools: [mcpTools({ connect: fakeServer([leaky]).connect, allow: ["lookup"] })] }]);
    await expect(ladder.handle(request({ tenantId: "a" }))).rejects.toMatchObject({ code: "scope_exposed" });
  });

  it("applies a host override to an allowed tool's definition", async () => {
    const loose: McpToolInfo = { name: "faq_search", inputSchema: { type: "object", properties: { query: { type: "string" } } } };
    const source = mcpTools<Tenant>({ connect: fakeServer([loose]).connect, allow: ["faq_search"], overrides: { faq_search: { description: "FAQ.", inputSchema: objectSchema("query") } } });
    const [resolved] = await source.resolve({ tenantId: "a" });
    expect(resolved?.definition).toEqual({ name: "faq_search", description: "FAQ.", inputSchema: objectSchema("query") });
  });

  it("turns an MCP result into tool output", () => {
    expect(mcpResultToOutput({ content: [{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }] })).toBe("a\nb");
    expect(mcpResultToOutput({ content: [], structuredContent: { n: 1 } })).toBe('{"n":1}');
    expect(mcpResultToOutput({ content: [{ type: "text", text: "boom" }], isError: true })).toEqual({ output: "boom", isError: true });
  });
});
