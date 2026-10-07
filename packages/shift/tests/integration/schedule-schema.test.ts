import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = resolve(import.meta.dirname, '../../prisma/migrations');

async function applyMigrations(target: PGlite): Promise<void> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory() && /^\d/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  for (const dir of dirs) {
    await target.exec(await readFile(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8'));
  }
}

let db: PGlite;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE "clients" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "users" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "resource_assignments" (
      "id" TEXT PRIMARY KEY,
      "user_id" TEXT NOT NULL,
      "client_id" TEXT NOT NULL,
      "resource_type" TEXT NOT NULL,
      "resource_id" TEXT NOT NULL,
      "valid_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "valid_to" TIMESTAMP(3)
    );
  `);
  await applyMigrations(db);
});

afterEach(async () => {
  await db.close();
});

const WARD_DAY = `'ward', '2026-10-21T09:00:00Z', '2026-10-21T17:00:00Z'`;
const FULL_DAY = `'ward', '2026-10-21T09:00:00Z', '2026-10-22T09:00:00Z'`;

const COLUMNS = `("id", "client_id", "user_id", "kind", "starts_at", "ends_at", "created_by_user_id"`;

function insert(id: string, values: string, extraColumns = '', extraValues = ''): Promise<unknown> {
  return db.exec(`
    INSERT INTO "shift_slots" ${COLUMNS}${extraColumns})
    VALUES ('${id}', 'tenant-a', 'nurse-1', ${values}, 'head-1'${extraValues});
  `);
}

async function count(): Promise<number> {
  const result = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM "shift_slots"`);
  return result.rows[0]?.n ?? 0;
}

describe('shift_slots schema', () => {
  it('stores a slot, with the canceled state and a series', async () => {
    await insert('slot-a', WARD_DAY);
    await insert(
      'slot-b',
      `'ward', '2026-10-22T09:00:00Z', '2026-10-22T17:00:00Z'`,
      `, "series_id", "canceled_at", "canceled_by_user_id", "cancel_reason"`,
      `, 'series-1', CURRENT_TIMESTAMP, 'head-1', 'absence'`,
    );
    const rows = await db.query<{ id: string }>(`SELECT "id" FROM "shift_slots" ORDER BY "starts_at"`);
    expect(rows.rows.map((row) => row.id)).toEqual(['slot-a', 'slot-b']);
  });

  it.each([
    ['a blank kind', `'  ', '2026-10-21T09:00:00Z', '2026-10-21T17:00:00Z'`, 'shift_slots_kind_present_check'],
    ['an end at the start', `'ward', '2026-10-21T09:00:00Z', '2026-10-21T09:00:00Z'`, 'shift_slots_time_order_check'],
    ['a slot over a day', `'ward', '2026-10-21T09:00:00Z', '2026-10-22T09:01:00Z'`, 'shift_slots_max_length_check'],
  ])('refuses %s', async (_, values, constraint) => {
    await expect(insert('bad', values)).rejects.toThrow(new RegExp(constraint));
  });

  it('allows exactly 24 hours', async () => {
    await insert('day', FULL_DAY);
    expect(await count()).toBe(1);
  });

  it('refuses who-and-why on a live slot, and half a resource', async () => {
    await expect(
      insert('bad', WARD_DAY, `, "cancel_reason"`, `, 'absence'`),
    ).rejects.toThrow(/shift_slots_cancel_state_check/);
    await expect(
      insert('bad', WARD_DAY, `, "resource_type"`, `, 'ward'`),
    ).rejects.toThrow(/shift_slots_resource_pair_check/);
  });

  it('lets a sweep cancel with no user', async () => {
    await insert('swept', WARD_DAY, `, "canceled_at"`, `, CURRENT_TIMESTAMP`);
    expect(await count()).toBe(1);
  });

  it('names no kind in any constraint', async () => {
    const result = await db.query<{ definition: string }>(`
      SELECT pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
       WHERE conrelid = '"shift_slots"'::regclass AND contype = 'c';
    `);
    const kindChecks = result.rows.map(({ definition }) => definition).filter((d) => /\bkind\b/.test(d));
    expect(kindChecks).toHaveLength(1);
    expect(kindChecks[0]).toMatch(/btrim\(kind\)/);
  });
});
