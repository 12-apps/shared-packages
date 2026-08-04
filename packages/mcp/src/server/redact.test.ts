import { describe, expect, it } from "vitest";

import { redactResponseBody } from "./redact";

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
