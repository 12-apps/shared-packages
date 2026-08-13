/* eslint-disable test-flakiness/no-unmocked-fs, test-flakiness/no-database-operations --
   the filesystem and the database ARE the subject here. This asserts that the prisma assets
   inside the PUBLISHED tarball apply to a real Postgres; mocking either would leave the
   suite checking a fixture instead of the artifact, which is the one thing it exists to
   check. Every path read is inside the installed package and the database is a fresh
   in-process PGlite per test. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

import { realtimeMigrations, realtimeMigrationSql } from '../src/realtime-db';

/**
 * `@12-apps/realtime`'s prisma assets survive publication — and, crucially, survive being
 * applied to a host that ALREADY has some shape of the table.
 *
 * Two ways this goes wrong, both silent. The migration can be missing from the tarball, in
 * which case a host's `prisma migrate deploy` finds nothing, reports success and creates no
 * tables. Or it can be present and apply only PARTIALLY: `CREATE TABLE IF NOT EXISTS` skips
 * the WHOLE table, so a host whose table predates a column adopts the migration, sees it
 * succeed, and never gets the column. That second failure was proven on PGlite against a
 * sibling package during the review of #156, which is why the per-column scenarios below
 * exist rather than a single "does it apply" case.
 */
const packageDir = fileURLToPath(new URL('../node_modules/@12-apps/realtime/', import.meta.url));

/** Every column of `realtime_outbox_events`, as Postgres reports them. */
async function columnsOf(db: PGlite): Promise<string[]> {
  const { rows } = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'realtime_outbox_events' ORDER BY column_name`,
  );
  return rows.map((row) => row.column_name);
}

async function applyAll(db: PGlite): Promise<void> {
  for (const name of realtimeMigrations()) await db.exec(realtimeMigrationSql(name));
}

describe('@12-apps/realtime — the prisma assets survive publication', () => {
  it('ships its schema partial', () => {
    // The host stitches this into its own schema; absent, the model the drain queries
    // simply does not exist.
    const partial = readFileSync(join(packageDir, 'prisma/realtime.prisma'), 'utf-8');
    expect(partial).toMatch(/model\s+RealtimeOutboxEvent/);
    expect(partial).toMatch(/@@map\("realtime_outbox_events"\)/);
  });

  it('ships at least one migration', () => {
    // Zero would make every apply test below vacuously green — the exact shape of the
    // failure this file exists to catch.
    expect(realtimeMigrations().length).toBeGreaterThan(0);
  });

  it('gives every migration a non-empty migration.sql', () => {
    const empty = realtimeMigrations().filter((name) => realtimeMigrationSql(name).trim() === '');
    expect(empty).toEqual([]);
  });

  it('applies every migration, in order, to a real Postgres', async () => {
    const db = new PGlite();
    try {
      for (const name of realtimeMigrations()) {
        // Named in the failure so a broken migration identifies itself.
        await expect(db.exec(realtimeMigrationSql(name)), `migration ${name}`).resolves.toBeDefined();
      }
    } finally {
      await db.close();
    }
  });

  it('creates every column the drain reads and writes', async () => {
    const db = new PGlite();
    try {
      await applyAll(db);
      expect(await columnsOf(db)).toEqual([
        'attempts',
        'claimed_at',
        'claimed_by',
        'created_at',
        'data',
        'id',
        'last_error',
        'published_at',
        'topic',
        'type',
      ]);
    } finally {
      await db.close();
    }
  });

  it('creates ONE composite index for both the drain and the purge', async () => {
    const db = new PGlite();
    try {
      await applyAll(db);
      const { rows } = await db.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'realtime_outbox_events'
           ORDER BY indexname`,
      );
      // `published_at` leads the composite, so an index on it alone is a redundant PREFIX:
      // nothing it could serve is unserved, and it costs a write amplification per insert.
      expect(rows.map((row) => row.indexname)).toEqual([
        'realtime_outbox_events_pkey',
        'realtime_outbox_events_published_at_created_at_idx',
      ]);
    } finally {
      await db.close();
    }
  });
});

describe('@12-apps/realtime — the migration is replay-safe PER COLUMN', () => {
  it('applies twice with no error and no change', async () => {
    const db = new PGlite();
    try {
      await applyAll(db);
      const before = await columnsOf(db);
      await applyAll(db);
      expect(await columnsOf(db)).toEqual(before);
    } finally {
      await db.close();
    }
  });

  it('adds every missing column to a host whose table predates the claim protocol', async () => {
    // THE review-156 HAZARD, reproduced. A host that rolled its own outbox — or ran an
    // earlier version of this package — has the table but not `claimed_at` / `claimed_by` /
    // `attempts`. A `CREATE TABLE IF NOT EXISTS` alone skips the whole table and the drain
    // then fails on an unknown column, or (with laxer code) publishes every row twice.
    const db = new PGlite();
    try {
      await db.exec(`
        CREATE TABLE "realtime_outbox_events" (
          "id" TEXT NOT NULL,
          "topic" TEXT NOT NULL,
          "type" TEXT NOT NULL,
          "data" JSONB NOT NULL DEFAULT '{}',
          "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "published_at" TIMESTAMP(3),
          CONSTRAINT "realtime_outbox_events_pkey" PRIMARY KEY ("id")
        );
      `);
      // And a row already in it, which is what makes a bare `ADD COLUMN … NOT NULL` fail.
      await db.query(
        `INSERT INTO realtime_outbox_events (id, topic, type) VALUES ($1, $2, $3)`,
        ['legacy-1', 'tenant:t-1:orders', 'orders.changed'],
      );

      await applyAll(db);

      expect(await columnsOf(db)).toContain('claimed_at');
      expect(await columnsOf(db)).toContain('claimed_by');
      expect(await columnsOf(db)).toContain('attempts');
      // The pre-existing row survives, with the new column's default.
      const { rows } = await db.query<{ id: string; attempts: number }>(
        `SELECT id, attempts FROM realtime_outbox_events`,
      );
      expect(rows).toEqual([{ id: 'legacy-1', attempts: 0 }]);
    } finally {
      await db.close();
    }
  });

  it('adds the event columns to a table that has only its primary key', async () => {
    // The other end of the same hazard: a table stripped down to `id`. Every column the
    // drain needs must appear, including the two NOT NULLs that carry no permanent default.
    const db = new PGlite();
    try {
      await db.exec(`
        CREATE TABLE "realtime_outbox_events" (
          "id" TEXT NOT NULL,
          CONSTRAINT "realtime_outbox_events_pkey" PRIMARY KEY ("id")
        );
      `);
      await applyAll(db);
      expect(await columnsOf(db)).toContain('topic');
      expect(await columnsOf(db)).toContain('type');
      // …and `topic` must end up with NO default, so a row that forgets it fails loudly
      // rather than committing an empty topic no drain can publish.
      const { rows } = await db.query<{ column_default: string | null }>(
        `SELECT column_default FROM information_schema.columns
           WHERE table_name = 'realtime_outbox_events' AND column_name = 'topic'`,
      );
      expect(rows[0]?.column_default).toBeNull();
    } finally {
      await db.close();
    }
  });

  it('leaves the indexes alone when a host already created them', async () => {
    const db = new PGlite();
    try {
      await applyAll(db);
      await expect(applyAll(db)).resolves.toBeUndefined();
    } finally {
      await db.close();
    }
  });
});
