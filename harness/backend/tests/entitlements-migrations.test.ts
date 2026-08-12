/* eslint-disable test-flakiness/no-unmocked-fs, test-flakiness/no-database-operations --
   the filesystem and the database ARE the subject here: this asserts that the
   prisma assets inside the PUBLISHED tarball apply to a real Postgres. See
   migrations.test.ts for the full rationale. */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

/**
 * `@12-apps/entitlements` owns one table — `retention_watermarks`, the
 * "downgrade never deletes" anchor — and ships it as a schema partial plus
 * migrations. Both failure modes this guards are silent: assets missing from
 * the tarball make the host's `migrate deploy` report success over nothing,
 * and present-but-broken SQL surfaces during a deploy instead of here.
 */
const entitlements = fileURLToPath(
  new URL('../node_modules/@12-apps/entitlements/', import.meta.url),
);
const migrationsDir = join(entitlements, 'prisma/migrations');

/** Applied in name order, which is the order Prisma applies them. */
function migrations() {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

describe('@12-apps/entitlements — the prisma assets survive publication', () => {
  it('ships its schema partial, self-contained (no host FK)', () => {
    const partial = readFileSync(join(entitlements, 'prisma/entitlements.prisma'), 'utf-8');
    expect(partial).toMatch(/model\s+RetentionWatermark/);
    // The payments doctrine: tenant scoping is a plain column, never a
    // relation into a table this package cannot know.
    expect(partial).not.toMatch(/@relation/);
  });

  it('ships the coverage gate script beside the code', () => {
    // The host's `entitlements:coverage` becomes a call into this file; a
    // tarball without it strands the CI gate on the vendored copy forever.
    const script = readFileSync(
      join(entitlements, 'scripts/entitlements-coverage.mjs'),
      'utf-8',
    );
    expect(script).toContain('withEntitlement');
  });

  it('applies every migration, in order, to a real Postgres', async () => {
    expect(migrations().length).toBeGreaterThan(0);
    const db = new PGlite();
    try {
      for (const name of migrations()) {
        const sql = readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf-8');
        await expect(db.exec(sql), `migration ${name}`).resolves.toBeDefined();
      }
      const { rows } = await db.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
      );
      expect(rows.map((row) => row.table_name)).toContain('retention_watermarks');
    } finally {
      await db.close();
    }
  });
});
