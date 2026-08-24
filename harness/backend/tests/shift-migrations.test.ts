/* eslint-disable test-flakiness/no-unmocked-fs, test-flakiness/no-database-operations --
   the filesystem and the database ARE the subject: this asserts that the
   migrations inside the PUBLISHED @12-apps/shift tarball apply to a real
   Postgres. Every path read is inside the installed package and the database is
   a fresh in-process PGlite per test. */
/* eslint-disable test-flakiness/no-test-isolation -- the handle these cases use
   is a per-case LOCAL: `withMigratedDb` opens a PGlite, hands it to one case and
   closes it in a `finally`, so no two cases can ever see the same database.
   That is the isolation the rule asks for; its heuristic simply cannot follow a
   handle through a callback parameter and reads every `db.query` as a reference
   to shared state. Holding the database in a module-scoped `let` instead — what
   the rule's message suggests — is the arrangement this file deliberately does
   NOT use, and is strictly worse here: one of these cases deletes a row the
   package's trigger normally protects. */
/**
 * `@12-apps/shift` ships two models and three migrations, and a host applies
 * them — the same contract `rbac-migrations.test.ts` pins for rbac, asserted
 * against the shift tarball.
 *
 * Two of the cases are not ceremony. The package's protection is a TRIGGER and
 * a set of CHECK constraints rather than anything in TypeScript, so they only
 * exist if the migration created them; and the third migration exists purely to
 * retire a constraint that named the origin host's staff structure, which is a
 * property that can only be observed by applying the folder in order.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

const shiftPackage = fileURLToPath(new URL('../node_modules/@12-apps/shift/', import.meta.url));
const migrationsDir = join(shiftPackage, 'prisma/migrations');

/** Applied in name order, which is the order Prisma applies them. */
function migrations(): string[] {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * A database of its own, per case, with every migration already applied.
 *
 * Opened INSIDE the callback rather than held in a `let` across the suite: a
 * module-scoped handle is shared mutable state, and these cases each leave a
 * different schema behind (one of them deletes a row a trigger normally
 * protects). `rbac-migrations.test.ts` opens its own the same way.
 */
async function withMigratedDb(work: (db: PGlite) => Promise<void>): Promise<void> {
  const db = new PGlite();
  await db.waitReady;
  try {
    for (const name of migrations()) {
      await db.exec(readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf-8'));
    }
    await work(db);
  } finally {
    await db.close();
  }
}

/** Every table the public schema holds, in name order. */
async function tableNames(db: PGlite): Promise<string[]> {
  const result = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name`,
  );
  return result.rows.map((row) => row.table_name);
}

/** Columns every case names, so no case has to spell the full INSERT. */
const BASE_SHIFT = { client_id: 'c1', user_id: 'u1', kind: 'desk' } as const;

/**
 * One shift row, built from fields.
 *
 * A helper rather than seven literal INSERTs: what each case is ABOUT is the
 * one or two columns it varies, and a wall of identical SQL buries that.
 */
function insertShift(pg: PGlite, row: Record<string, string | null>): Promise<unknown> {
  const fields = { ...BASE_SHIFT, ...row };
  const names = Object.keys(fields);
  const values = names.map((name) => {
    const value = fields[name as keyof typeof fields];
    return value === 'now()' || value === null ? String(value) : `'${String(value)}'`;
  });
  return pg.query(
    `INSERT INTO shifts (${names.join(', ')}) VALUES (${values.join(', ')})`,
  );
}

describe('the prisma assets survive publication', () => {
  it('ships the partial and a non-empty migration folder', () => {
    const partial = readFileSync(join(shiftPackage, 'prisma/shift.prisma'), 'utf-8');
    expect(partial).toMatch(/model\s+Shift\s/);
    expect(partial).toContain('@@map("shifts")');
    expect(partial).toMatch(/model\s+ShiftTenantConfig\s/);
    expect(migrations().length).toBeGreaterThan(0);
  });

  it('applies every migration, in order, to a real Postgres', async () => {
    await withMigratedDb(async (db) => {
      const tables = await tableNames(db);
      expect(tables).toContain('shifts');
      expect(tables).toContain('shift_tenant_configs');

      // What the package ships and what it does NOT: `resource_assignments` is
      // the host's, which is the whole shape of this adoption. A migration that
      // started creating it would take the host's own table over silently.
      expect(tables).not.toContain('resource_assignments');
    });
  });
});

describe('what the migrations protect', () => {
  it('holds a closed shift immutable, and lets a host delete one', async () => {
    await withMigratedDb(async (db) => {
      await insertShift(db, {
        id: 's1',
        started_at: 'now()',
        ended_at: 'now()',
        ended_reason: 'user',
        ended_by_user_id: 'u1',
      });

      // What the trigger protects: a closed shift is a finished work record, so
      // it cannot be edited afterwards.
      await expect(db.query(`UPDATE shifts SET kind = 'stacks' WHERE id = 's1'`)).rejects.toThrow(
        /immutable/i,
      );

      // What it deliberately does NOT protect, since FUT-446 narrowed it to
      // UPDATE. `client_id` is a by-value tenant reference with no foreign key
      // — that is what keeps the package host-agnostic — so a host that drops a
      // tenant and sweeps the by-value tables by `client_id` has to be able to
      // remove the row. An unconditional DELETE guard wedged exactly that.
      await expect(db.query(`DELETE FROM shifts WHERE id = 's1'`)).resolves.toBeDefined();
    });
  });

  it('refuses to move an open shift identity or its resource snapshot', async () => {
    await withMigratedDb(async (db) => {
      await insertShift(db, {
        id: 's7',
        started_at: 'now()',
        resource_assignment_id: 'a1',
        resource_type: 'desk',
        resource_id: 'desk-front',
      });

      // The half of the guard that survives on an OPEN shift: who is working,
      // at what, on which desk are all settled when it opens. Only the closing
      // columns may still move.
      await expect(db.query(`UPDATE shifts SET user_id = 'u2' WHERE id = 's7'`)).rejects.toThrow(
        /immutable/i,
      );
      await expect(
        db.query(`UPDATE shifts SET resource_id = 'desk-back' WHERE id = 's7'`),
      ).rejects.toThrow(/immutable/i);
    });
  });

  it('refuses a closed shift that names no closer, unless it closed itself', async () => {
    await withMigratedDb(async (db) => {
      // `auto` is the one reason that may carry a NULL closer — nobody closed
      // it, the window did. Every other reason must name somebody, and the
      // CHECK is where that holds rather than in any host's validation.
      const closedBy = (id: string, reason: string): Promise<unknown> =>
        insertShift(db, { id, started_at: 'now()', ended_at: 'now()', ended_reason: reason });

      await expect(closedBy('s2', 'user')).rejects.toThrow(/end_state_check/);
      await expect(closedBy('s3', 'auto')).resolves.toBeDefined();
    });
  });

  it('refuses half a resource snapshot', async () => {
    await withMigratedDb(async (db) => {
      // All three columns or none. `shift-rows.ts` maps them independently,
      // which is only safe because this constraint means there is no state
      // where one is set and another is not.
      await expect(
        insertShift(db, { id: 's4', started_at: 'now()', resource_id: 'desk-front' }),
      ).rejects.toThrow(/resource_snapshot_check/);
    });
  });

  it('retires the origin host staff vocabulary by the last migration', async () => {
    await withMigratedDb(async (db) => {
      // The first migration constrained `kind` to ('kitchen', 'service') — one
      // application's staff structure, in a CHECK. The third drops it and asks
      // only for a non-empty string, which is what let this harness declare a
      // library's kinds. Applying the folder IN ORDER is the only way to see it.
      await expect(
        insertShift(db, { id: 's5', kind: 'stacks', started_at: 'now()' }),
      ).resolves.toBeDefined();

      await expect(
        insertShift(db, { id: 's6', kind: '  ', started_at: 'now()' }),
      ).rejects.toThrow(/kind_present_check/);
    });
  });
});
