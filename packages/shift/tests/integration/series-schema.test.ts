import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = resolve(import.meta.dirname, '../../prisma/migrations');
const SERIES_MIGRATION = '20261027120000_shift_slot_series';

async function migrationDirs(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && /^\d/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function apply(target: PGlite, dirs: readonly string[]): Promise<void> {
  for (const dir of dirs) await target.exec(await readFile(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8'));
}

let db: PGlite;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE "resource_assignments" (
      "id" TEXT PRIMARY KEY, "user_id" TEXT NOT NULL, "client_id" TEXT NOT NULL,
      "resource_type" TEXT NOT NULL, "resource_id" TEXT NOT NULL,
      "valid_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "valid_to" TIMESTAMP(3)
    );
  `);
});

afterEach(async () => {
  await db.close();
});

function slot(id: string, startsAt: string, endsAt: string, breakPair = 'NULL, NULL'): Promise<unknown> {
  return db.exec(`
    INSERT INTO "shift_slots"
      ("id", "client_id", "user_id", "kind", "starts_at", "ends_at", "created_by_user_id", "break_offset_minutes", "break_minutes")
    VALUES ('${id}', 'tenant-a', 'nurse-1', 'ward', '${startsAt}', '${endsAt}', 'head-1', ${breakPair});
  `);
}

const SERIES_COLUMNS = `"id", "client_id", "user_id", "kind", "weekdays", "every_weeks", "monthly_nth",
  "start_minutes", "end_minutes", "break_offset_minutes", "break_minutes", "time_zone", "starts_on", "ends_on", "created_by_user_id"`;

function series(values: Partial<Record<string, string>> = {}): Promise<unknown> {
  const row = {
    weekdays: `'{1,3}'`,
    every: '1',
    nth: 'NULL',
    start: '600',
    end: '840',
    breakPair: 'NULL, NULL',
    startsOn: `'2026-10-21'`,
    endsOn: 'NULL',
    ...values,
  };
  return db.exec(`
    INSERT INTO "shift_slot_series" (${SERIES_COLUMNS})
    VALUES ('rule-${Math.random().toString(36).slice(2)}', 'tenant-a', 'nurse-1', 'ward', ${row.weekdays}, ${row.every}, ${row.nth},
      ${row.start}, ${row.end}, ${row.breakPair}, 'America/Sao_Paulo', ${row.startsOn}, ${row.endsOn}, 'head-1');
  `);
}

describe('the series migration', () => {
  it('is additive: a slot written before it survives, live and attached, with no break', async () => {
    const dirs = await migrationDirs();
    await apply(db, dirs.filter((dir) => dir < SERIES_MIGRATION));
    await db.exec(`
      INSERT INTO "shift_slots" ("id", "client_id", "user_id", "kind", "starts_at", "ends_at", "series_id", "created_by_user_id")
      VALUES ('old', 'tenant-a', 'nurse-1', 'ward', '2026-10-21T13:00:00Z', '2026-10-21T17:00:00Z', 'repeat-1', 'head-1');
    `);
    await apply(db, dirs.filter((dir) => dir >= SERIES_MIGRATION));
    const rows = await db.query<Record<string, unknown>>(
      `SELECT "series_id", "detached", "origin_series_id", "series_date", "break_minutes" FROM "shift_slots"`,
    );
    expect(rows.rows).toEqual([
      { series_id: 'repeat-1', detached: false, origin_series_id: null, series_date: null, break_minutes: null },
    ]);
  });
});

describe('shift_slots break', () => {
  beforeEach(async () => {
    await apply(db, await migrationDirs());
  });

  it('stores a break strictly inside, also on a slot across midnight', async () => {
    await slot('day', '2026-10-21T13:00:00Z', '2026-10-21T17:00:00Z', '120, 30');
    await slot('night', '2026-10-22T01:00:00Z', '2026-10-22T09:00:00Z', '420, 59');
    const count = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM "shift_slots"`);
    expect(count.rows[0]?.n).toBe(2);
  });

  it.each([
    ['an offset alone', '120, NULL'],
    ['a length alone', 'NULL, 30'],
    ['a break at the start', '0, 30'],
    ['a break reaching the end', '210, 30'],
    ['an empty break', '60, 0'],
  ])('refuses %s', async (_, pair) => {
    await expect(slot('bad', '2026-10-21T13:00:00Z', '2026-10-21T17:00:00Z', pair)).rejects.toThrow(/shift_slots_break_check/);
  });
});

describe('shift_slot_series', () => {
  beforeEach(async () => {
    await apply(db, await migrationDirs());
  });

  it('stores weekly, monthly, overnight-with-break and a CLOSED rule (end before start)', async () => {
    await series();
    await series({ every: 'NULL', nth: '5', weekdays: `'{1}'` });
    await series({ start: '1320', end: '360', breakPair: '240, 30' });
    await series({ startsOn: `'2026-10-21'`, endsOn: `'2026-10-20'` });
    const rows = await db.query<{ skipped_dates: unknown[] }>(`SELECT "skipped_dates" FROM "shift_slot_series"`);
    expect(rows.rows.map((row) => row.skipped_dates)).toEqual([[], [], [], []]);
  });

  it.each([
    ['no weekday', { weekdays: `'{}'` }, 'weekdays'],
    ['a weekday 8', { weekdays: `'{1,8}'` }, 'weekdays'],
    ['both repeats', { nth: '1', weekdays: `'{1}'` }, 'repeat'],
    ['neither repeat', { every: 'NULL' }, 'repeat'],
    ['every three weeks', { every: '3' }, 'every_weeks'],
    ['a monthly rule on two weekdays', { every: 'NULL', nth: '2' }, 'monthly'],
    ['a sixth weekday', { every: 'NULL', nth: '6', weekdays: `'{1}'` }, 'monthly'],
    ['minute 1440', { end: '1440' }, 'minutes'],
    ['half a break', { breakPair: '60, NULL' }, 'break'],
    ['a break past an overnight end', { start: '1320', end: '360', breakPair: '460, 30' }, 'break'],
  ])('refuses %s', async (_, values, constraint) => {
    await expect(series(values)).rejects.toThrow(new RegExp(`shift_slot_series_${constraint}_check`));
  });
});
