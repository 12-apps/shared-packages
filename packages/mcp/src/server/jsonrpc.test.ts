import { describe, expect, it } from "vitest";

import type { RequestAuth } from "../types";

import {
  handleMcpJsonRpc,
  MCP_PROTOCOL_VERSION,
  UNAUTHORIZED_CODE,
  type JsonRpcRequest,
  type McpJsonRpcOptions,
} from "./jsonrpc";
import type { McpToolDescriptor, McpToolResult, ToolRegistry } from "./registry";

/**
 * The transport is tested against a STUB registry, not a generated one: this
 * module's job is the JSON-RPC envelope, and binding it to a real catalogue
 * would only re-test `createToolRegistry`. A host's own suite covers the
 * catalogue half.
 */
interface Dispatched {
  name: string;
  args: Record<string, unknown>;
  auth: RequestAuth;
}

const DESCRIPTOR: McpToolDescriptor = {
  name: "getThing",
  description: "Get a thing",
  inputSchema: { type: "object", properties: {} },
  annotations: {
    title: "Get a thing",
    readOnlyHint: true,
    openWorldHint: false,
    destructiveHint: false,
  },
};

function registry(dispatched: Dispatched[] = []): ToolRegistry {
  return {
    listTools: (auth?: RequestAuth) =>
      auth ? [DESCRIPTOR, { ...DESCRIPTOR, name: "deleteThing" }] : [DESCRIPTOR],
    callTool: async (name, args, auth) => {
      dispatched.push({ name, args, auth });
      return {
        content: [{ type: "text", text: `called ${name}` }],
        isError: false,
      } as McpToolResult;
    },
  } as ToolRegistry;
}

const OPTIONS: McpJsonRpcOptions = {
  serverInfo: { name: "example-host", version: "7.0.0" },
  instructions: "Resolve the tenant before acting.",
};

describe("handleMcpJsonRpc", () => {
  it("initialize advertises the protocol version and the tools capability", async () => {
    const res = await handleMcpJsonRpc(
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      registry(),
      null,
      OPTIONS,
    );
    expect(res?.result).toMatchObject({
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
    });
  });

  it("initialize does NOT claim listChanged (this transport cannot send one)", async () => {
    const res = await handleMcpJsonRpc(
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      registry(),
      null,
      OPTIONS,
    );
    const { capabilities } = res?.result as { capabilities: { tools: Record<string, unknown> } };
    expect(capabilities.tools).not.toHaveProperty("listChanged");
  });

  it("initialize returns the HOST's serverInfo and instructions verbatim", async () => {
    const res = await handleMcpJsonRpc(
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      registry(),
      null,
      OPTIONS,
    );
    expect(res?.result).toMatchObject({
      serverInfo: { name: "example-host", version: "7.0.0" },
      instructions: "Resolve the tenant before acting.",
    });
  });

  it("initialize omits instructions entirely when the host supplies none", async () => {
    const res = await handleMcpJsonRpc(
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      registry(),
      null,
      { serverInfo: OPTIONS.serverInfo },
    );
    expect(res?.result).not.toHaveProperty("instructions");
  });

  it("initialize honours a protocolVersion override", async () => {
    const res = await handleMcpJsonRpc(
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      registry(),
      null,
      { ...OPTIONS, protocolVersion: "2099-01-01" },
    );
    expect(res?.result).toMatchObject({ protocolVersion: "2099-01-01" });
  });

  it("ping answers an empty result", async () => {
    const res = await handleMcpJsonRpc(
      { jsonrpc: "2.0", id: 2, method: "ping" },
      registry(),
      null,
      OPTIONS,
    );
    expect(res?.result).toEqual({});
  });

  it("tools/list needs no auth to discover", async () => {
    const res = await handleMcpJsonRpc(
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
      registry(),
      null,
      OPTIONS,
    );
    const { tools } = res?.result as { tools: McpToolDescriptor[] };
    expect(tools.map((tool) => tool.name)).toEqual(["getThing"]);
  });

  it("tools/list passes the caller's auth through, so visibility can widen", async () => {
    const res = await handleMcpJsonRpc(
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
      registry(),
      { bearer: "tok-abc" },
      OPTIONS,
    );
    const { tools } = res?.result as { tools: McpToolDescriptor[] };
    expect(tools.map((tool) => tool.name)).toEqual(["getThing", "deleteThing"]);
  });

  it("tools/call forwards the name, arguments and auth to the registry", async () => {
    const dispatched: Dispatched[] = [];
    const res = await handleMcpJsonRpc(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "getThing", arguments: { id: "t1" } },
      },
      registry(dispatched),
      { bearer: "tok-abc" },
      OPTIONS,
    );
    expect(dispatched).toEqual([
      { name: "getThing", args: { id: "t1" }, auth: { bearer: "tok-abc" } },
    ]);
    expect((res?.result as McpToolResult).isError).toBe(false);
  });

  it("tools/call defaults absent arguments to an empty object", async () => {
    const dispatched: Dispatched[] = [];
    await handleMcpJsonRpc(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "getThing" } },
      registry(dispatched),
      { bearer: "tok-abc" },
      OPTIONS,
    );
    expect(dispatched[0]?.args).toEqual({});
  });

  it("tools/call without a bearer returns the unauthorized error, and dispatches nothing", async () => {
    const dispatched: Dispatched[] = [];
    const res = await handleMcpJsonRpc(
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "getThing" } },
      registry(dispatched),
      null,
      OPTIONS,
    );
    expect(res?.error?.code).toBe(UNAUTHORIZED_CODE);
    expect(dispatched).toEqual([]);
  });

  it("tools/call with no tool name is Invalid params", async () => {
    const res = await handleMcpJsonRpc(
      { jsonrpc: "2.0", id: 6, method: "tools/call", params: {} },
      registry(),
      { bearer: "tok-abc" },
      OPTIONS,
    );
    expect(res?.error?.code).toBe(-32602);
  });

  it("notifications get no reply", async () => {
    const res = await handleMcpJsonRpc(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      registry(),
      null,
      OPTIONS,
    );
    expect(res).toBeNull();
  });

  it("ignores any unhandled notifications/* method (no reply, no error)", async () => {
    const res = await handleMcpJsonRpc(
      { jsonrpc: "2.0", method: "notifications/cancelled" },
      registry(),
      null,
      OPTIONS,
    );
    expect(res).toBeNull();
  });

  it("returns method-not-found for an unknown non-notification method", async () => {
    const res = await handleMcpJsonRpc(
      { jsonrpc: "2.0", id: 7, method: "tools/unknown" },
      registry(),
      null,
      OPTIONS,
    );
    expect(res?.error?.code).toBe(-32601);
  });

  it("returns Invalid Request (no throw) for a payload with no method", async () => {
    const res = await handleMcpJsonRpc(
      { jsonrpc: "2.0", id: 1 } as unknown as JsonRpcRequest,
      registry(),
      null,
      OPTIONS,
    );
    expect(res?.error?.code).toBe(-32600);
    expect(res?.id).toBe(1);
  });

  it("returns Invalid Request (no throw) for a null request / batch element", async () => {
    const res = await handleMcpJsonRpc(
      null as unknown as JsonRpcRequest,
      registry(),
      null,
      OPTIONS,
    );
    expect(res?.error?.code).toBe(-32600);
    expect(res?.id).toBeNull();
  });
});
