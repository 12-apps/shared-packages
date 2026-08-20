import { describe, expect, it } from "vitest";

import { defineManifest, defineServerManifest, defineWebManifest } from "../producer";
import { WiringDefinitionError } from "../errors";
import { notesManifest } from "./fixture-package";

const base = { name: "@12-apps/example", contract: 1 as const };

describe("defineManifest", () => {
  it("returns a valid manifest unchanged", () => {
    expect(defineManifest(base)).toBe(base);
    expect(notesManifest.name).toBe("@12-apps/delivery-notes");
  });

  it("refuses a blank name", () => {
    expect(() => defineManifest({ ...base, name: " " })).toThrow(WiringDefinitionError);
  });

  it("refuses an unknown contract version", () => {
    expect(() => defineManifest({ ...base, contract: 2 as unknown as 1 })).toThrow(
      /unknown contract version 2/,
    );
  });

  it("refuses a permission id with no domain segment", () => {
    expect(() =>
      defineManifest({
        ...base,
        permissions: { source: "x", ids: ["manage"], permissions: { manage: { kind: "class" } } },
      }),
    ).toThrow(/no domain segment/);
  });

  it("refuses a listed permission id with no spec, and a spec never listed", () => {
    expect(() =>
      defineManifest({
        ...base,
        permissions: { source: "x", ids: ["a:b"], permissions: {} },
      }),
    ).toThrow(/listed but has no spec/);
    expect(() =>
      defineManifest({
        ...base,
        permissions: {
          source: "x",
          ids: ["a:b"],
          permissions: { "a:b": { kind: "class" }, "a:c": { kind: "class" } },
        },
      }),
    ).toThrow(/not listed in ids/);
  });

  it("refuses duplicate notification types", () => {
    const blueprint = { type: "a.b", category: "orders", generate: () => ({ title: "t", body: "b" }) };
    expect(() => defineManifest({ ...base, notifications: [blueprint, blueprint] })).toThrow(
      /duplicate notification type/,
    );
  });

  it("refuses duplicate MCP operation ids and relative paths", () => {
    const endpoint = { operationId: "op", method: "GET" as const, path: "/x", summary: "s" };
    expect(() => defineManifest({ ...base, mcp: { endpoints: [endpoint, endpoint] } })).toThrow(
      /duplicate MCP operationId/,
    );
    expect(() =>
      defineManifest({ ...base, mcp: { endpoints: [{ ...endpoint, path: "x" }] } }),
    ).toThrow(/must start with "\/"/);
  });

  it("refuses a db partial that is not a .prisma file", () => {
    expect(() => defineManifest({ ...base, db: { partial: "prisma/x.sql" } })).toThrow(
      /must point at a .prisma file/,
    );
  });
});

describe("defineServerManifest", () => {
  const shared = defineManifest({ ...base, server: ["http"] });

  it("refuses a name mismatch", () => {
    expect(() =>
      defineServerManifest(shared, { name: "@12-apps/other", http: { create: () => ({ routes: [] }) } }),
    ).toThrow(/must match/);
  });

  it("refuses inventory drift in both directions", () => {
    expect(() => defineServerManifest(shared, { name: shared.name })).toThrow(
      /lists "http" but the server manifest omits it/,
    );
    const wide = defineManifest({ ...base });
    expect(() =>
      defineServerManifest(wide, { name: wide.name, http: { create: () => ({ routes: [] }) } }),
    ).toThrow(/the shared inventory omits it/);
  });

  it("refuses a dotted jobs namespace and duplicate blueprint names", () => {
    const withJobs = defineManifest({ ...base, server: ["jobs"] });
    const blueprint = {
      name: "sweep",
      handle: () => Promise.resolve(),
    };
    expect(() =>
      defineServerManifest(withJobs, {
        name: withJobs.name,
        jobs: { namespace: "a.b", blueprints: { sweep: blueprint } },
      }),
    ).toThrow(/must not contain dots/);
    expect(() =>
      defineServerManifest(withJobs, {
        name: withJobs.name,
        jobs: { namespace: "notes", blueprints: { one: blueprint, two: blueprint } },
      }),
    ).toThrow(/duplicate job blueprint name/);
  });
});

describe("defineWebManifest", () => {
  it("refuses a nav row pointing at an undeclared route", () => {
    const shared = defineManifest({ ...base, web: ["areas"] });
    expect(() =>
      defineWebManifest(shared, {
        name: shared.name,
        areas: [{ area: "admin", routes: [{ path: "a", screen: "A" }], nav: [{ testId: "x", path: "b" }] }],
      }),
    ).toThrow(/undeclared route "b"/);
  });
});
