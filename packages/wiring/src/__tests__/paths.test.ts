import { describe, expect, it } from "vitest";

import { findRouteConflicts, joinRoutePath, routeClaimKey, sortRoutes } from "../consumer";
import type { MountedRoute } from "..";

function mounted(packageName: string, method: "GET" | "POST", path: string): MountedRoute {
  return {
    packageName,
    mountPath: "/api/admin/:tenantSlug",
    route: { method, path, handle: () => Promise.resolve({ status: 200, body: null }) },
  };
}

describe("route paths", () => {
  it("joins mounts and package paths whatever the slashes", () => {
    expect(joinRoutePath("/api/", "/notes")).toBe("/api/notes");
    expect(joinRoutePath("/api", "notes")).toBe("/api/notes");
    expect(joinRoutePath("", "")).toBe("/");
  });

  it("equates params in the claim key, whatever they are called", () => {
    expect(routeClaimKey("GET", "/a/:id/b")).toBe(routeClaimKey("GET", "/a/:key/b"));
    expect(routeClaimKey("GET", "/a/:id")).not.toBe(routeClaimKey("POST", "/a/:id"));
  });

  it("sorts static segments before params, and a path before its own prefix", () => {
    const ordered = sortRoutes([
      mounted("a", "GET", "/notes"),
      mounted("a", "GET", "/notes/:id"),
      mounted("a", "GET", "/notes/drafts"),
    ]).map((entry) => entry.route.path);
    expect(ordered).toEqual(["/notes/drafts", "/notes/:id", "/notes"]);
  });

  it("finds a claim two packages both make", () => {
    const conflicts = findRouteConflicts([mounted("a", "GET", "/notes"), mounted("b", "GET", "/notes")]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.packages).toEqual(["a", "b"]);
  });
});
