import { describe, expect, it } from "vitest";

import { discoverMigrations } from "../prisma/migration-files";

/**
 * Migration discovery must follow SYMLINKS.
 *
 * A package that owns part of the schema (`@12-apps/payments-backend`) contributes
 * its migrations as committed symlinks into `prisma/migrations`, because Prisma
 * has no cross-package import. The obvious filter — `readdirSync(..., {
 * withFileTypes: true })` + `Dirent.isDirectory()` — returns FALSE for a
 * symlink, so those migrations were silently skipped and the package's tables
 * never existed in any PGlite-backed run (e2e, the production API smoke).
 *
 * Nothing failed loudly: the schema was just quietly incomplete until something
 * queried those tables. That is the whole reason this is pinned against the
 * REAL migrations folder — a fixture would only prove the fixture.
 */
describe("migration discovery", () => {
  it("includes the migrations contributed as symlinks by the payments package", () => {
    const discovered = discoverMigrations();
    expect(discovered).toContain("20260725150000_payments_platform_core");
    expect(discovered).toContain("20260725160000_payments_oauth_connections");
  });

  it("replays in timestamp order, so a later migration never runs first", () => {
    const discovered = discoverMigrations();
    expect(discovered).toEqual([...discovered].sort());
    // The payments core table must exist before the OAuth columns are added.
    expect(discovered.indexOf("20260725150000_payments_platform_core")).toBeLessThan(
      discovered.indexOf("20260725160000_payments_oauth_connections"),
    );
  });

  it("returns only timestamped directories", () => {
    const discovered = discoverMigrations();
    expect(discovered.length).toBeGreaterThan(0);
    for (const name of discovered) expect(name).toMatch(/^\d{14}_/);
  });
});
