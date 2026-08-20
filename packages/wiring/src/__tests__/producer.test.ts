import { describe, expect, it } from "vitest";

import { assertDbMirror, defineManifest, defineServerManifest, defineWebManifest } from "../producer";
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

  it("accepts an isolated db and refuses the shapes Postgres or deploy would choke on", () => {
    const isolated = {
      mode: "isolated" as const,
      schema: "prisma/schema.prisma",
      migrations: "prisma/migrations",
      pgSchema: "delivery_notes",
    };
    expect(defineManifest({ ...base, db: isolated }).db).toBe(isolated);
    expect(() => defineManifest({ ...base, db: { ...isolated, schema: " " } })).toThrow(
      /db.schema must not be blank/,
    );
    expect(() => defineManifest({ ...base, db: { ...isolated, migrations: "" } })).toThrow(
      /must name its migrations folder/,
    );
    expect(() => defineManifest({ ...base, db: { ...isolated, pgSchema: "public" } })).toThrow(
      /must not be "public"/,
    );
    expect(() => defineManifest({ ...base, db: { ...isolated, pgSchema: "Has-Caps" } })).toThrow(
      /not a plain lowercase Postgres identifier/,
    );
  });
});

describe("assertDbMirror", () => {
  const composed = { partial: "prisma/x.prisma", migrations: "prisma/migrations" };
  const withDb = defineManifest({ ...base, db: composed });

  it("passes when package.json wiring.db matches, whatever the key order", () => {
    expect(() =>
      assertDbMirror(withDb, {
        name: base.name,
        wiring: { db: { migrations: "prisma/migrations", partial: "prisma/x.prisma" } },
      }),
    ).not.toThrow();
  });

  it("fails a missing mirror, a drifted mirror, and a mirror with no manifest half", () => {
    expect(() => assertDbMirror(withDb, { name: base.name })).toThrow(/must be mirrored/);
    expect(() =>
      assertDbMirror(withDb, { name: base.name, wiring: { db: { partial: "prisma/other.prisma" } } }),
    ).toThrow(/drifted from the manifest/);
    expect(() =>
      assertDbMirror(defineManifest(base), { name: base.name, wiring: { db: composed } }),
    ).toThrow(/manifest declares no db capability/);
    expect(() => assertDbMirror(defineManifest(base), { name: base.name })).not.toThrow();
  });

  it("refuses a package.json named for another package", () => {
    expect(() => assertDbMirror(withDb, { name: "@12-apps/other", wiring: { db: composed } })).toThrow(
      /must match/,
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
