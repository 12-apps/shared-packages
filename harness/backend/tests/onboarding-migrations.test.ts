/* eslint-disable test-flakiness/no-unmocked-fs, test-flakiness/no-database-operations --
   the filesystem and the database ARE the subject: this asserts that the assets
   inside the PUBLISHED @12-apps/onboarding tarball apply to a real Postgres. Every
   path read is inside the installed package and the database is a fresh in-process
   PGlite per test. */
/* eslint-disable test-flakiness/no-test-isolation -- `db` is a PARAMETER handed to
   each case by `withMigrated`, which opens one database per case and closes it in a
   finally; the rule matches the identifier across the file rather than its scope. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

/**
 * @12-apps/onboarding ships its model AND its migration (12-23), and a host
 * applies them — the same contract `rbac-migrations.test.ts` pins for RBAC.
 *
 * The property with teeth is REPLAYABILITY: the origin host already has this table, so
 * adoption must be a no-op rather than a failed deploy. Every statement in the
 * migration is guarded, and the second-apply case below is what keeps it that way.
 */
const onboardingPackage = fileURLToPath(
  new URL('../node_modules/@12-apps/onboarding/', import.meta.url),
);
const migrationsDir = join(onboardingPackage, 'prisma/migrations');

/** Applied in name order, which is the order Prisma applies them. */
function migrations(): string[] {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function sqlOf(name: string): string {
  return readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf-8');
}

/**
 * Run `body` against a freshly migrated database, and close it whichever way the
 * body ends.
 *
 * The database arrives as an ARGUMENT rather than as a local in each case: one
 * per test is what keeps them order-independent, and passing it in is what makes
 * that visible instead of relying on every case remembering its own teardown.
 */
async function withMigrated(body: (db: PGlite) => Promise<void>): Promise<void> {
  const db = new PGlite();
  try {
    for (const name of migrations()) await db.exec(sqlOf(name));
    await body(db);
  } finally {
    await db.close();
  }
}

describe('@12-apps/onboarding — the prisma assets survive publication', () => {
  it('ships the schema partial with the owned model', () => {
    const partial = readFileSync(join(onboardingPackage, 'prisma/onboarding.prisma'), 'utf-8');
    expect(partial).toMatch(/model\s+OnboardingState\s/);
    expect(partial).toContain('@@map("onboarding_states")');
    // By-value scalars, no relations: the package cannot know the name of a
    // host's user or tenant model, and a partial that named one would not apply.
    expect(partial).not.toMatch(/@relation/);
  });

  it('ships the prisma:sync script the adoption contract names', () => {
    // ADOPTING.md tells a host to run the package's own sync script; a `files`
    // list that drops `scripts/` turns that instruction into MODULE_NOT_FOUND on
    // every real install (it works in a workspace, which is the trap).
    const script = readFileSync(
      join(onboardingPackage, 'scripts/sync-onboarding-schema.mjs'),
      'utf-8',
    );
    expect(script).toContain('onboarding.prisma');
  });

  it('ships at least one non-empty migration', () => {
    expect(migrations().length).toBeGreaterThan(0);
    const empty = migrations().filter((name) => sqlOf(name).trim().length === 0);
    expect(empty).toEqual([]);
  });

  it('creates the table, its upsert key and its reach-out index', async () => {
    await withMigrated(async (db) => {
      const { rows: tables } = await db.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
      );
      expect(tables.map((row) => row.table_name)).toContain('onboarding_states');

      const { rows: indexes } = await db.query<{ indexname: string }>(
        "SELECT indexname FROM pg_indexes WHERE tablename = 'onboarding_states'",
      );
      const names = indexes.map((row) => row.indexname);
      expect(names).toContain('onboarding_states_user_id_client_id_feature_key_key');
      expect(names).toContain('onboarding_states_client_id_feature_key_status_idx');
    });
  });

  it('enforces one row per (user, tenant, feature)', async () => {
    await withMigrated(async (db) => {
      await db.query(
        `INSERT INTO onboarding_states (id, user_id, client_id, feature_key, updated_at)
         VALUES ('o1', 'u1', 't1', 'ai_integration', NOW())`,
      );
      await expect(
        db.query(
          `INSERT INTO onboarding_states (id, user_id, client_id, feature_key, updated_at)
           VALUES ('o2', 'u1', 't1', 'ai_integration', NOW())`,
        ),
      ).rejects.toThrow(/unique|duplicate/i);
      // The same user on another tenant is a different row — the isolation the
      // key exists for.
      await db.query(
        `INSERT INTO onboarding_states (id, user_id, client_id, feature_key, updated_at)
         VALUES ('o3', 'u1', 't2', 'ai_integration', NOW())`,
      );
    });
  });

  it("enforces the package's own status domain in the database", async () => {
    await withMigrated(async (db) => {
      await expect(
        db.query(
          `INSERT INTO onboarding_states (id, user_id, client_id, feature_key, status, updated_at)
           VALUES ('o1', 'u1', 't1', 'ai_integration', 'almost_done', NOW())`,
        ),
      ).rejects.toThrow(/check|constraint/i);
    });
  });

  it('replays into a schema that already has the table', async () => {
    // the origin host's case exactly: adoption must change nothing rather than fail.
    await withMigrated(async (db) => {
      for (const name of migrations()) {
        await expect(db.exec(sqlOf(name)), `replay ${name}`).resolves.toBeDefined();
      }
    });
  });
});
