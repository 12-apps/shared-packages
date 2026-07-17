import { describe, expect, it } from "vitest";

import { generateTools, type OpenApiDocument } from "./generate";

const doc: OpenApiDocument = {
  paths: {
    "/products/{id}": {
      get: {
        operationId: "getProduct",
        summary: "Fetch a product",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "include", in: "query", required: false, schema: { type: "string" } },
        ],
        responses: {
          "200": { content: { "application/json": { schema: { type: "object" } } } },
        },
        security: [{ bearerAuth: [] }],
      },
    },
    "/products": {
      post: {
        summary: "Create a product",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string" },
                  priceCents: { type: "integer" },
                },
              },
            },
          },
        },
      },
      get: {
        operationId: "listProducts",
        tags: ["internal"],
      },
    },
  },
};

describe("generateTools", () => {
  it("maps a GET operation with path + query params", () => {
    const tools = generateTools(doc);
    const get = tools.find((t) => t.name === "getProduct");
    expect(get).toBeDefined();
    expect(get?.method).toBe("GET");
    expect(get?.path).toBe("/products/{id}");
    expect(get?.mutating).toBe(false);
    expect(get?.description).toBe("Fetch a product");
    expect(get?.security).toEqual(["bearerAuth"]);
    // path param is required even though only query is marked optional
    expect(get?.inputSchema.required).toEqual(["id"]);
    expect(Object.keys(get?.inputSchema.properties as object)).toEqual(["id", "include"]);
    expect(get?.parameters.map((p) => `${p.in}:${p.name}`)).toEqual(["path:id", "query:include"]);
    expect(get?.bodyProps).toEqual([]);
    expect(get?.outputSchema).toEqual({ type: "object" });
  });

  it("flattens an object request body and records bodyProps + required", () => {
    const post = generateTools(doc).find((t) => t.path === "/products" && t.method === "POST");
    expect(post?.mutating).toBe(true);
    expect(post?.name).toBe("post_products"); // no operationId -> slug
    expect(post?.bodyProps).toEqual(["name", "priceCents"]);
    expect(post?.bodyIsWhole).toBe(false);
    expect(post?.inputSchema.required).toEqual(["name"]);
    expect(Object.keys(post?.inputSchema.properties as object)).toEqual(["name", "priceCents"]);
  });

  it("excludes operations by tag", () => {
    const names = generateTools(doc, { excludeTags: ["internal"] }).map((t) => t.name);
    expect(names).not.toContain("listProducts");
  });

  it("filters by method", () => {
    const methods = generateTools(doc, { includeMethods: ["get"] }).map((t) => t.method);
    expect(new Set(methods)).toEqual(new Set(["GET"]));
  });

  it("is deterministic across calls", () => {
    expect(generateTools(doc)).toEqual(generateTools(doc));
  });

  it("exposes a non-object body as a single verbatim property", () => {
    const wholeBodyDoc: OpenApiDocument = {
      paths: {
        "/raw": {
          post: {
            operationId: "postRaw",
            requestBody: { required: true, content: { "application/json": { schema: { type: "array" } } } },
          },
        },
      },
    };
    const tool = generateTools(wholeBodyDoc)[0];
    expect(tool.bodyIsWhole).toBe(true);
    expect(tool.bodyProps).toEqual([]);
    expect(tool.inputSchema.required).toEqual(["body"]);
    expect((tool.inputSchema.properties as Record<string, unknown>).body).toEqual({ type: "array" });
  });
});
