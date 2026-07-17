import { describe, expect, it } from "vitest";

import { inlineSchemaRefs, UnsupportedSchemaError } from "./refs";

describe("inlineSchemaRefs", () => {
  it("returns a flat schema structurally unchanged (no-op)", () => {
    const flat = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { data: { type: "array", items: { type: "string" } } },
      required: ["data"],
      additionalProperties: false,
    };
    expect(inlineSchemaRefs(flat)).toEqual(flat);
  });

  it("inlines a $defs reference and drops the $defs container", () => {
    const schema = {
      type: "object",
      properties: { card: { $ref: "#/$defs/Card" } },
      $defs: {
        Card: { type: "object", properties: { last4: { type: "string" } } },
      },
    };
    expect(inlineSchemaRefs(schema)).toEqual({
      type: "object",
      properties: { card: { type: "object", properties: { last4: { type: "string" } } } },
    });
  });

  it("resolves diamond reuse (same def on sibling branches) without a cycle error", () => {
    const schema = {
      type: "object",
      properties: {
        a: { $ref: "#/$defs/Widget" },
        b: { $ref: "#/$defs/Widget" },
      },
      $defs: { Widget: { type: "object", properties: { x: { type: "string" } } } },
    };
    const inlined = inlineSchemaRefs(schema) as {
      properties: { a: unknown; b: unknown };
    };
    expect(inlined.properties.a).toEqual({ type: "object", properties: { x: { type: "string" } } });
    expect(inlined.properties.a).toEqual(inlined.properties.b);
  });

  it("supports #/definitions and #/components/schemas pointers", () => {
    const legacy = {
      type: "object",
      properties: { v: { $ref: "#/definitions/V" } },
      definitions: { V: { type: "number" } },
    };
    expect(inlineSchemaRefs(legacy)).toEqual({
      type: "object",
      properties: { v: { type: "number" } },
    });
  });

  it("throws on a recursive schema", () => {
    const recursive = {
      type: "object",
      properties: { child: { $ref: "#/$defs/Node" } },
      $defs: {
        Node: { type: "object", properties: { next: { $ref: "#/$defs/Node" } } },
      },
    };
    expect(() => inlineSchemaRefs(recursive)).toThrow(UnsupportedSchemaError);
    expect(() => inlineSchemaRefs(recursive)).toThrow(/Recursive schema not supported: Node/);
  });

  it("throws on an unresolved reference", () => {
    expect(() => inlineSchemaRefs({ $ref: "#/$defs/Missing" })).toThrow(/Unresolved \$ref/);
  });

  it("throws on an unsupported (external) pointer", () => {
    expect(() => inlineSchemaRefs({ $ref: "https://example.com/schema.json" })).toThrow(
      /Unsupported \$ref pointer/,
    );
  });
});
