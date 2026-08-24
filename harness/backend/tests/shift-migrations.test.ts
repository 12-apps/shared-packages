/* eslint-disable test-flakiness/no-unmocked-fs, test-flakiness/no-database-operations --
   the filesystem and the database ARE the subject: this asserts that the
   migrations inside the PUBLISHED @12-apps/shift tarball apply to a real
   Postgres. Every path read is inside the installed package and the database is
   a fresh in-process PGlite per test. */
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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const shiftPackage = fileURLToPath(new URL('../node_modules/@12-apps/shift/', import.meta.url));
const migrationsDir = join(shiftPackage, 'prisma/migrations');

/** Applied in name order, which is the order Prisma applies them. */
function migrations(): string[] {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

let pg: PGlite;

beforeEach(async () => {
  pg = new PGlite();
  await pg.waitReady;
});

afterEach(async () => {
  await pg.close();
});

async function applyAll(): Promise<void> {
  for (const name of migrations()) {
    await pg.exec(readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf-8'));
  }
}

describe('the prisma assets survive publication', () => {
  it('ships the partial and a non-empty migration folder', () => {
    const partial = readFileSync(join(shiftPackage, 'prisma/shift.prisma'), 'utf-8');
    expect(partial).toContain('model Shift');
    expect(partial).toContain('@@map("shifts")');
    expect(partial).toContain('model ShiftTenantConfig');
    expect(migrations().length).toBeGreaterThan(0);
  });

  it('applies every migration, in order, to a real Postgres', async () => {
    await applyAll();
    const { rows } = await pg.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' ORDER BY table_name`,
    );
    const tables = rows.map((row) => row.table_name);
    expect(tables).toContain('shifts');
    expect(tables).toContain('shift_tenant_configs');

    // What the package ships and what it does NOT: `resource_assignments` is
    // the host's, which is the whole shape of this adoption. A migration that
    // started creating it would take the host's own table over silently.
    expect(tables).not.toContain('resource_assignments');
  });
});

describe('what the migrations protect', () => {
  it('holds a closed shift immutable, and lets a host delete one', async () => {
    await applyAll();
    await pg.query(
      `INSERT INTO shifts (id, client_id, user_id, kind, started_at, ended_at,
                           ended_reason, ended_by_user_id)
       VALUES ('s1', 'c1', 'u1', 'desk', now(), now(), 'user', 'u1')`,
    );

    // What the trigger protects: a closed shift is a finished work record, so
    // it cannot be edited afterwards.
    await expect(
      pg.query(`UPDATE shifts SET kind = 'stacks' WHERE id = 's1'`),
    ).rejects.toThrow(/immutable/i);

    // What it deliberately does NOT protect, since FUT-446 narrowed it to
    // UPDATE. `client_id` is a by-value tenant reference with no foreign key —
    // that is what keeps the package host-agnostic — so a host that drops a
    // tenant and sweeps the by-value tables by `client_id` has to be able to
    // remove the row. An unconditional DELETE guard wedged exactly that sweep.
    await expect(pg.query(`DELETE FROM shifts WHERE id = 's1'`)).resolves.toBeDefined();
  });

  it('refuses to move an open shift identity or its resource snapshot', async () => {
    await applyAll();
    await pg.query(
      `INSERT INTO shifts (id, client_id, user_id, kind, started_at,
                           resource_assignment_id, resource_type, resource_id)
       VALUES ('s7', 'c1', 'u1', 'desk', now(), 'a1', 'desk', 'desk-front')`,
    );

    // The other half of the guard, and the one that survives on an OPEN shift:
    // who is working, at what, on which desk are settled when it opens. Only
    // the closing columns may still move.
    await expect(
      pg.query(`UPDATE shifts SET user_id = 'u2' WHERE id = 's7'`),
    ).rejects.toThrow(/immutable/i);
    await expect(
      pg.query(`UPDATE shifts SET resource_id = 'desk-back' WHERE id = 's7'`),
    ).rejects.toThrow(/immutable/i);
  });

  it('refuses a closed shift that names no closer, unless it closed itself', async () => {
    await applyAll();

    // `auto` is the one reason that may carry a NULL closer — nobody closed it,
    // the window did. Every other reason must name somebody, and the CHECK is
    // where that holds rather than in any host's validation.
    await expect(
      pg.query(
        `INSERT INTO shifts (id, client_id, user_id, kind, started_at, ended_at, ended_reason)
         VALUES ('s2', 'c1', 'u1', 'desk', now(), now(), 'user')`,
      ),
    ).rejects.toThrow(/shifts_end_state_check/);

    await expect(
      pg.query(
        `INSERT INTO shifts (id, client_id, user_id, kind, started_at, ended_at, ended_reason)
         VALUES ('s3', 'c1', 'u1', 'desk', now(), now(), 'auto')`,
      ),
    ).resolves.toBeDefined();
  });

  it('refuses half a resource snapshot', async () => {
    await applyAll();
    // All three columns or none. `shift-rows.ts` maps them independently, which
    // is only safe because this constraint means there is no state where one is
    // set and another is not.
    await expect(
      pg.query(
        `INSERT INTO shifts (id, client_id, user_id, kind, started_at, resource_id)
         VALUES ('s4', 'c1', 'u1', 'desk', now(), 'desk-front')`,
      ),
    ).rejects.toThrow(/shifts_resource_snapshot_check/);
  });

  it('retires the origin host staff vocabulary by the last migration', async () => {
    // The first migration constrained `kind` to ('kitchen', 'service') — one
    // application's staff structure, in a CHECK. The third drops it and asks
    // only for a non-empty string, which is what let this harness declare a
    // library's kinds. Applying the folder IN ORDER is the only way to see it.
    await applyAll();
    await expect(
      pg.query(
        `INSERT INTO shifts (id, client_id, user_id, kind, started_at)
         VALUES ('s5', 'c1', 'u1', 'stacks', now())`,
      ),
    ).resolves.toBeDefined();

    await expect(
      pg.query(
        `INSERT INTO shifts (id, client_id, user_id, kind, started_at)
         VALUES ('s6', 'c1', 'u1', '  ', now())`,
      ),
    ).rejects.toThrow(/shifts_kind_present_check/);
  });
});
