import { describe, expect, it } from "vitest";

import { createToolRegistry, HTTP_STATUS_META_KEY } from "./registry";
import type { GeneratedTool, RequestAuth } from "../types";

const readTool: GeneratedTool = {
  name: "getThing",
  description: "Get a thing",
  method: "GET",
  path: "/things/{id}",
  inputSchema: { type: "object", properties: { id: {} }, required: ["id"] },
  outputSchema: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
  },
  annotations: {
    title: "Fixture tool",
    readOnlyHint: true,
    openWorldHint: false,
    destructiveHint: false,
  },
  parameters: [{ name: "id", in: "path", required: true, schema: {} }],
  bodyProps: [],
  bodyIsWhole: false,
  mutating: false,
  security: [],
};

const writeTool: GeneratedTool = {
  ...readTool,
  name: "makeThing",
  method: "POST",
  mutating: true,
  annotations: {
    title: "Fixture tool",
    readOnlyHint: false,
    openWorldHint: false,
    destructiveHint: false,
  },
};

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

/** Answers with an arbitrary non-2xx, for asserting the status reaches `_meta`. */
function statusFetch(status: number): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ error: "nope" }), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

/** Never reaches the route at all — the dispatch itself throws. */
function throwingFetch(): typeof fetch {
  return (async () => {
    throw new Error("connect ECONNREFUSED");
  }) as unknown as typeof fetch;
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
    expect(registry.listTools()[0].outputSchema).toEqual(readTool.outputSchema);
    expect(registry.listTools()[0].annotations).toEqual(readTool.annotations);
  });

  it("strips redacted response fields from both text and structuredContent", async () => {
    const redactingTool: GeneratedTool = {
      ...readTool,
      name: "getSupplier",
      redactResponse: ["data.taxId"],
    };
    const registry = createToolRegistry({
      tools: [redactingTool],
      baseUrl: "https://app.example.com",
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({ data: { id: "s1", name: "ACME", taxId: "123" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        )) as unknown as typeof fetch,
    });

    const result = await registry.callTool("getSupplier", { id: "s1" }, auth);

    expect(result.isError).toBe(false);
    // The agent reads the text block even when it ignores structuredContent, so
    // the value must be gone from both surfaces.
    expect(result.content[0]?.text).not.toContain("123");
    expect(result.content[0]?.text).toContain("ACME");
    expect(result.structuredContent).toEqual({
      data: { id: "s1", name: "ACME" },
    });
  });

  it("returns an error result for an unknown tool", async () => {
    const registry = createToolRegistry({
      tools: [readTool],
      baseUrl: "https://app.example.com",
    });
    const result = await registry.callTool("nope", {}, auth);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unknown tool");
  });

  it("proxies a successful call with text and schema-matching structured content", async () => {
    const registry = createToolRegistry({
      tools: [readTool],
      baseUrl: "https://app.example.com",
      fetchImpl: okFetch(),
    });
    const result = await registry.callTool("getThing", { id: "1" }, auth);
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0].text)).toEqual({ id: "1" });
    expect(result.structuredContent).toEqual({ id: "1" });
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

  // `isError` alone cannot separate "correctly refused" from "actually broken":
  // a 404 for a missing record and a 500 from a thrown route are the same bit.
  // Callers that must tell them apart read the status from `_meta`.
  it.each([403, 404, 422, 500])(
    "carries the upstream %i in _meta so callers can classify the failure",
    async (status) => {
      const result = await createToolRegistry({
        tools: [readTool],
        baseUrl: "https://app.example.com",
        fetchImpl: statusFetch(status),
      }).callTool("getThing", { id: "1" }, auth);
      expect(result.isError).toBe(true);
      expect(result._meta?.[HTTP_STATUS_META_KEY]).toBe(status);
    },
  );

  it("omits the status _meta when dispatch never reached the route", async () => {
    const result = await createToolRegistry({
      tools: [readTool],
      baseUrl: "https://app.example.com",
      fetchImpl: throwingFetch(),
    }).callTool("getThing", { id: "1" }, auth);
    expect(result.isError).toBe(true);
    // No status at all is itself the signal — there was no HTTP answer to bucket.
    expect(result._meta).toBeUndefined();
    expect(result.content[0].text).toContain("Tool dispatch failed");
  });

  it("adds no _meta to a successful call", async () => {
    const result = await createToolRegistry({
      tools: [readTool],
      baseUrl: "https://app.example.com",
      fetchImpl: okFetch(),
    }).callTool("getThing", { id: "1" }, auth);
    expect(result._meta).toBeUndefined();
  });
});
