import { describe, expect, it } from "vitest";

import { dispatchTool, DispatchInputError } from "./proxy";
import type { GeneratedTool } from "../types";

const getTool: GeneratedTool = {
  name: "getProduct",
  description: "",
  method: "GET",
  path: "/products/{id}",
  inputSchema: {},
  annotations: {
    title: "Fixture tool",
    readOnlyHint: true,
    openWorldHint: false,
    destructiveHint: false,
  },
  parameters: [
    { name: "id", in: "path", required: true, schema: {} },
    { name: "include", in: "query", required: false, schema: {} },
    { name: "x-trace", in: "header", required: false, schema: {} },
  ],
  bodyProps: [],
  bodyIsWhole: false,
  mutating: false,
  security: [],
};

const postTool: GeneratedTool = {
  name: "createProduct",
  description: "",
  method: "POST",
  path: "/products",
  inputSchema: {},
  annotations: {
    title: "Fixture tool",
    readOnlyHint: false,
    openWorldHint: true,
    destructiveHint: false,
  },
  parameters: [],
  bodyProps: ["name", "priceCents"],
  bodyIsWhole: false,
  mutating: true,
  security: [],
};

interface Captured {
  url: string;
  init: RequestInit;
}

function fakeFetch(
  status: number,
  payload: unknown,
  captured: Captured[],
): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    captured.push({ url, init });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("dispatchTool", () => {
  it("expands the path, forwards the bearer, and routes query + header args", async () => {
    const captured: Captured[] = [];
    const result = await dispatchTool(
      getTool,
      { id: "abc 1", include: "variations", "x-trace": "t1" },
      {
        baseUrl: "https://app.example.com",
        bearer: "tok123",
        fetchImpl: fakeFetch(200, { ok: 1 }, captured),
      },
    );

    expect(captured).toHaveLength(1);
    const { url, init } = captured[0];
    expect(url).toBe(
      "https://app.example.com/products/abc%201?include=variations",
    );
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer tok123");
    expect(headers["x-trace"]).toBe("t1");
    expect(init.body).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: 1 });
  });

  it("sends only known body props as a JSON body for a write", async () => {
    const captured: Captured[] = [];
    await dispatchTool(
      postTool,
      { name: "Cola", priceCents: 500, sneaky: "drop-me" },
      {
        baseUrl: "https://app.example.com",
        bearer: "t",
        fetchImpl: fakeFetch(201, {}, captured),
      },
    );
    const { init } = captured[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      name: "Cola",
      priceCents: 500,
    });
    expect((init.headers as Record<string, string>)["content-type"]).toBe(
      "application/json",
    );
  });

  it("throws on a missing required path parameter", async () => {
    await expect(
      dispatchTool(
        getTool,
        {},
        {
          baseUrl: "https://app.example.com",
          bearer: "t",
          fetchImpl: fakeFetch(200, {}, []),
        },
      ),
    ).rejects.toBeInstanceOf(DispatchInputError);
  });

  it("surfaces a non-2xx response as ok:false", async () => {
    const result = await dispatchTool(
      getTool,
      { id: "1" },
      {
        baseUrl: "https://app.example.com",
        bearer: "t",
        fetchImpl: fakeFetch(403, { error: "forbidden" }, []),
      },
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: "forbidden" });
  });

  // Regression (FUT-105 AC1): the proxy replay must carry the mint origin as the
  // standard reverse-proxy forwarded headers so the wrapped route reconstructs the
  // SAME origin the access token's `aud` was minted against. Without these, the
  // wrapped guard's origin resolver defaults the proto to https and the aud check
  // fails on an http dev origin → a valid Bearer 401s.
  it("forwards the baseUrl origin as x-forwarded-proto / x-forwarded-host", async () => {
    const captured: Captured[] = [];
    await dispatchTool(
      getTool,
      { id: "1" },
      {
        baseUrl: "http://localhost:4105",
        bearer: "t",
        fetchImpl: fakeFetch(200, {}, captured),
      },
    );
    const headers = captured[0].init.headers as Record<string, string>;
    expect(headers["x-forwarded-proto"]).toBe("http");
    expect(headers["x-forwarded-host"]).toBe("localhost:4105");
  });

  it("derives forwarded proto/host from an https origin with a default port", async () => {
    const captured: Captured[] = [];
    await dispatchTool(
      getTool,
      { id: "1" },
      {
        baseUrl: "https://menu.example.com",
        bearer: "t",
        fetchImpl: fakeFetch(200, {}, captured),
      },
    );
    const headers = captured[0].init.headers as Record<string, string>;
    expect(headers["x-forwarded-proto"]).toBe("https");
    expect(headers["x-forwarded-host"]).toBe("menu.example.com");
  });
});
