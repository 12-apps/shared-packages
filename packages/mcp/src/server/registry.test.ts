import { describe, expect, it } from "vitest";

import { createToolRegistry } from "./registry";
import type { GeneratedTool, RequestAuth } from "../types";

const readTool: GeneratedTool = {
  name: "getThing",
  description: "Get a thing",
  method: "GET",
  path: "/things/{id}",
  inputSchema: { type: "object", properties: { id: {} }, required: ["id"] },
  parameters: [{ name: "id", in: "path", required: true, schema: {} }],
  bodyProps: [],
  bodyIsWhole: false,
  mutating: false,
  security: [],
};

const writeTool: GeneratedTool = { ...readTool, name: "makeThing", method: "POST", mutating: true };

const auth: RequestAuth = { bearer: "tok" };

function okFetch(): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ id: "1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

function forbiddenFetch(): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

describe("createToolRegistry", () => {
  it("lists tools as MCP descriptors and honours the visibility filter", () => {
    const registry = createToolRegistry({
      tools: [readTool, writeTool],
      baseUrl: "https://app.example.com",
      isVisible: (tool) => !tool.mutating,
    });
    const names = registry.listTools().map((t) => t.name);
    expect(names).toEqual(["getThing"]);
    expect(registry.listTools()[0].inputSchema).toEqual(readTool.inputSchema);
  });

  it("returns an error result for an unknown tool", async () => {
    const registry = createToolRegistry({ tools: [readTool], baseUrl: "https://app.example.com" });
    const result = await registry.callTool("nope", {}, auth);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unknown tool");
  });

  it("proxies a successful call and returns a text result", async () => {
    const registry = createToolRegistry({
      tools: [readTool],
      baseUrl: "https://app.example.com",
      fetchImpl: okFetch(),
    });
    const result = await registry.callTool("getThing", { id: "1" }, auth);
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0].text)).toEqual({ id: "1" });
  });

  it("marks an upstream 403 as an error result (authz decided upstream)", async () => {
    const registry = createToolRegistry({
      tools: [readTool],
      baseUrl: "https://app.example.com",
      fetchImpl: forbiddenFetch(),
    });
    const result = await registry.callTool("getThing", { id: "1" }, auth);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("forbidden");
  });
});
