import { describe, expect, it } from "vitest";

import { assertCatalog, createFlagReader, FeatureFlagsError } from "../index";
import { fakeDb } from "./fake-db";

const CATALOG = [
  { key: "delivery-beta", label: "Delivery (beta)" },
  { key: "novo-dashboard", label: "Novo dashboard" },
] as const;

describe("createFlagReader", () => {
  it("returns only ENABLED grants for CATALOG keys — the veil fails closed", async () => {
    const { db } = fakeDb([
      { userId: "u1", flagKey: "delivery-beta" },
      { userId: "u1", flagKey: "novo-dashboard", enabled: false },
      { userId: "u1", flagKey: "retired-flag" },
      { userId: "u2", flagKey: "novo-dashboard" },
    ]);
    const reader = createFlagReader({ db: () => Promise.resolve(db), catalog: CATALOG });
    const flags = await reader.flagsFor("u1");
    // The explicit opt-out and the orphaned key are both invisible here: a
    // disabled row must survive a default-on rollout, and a retired key must
    // stop gating the moment it leaves the catalog.
    expect([...flags].sort()).toEqual(["delivery-beta"]);
    expect(await reader.isEnabled("u2", "novo-dashboard")).toBe(true);
    expect(await reader.isEnabled("u2", "delivery-beta")).toBe(false);
  });

  it("answers an empty set for a blank user without touching the database", async () => {
    const reader = createFlagReader({
      db: () => Promise.reject(new Error("must not be called")),
      catalog: CATALOG,
    });
    expect((await reader.flagsFor("")).size).toBe(0);
    expect((await reader.flagsFor("   ")).size).toBe(0);
  });

  it("refuses a malformed catalog at the factory call", () => {
    expect(() => createFlagReader({ db: () => Promise.reject(new Error("n/a")), catalog: [{ key: "Bad Key", label: "x" }] })).toThrow(
      FeatureFlagsError,
    );
  });
});

describe("assertCatalog", () => {
  it("accepts the empty catalog — 'no beta running' is a complete configuration", () => {
    expect(() => assertCatalog([])).not.toThrow();
  });

  it("refuses duplicates, blank labels and non-kebab keys, naming the entry", () => {
    expect(() => assertCatalog([{ key: "a", label: "A" }, { key: "a", label: "B" }])).toThrow(
      /duplicate flag key "a"/,
    );
    expect(() => assertCatalog([{ key: "ok", label: "  " }])).toThrow(/blank label/);
    expect(() => assertCatalog([{ key: "Não", label: "x" }])).toThrow(/not kebab-case/);
  });

  it("reserves 'users' — the management surface's own route segment", () => {
    expect(() => assertCatalog([{ key: "users", label: "x" }])).toThrow(/reserved/);
  });
});
