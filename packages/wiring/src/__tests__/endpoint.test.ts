import { describe, expect, it } from "vitest";

import type { MountedRoute, WireResponse, WireRoute } from "../contract/http";
import {
  createWireRouteTable,
  forwardWireParams,
  parseWireRouteKey,
  wireResponse,
} from "../consumer/endpoint";

/**
 * The endpoint-adapter mechanics, pinned once here instead of eleven times
 * in a host: the lookup-or-throw, the wire-param flattening and the
 * `{status, body}` → `Response` rules these primitives replace were each
 * copied per adapter, and each copy was one more place for a subtle
 * divergence (the `undefined`-vs-`null` 204, the "undefined" string, the
 * silent miss) to creep in.
 */

function route(method: WireRoute<never>["method"], path: string): WireRoute<never> {
  return { method, path, handle: async () => ({ status: 200, body: {} }) };
}

describe("parseWireRouteKey", () => {
  it("splits a claim into its method and path", () => {
    expect(parseWireRouteKey("GET /reports/custom/:id")).toEqual({
      method: "GET",
      path: "/reports/custom/:id",
    });
  });

  it("refuses a method the contract does not know, and a missing path", () => {
    // A typo fails the first test that imports the file, not the first
    // caller in production.
    expect(() => parseWireRouteKey("FETCH /x")).toThrow(/not a wire route key/);
    expect(() => parseWireRouteKey("GET")).toThrow(/not a wire route key/);
    expect(() => parseWireRouteKey("GET x")).toThrow(/not a wire route key/);
  });
});

describe("createWireRouteTable", () => {
  it("resolves raw descriptors and throws a package-named miss", () => {
    const table = createWireRouteTable("@12-apps/report-builder", [
      route("GET", "/reports/custom"),
      route("POST", "/reports/custom"),
    ]);
    expect(table.route("POST", "/reports/custom").method).toBe("POST");
    expect(() => table.route("DELETE", "/reports/custom")).toThrow(
      "No @12-apps/report-builder route for DELETE /reports/custom",
    );
  });

  it("takes the consumer's MountedRoutes and keys by the RELATIVE path", () => {
    // The mount prefix is accounting; the descriptor a route file delegates
    // to keeps its package-relative path.
    const mounted: MountedRoute = {
      packageName: "@12-apps/report-builder",
      mountPath: "/api/admin/:tenantSlug",
      route: route("GET", "/reports/fields"),
    };
    const table = createWireRouteTable("@12-apps/report-builder", [mounted]);
    expect(table.route("GET", "/reports/fields").path).toBe("/reports/fields");
  });
});

describe("forwardWireParams", () => {
  it("coerces every present value to its string form and keeps absence", () => {
    expect(forwardWireParams({ id: 7, active: false, note: undefined })).toEqual({
      id: "7",
      active: "false",
      note: undefined,
    });
  });

  it("drops the host's routing-only keys and answers {} for no values", () => {
    expect(
      forwardWireParams({ tenantSlug: "acme", id: "s1" }, { drop: ["tenantSlug"] }),
    ).toEqual({ id: "s1" });
    expect(forwardWireParams(undefined)).toEqual({});
  });
});

describe("wireResponse", () => {
  it("passes the package's envelope through as JSON, unwrapped", async () => {
    const answered: WireResponse = { status: 201, body: { data: { id: "r1" } } };
    const response = wireResponse(answered);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ data: { id: "r1" } });
  });

  it("answers a bodyless 204 with no bytes at all", async () => {
    // `undefined` means no body — not `null`, whose four serialized bytes
    // would contradict a status that promises none.
    const response = wireResponse({ status: 204, body: undefined });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it("serializes an explicit null body, which is a value, not absence", async () => {
    const response = wireResponse({ status: 200, body: null });
    expect(await response.text()).toBe("null");
  });
});
