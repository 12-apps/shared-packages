import { describe, expect, it } from "vitest";

import { redactResponseBody, redactResponseSchema } from "./redact";

describe("redactResponseSchema", () => {
  const objectSchema = () => ({
    type: "object",
    properties: {
      id: { type: "string" },
      taxId: { type: "string" },
    },
    required: ["id", "taxId"],
  });

  it("returns the schema untouched when nothing is redacted", () => {
    const schema = objectSchema();
    expect(redactResponseSchema(schema, [])).toBe(schema);
  });

  it("drops the property AND its required entry", () => {
    const result = redactResponseSchema(objectSchema(), ["taxId"]);
    expect(result.properties).not.toHaveProperty("taxId");
    expect(result.required).toEqual(["id"]);
  });

  it("removes `required` entirely once its last entry is redacted", () => {
    const schema = {
      type: "object",
      properties: { taxId: { type: "string" } },
      required: ["taxId"],
    };
    expect(redactResponseSchema(schema, ["taxId"])).not.toHaveProperty("required");
  });

  it("does not mutate the caller's schema", () => {
    const schema = objectSchema();
    redactResponseSchema(schema, ["taxId"]);
    expect(schema.properties).toHaveProperty("taxId");
    expect(schema.required).toEqual(["id", "taxId"]);
  });

  it("addresses a field through an array wrapper, so `data.taxId` reaches rows", () => {
    const schema = {
      type: "object",
      properties: {
        data: { type: "array", items: objectSchema() },
      },
    };
    const result = redactResponseSchema(schema, ["data.taxId"]);
    const items = (result.properties as Record<string, { items: Record<string, unknown> }>).data
      .items;
    expect(items.properties).not.toHaveProperty("taxId");
    expect(items.required).toEqual(["id"]);
  });

  it("reaches into every union branch, so a .nullable() shape is redacted too", () => {
    const schema = {
      type: "object",
      properties: {
        data: { anyOf: [objectSchema(), { type: "null" }] },
      },
    };
    const result = redactResponseSchema(schema, ["data.taxId"]);
    const branches = (
      result.properties as Record<string, { anyOf: Array<Record<string, unknown>> }>
    ).data.anyOf;
    expect(branches[0]?.properties).not.toHaveProperty("taxId");
  });

  it("throws when a path names no field, naming the operation and the path", () => {
    expect(() => redactResponseSchema(objectSchema(), ["nope"], "listSuppliers")).toThrow(
      /listSuppliers.*"nope".*not a field/s,
    );
  });

  it("throws without an operationId too, rather than redacting nothing quietly", () => {
    expect(() => redactResponseSchema(objectSchema(), ["nope"])).toThrow(/"nope".*not a field/s);
  });

  it("leaves the schema and body halves agreeing on the same path list", () => {
    // The pair's whole point: what is advertised and what is returned are driven
    // by ONE list, so `structuredContent` cannot fail against its own schema.
    const paths = ["taxId"];
    const schema = redactResponseSchema(objectSchema(), paths);
    const body = redactResponseBody({ id: "s1", taxId: "123" }, paths) as Record<string, unknown>;
    expect(Object.keys(schema.properties as object)).toEqual(Object.keys(body));
  });
});

describe("redactResponseBody", () => {
  it("returns the body unchanged when nothing is redacted", () => {
    const body = { data: { id: "s1", taxId: "123" } };
    expect(redactResponseBody(body, undefined)).toBe(body);
    expect(redactResponseBody(body, [])).toBe(body);
  });

  it("strips a nested path without touching its siblings", () => {
    const body = { data: { id: "s1", name: "ACME", taxId: "123" } };
    expect(redactResponseBody(body, ["data.taxId"])).toEqual({
      data: { id: "s1", name: "ACME" },
    });
  });

  it("applies a path to every element when it lands on an array", () => {
    const body = {
      data: [
        { id: "s1", taxId: "1", postalCode: "01000-000" },
        { id: "s2", taxId: "2", postalCode: "02000-000" },
      ],
      pagination: { total: 2 },
    };
    expect(
      redactResponseBody(body, ["data.taxId", "data.postalCode"]),
    ).toEqual({ data: [{ id: "s1" }, { id: "s2" }], pagination: { total: 2 } });
  });

  it("does not mutate the caller's object", () => {
    const body = { data: { id: "s1", taxId: "123" } };
    redactResponseBody(body, ["data.taxId"]);
    expect(body.data.taxId).toBe("123");
  });

  it("ignores a path that does not exist in the body", () => {
    const body = { data: { id: "s1" } };
    expect(redactResponseBody(body, ["data.location.latitude"])).toEqual(body);
  });

  it("leaves non-object bodies alone", () => {
    expect(redactResponseBody(null, ["data.taxId"])).toBeNull();
    expect(redactResponseBody("plain", ["data.taxId"])).toBe("plain");
  });
});
