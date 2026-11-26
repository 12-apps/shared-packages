import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it, vi } from 'vitest';

/* eslint-disable test-flakiness/no-database-operations, test-flakiness/no-unmocked-fs, test-flakiness/no-test-isolation --
   The shipped migration on real Postgres (PGlite) and the shipped partial on
   disk are the subject. Each case boots its own in-memory database. */

vi.setConfig({ testTimeout: 60_000 });

const PRISMA = join(dirname(fileURLToPath(import.meta.url)), '../../prisma');
const MIGRATIONS = join(PRISMA, 'migrations');

async function migrated(): Promise<PGlite> {
  const db = new PGlite();
  for (const name of readdirSync(MIGRATIONS).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, name, 'migration.sql'), 'utf8'));
  }
  return db;
}

/** The `@map` column names of one model in the partial, in order. */
function partialColumns(model: string): string[] {
  const partial = readFileSync(join(PRISMA, 'tenant.prisma'), 'utf8');
  const body = new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`, 'u').exec(partial)?.[1] ?? '';
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[a-z]\w*\s/u.test(line))
    .map((line) => /@map\("([^"]+)"\)/u.exec(line)?.[1] ?? (line.split(/\s+/u)[0] as string));
}

async function tableColumns(db: PGlite, table: string): Promise<string[]> {
  const { rows } = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
    [table],
  );
  return rows.map((row) => row.column_name);
}

const exportRow = (id: string, tenant: string, status: string) =>
  `INSERT INTO tenant_data_exports (id, tenant_id, requested_by_id, status, requested_at)
   VALUES ('${id}', '${tenant}', 'u-1', '${status}', now())`;

describe('the shipped migration', () => {
  it('creates exactly the columns the partial maps', async () => {
    const db = await migrated();
    expect(await tableColumns(db, 'tenant_closings')).toEqual(partialColumns('TenantClosing'));
    expect(await tableColumns(db, 'tenant_data_exports')).toEqual(partialColumns('TenantDataExport'));
  });

  it('keeps every column of the closing and export rows it replaces, under the opaque tenant key', async () => {
    const db = await migrated();
    expect(await tableColumns(db, 'tenant_closings')).toEqual([
      'tenant_id', 'requested_at', 'requested_by_id', 'reason', 'prior_status', 'purge_at',
      'reminded_week_at', 'reminded_day_at', 'purged_at', 'after_close_done_at',
      'after_close_failed_at', 'image_keys_owed', 'images_erased_at',
    ]);
    expect(await tableColumns(db, 'tenant_data_exports')).toEqual([
      'id', 'tenant_id', 'requested_by_id', 'status', 'requested_at', 'started_at', 'ready_at',
      'expires_at', 'storage_key', 'size_bytes', 'attempts', 'notified_at', 'deleted_at',
    ]);
  });

  it('declares no foreign key: the tenant id is opaque', async () => {
    const db = await migrated();
    const { rows } = await db.query(
      `SELECT constraint_name FROM information_schema.table_constraints WHERE constraint_type = 'FOREIGN KEY'`,
    );
    expect(rows).toEqual([]);
    await db.exec(
      `INSERT INTO tenant_closings (tenant_id, requested_at, reason, purge_at) VALUES ('no-such-tenant', now(), 'r', now())`,
    );
    const { rows: closing } = await db.query<{ image_keys_owed: string[]; prior_status: string | null }>(
      `SELECT image_keys_owed, prior_status FROM tenant_closings`,
    );
    expect(closing).toEqual([{ image_keys_owed: [], prior_status: null }]);
  });

  it("refuses an export status outside PREPARING | READY | FAILED", async () => {
    const db = await migrated();
    for (const status of ['PREPARING', 'READY', 'FAILED']) await db.exec(exportRow(`e-${status}`, `t-${status}`, status));
    await expect(db.exec(exportRow('e-x', 't-x', 'DONE'))).rejects.toThrow(/tenant_data_exports_status_check/u);
  });

  it('allows one PREPARING export per tenant, and any number of finished ones', async () => {
    const db = await migrated();
    await db.exec(exportRow('e-1', 't-1', 'PREPARING'));
    await expect(db.exec(exportRow('e-2', 't-1', 'PREPARING'))).rejects.toThrow(
      /tenant_data_exports_one_preparing_key/u,
    );
    await db.exec(exportRow('e-3', 't-2', 'PREPARING'));
    await db.exec(exportRow('e-4', 't-1', 'READY'));
    await db.exec(exportRow('e-5', 't-1', 'READY'));
    const { rows } = await db.query(`SELECT id FROM tenant_data_exports WHERE tenant_id = 't-1'`);
    expect(rows).toHaveLength(3);
  });
});
