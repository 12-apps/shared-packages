import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite, type Transaction } from '@electric-sql/pglite';

/* eslint-disable test-flakiness/no-database-operations, test-flakiness/no-unmocked-fs, test-flakiness/no-long-text-match, test-flakiness/no-global-state-mutation --
   The engine's SQL on real Postgres (PGlite) is the subject; the package's own shipped migration creates its table.
   The long strings are SQL sent to the database, not text matched against; the counters are a fake host's own state. */

import type { TenantClosingRow, TenantClosingTable, TenantLifecycleConfig } from '../lifecycle';
import type { TenantTreePort } from '../port';
import { createApiTenant, createTenantPurge, type TenantPurge, type TenantPurgeConfig, type TenantPurgeStorage } from '../server';
import { coreConfig } from './fixtures';
import { lifecycleHost } from './lifecycle-fixtures';

/**
 * A clinic network on real Postgres: its tenant row (`orgs`, five statuses,
 * a materialized tree path), the package's `tenant_closings` from the shipped
 * migration, an older closing table the host is moving (`legacy_closings`),
 * and a small domain keyed by `org_id` (and `scope`, and a kind/owner pair):
 * erased tables, kept ones, held ones and stripped ones. Every statement the
 * engine issues is logged, transactions apart.
 */

type ClinicStatus = 'OPEN' | 'WINDING_DOWN' | 'SHUT' | 'ON_HOLD' | 'AWAITING_REVIEW';
type Db = PGlite | Transaction;

export const DAY_MS = 24 * 60 * 60 * 1000;
export const PURGE_AT = new Date('2026-06-01T12:00:00.000Z');
export const AFTER = new Date(PURGE_AT.getTime() + 60_000);

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../../prisma/migrations');

const SCHEMA = `
CREATE TABLE orgs (id TEXT PRIMARY KEY, status TEXT NOT NULL, name TEXT NOT NULL, city TEXT, path TEXT NOT NULL, parent_id TEXT);
CREATE TABLE legacy_closings (org_id TEXT PRIMARY KEY, purged_at TIMESTAMP(3), image_keys_owed TEXT[] NOT NULL DEFAULT '{}', images_erased_at TIMESTAMP(3));
CREATE TABLE patients (id SERIAL PRIMARY KEY, org_id TEXT NOT NULL, name TEXT);
CREATE TABLE visits (id SERIAL PRIMARY KEY, org_id TEXT NOT NULL, note TEXT);
CREATE TABLE staff (id SERIAL PRIMARY KEY, org_id TEXT NOT NULL, user_id TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT true, UNIQUE (user_id, org_id));
CREATE TABLE staff_roles (id SERIAL PRIMARY KEY, staff_id INT NOT NULL REFERENCES staff(id) ON DELETE CASCADE, role TEXT);
CREATE TABLE rosters (id SERIAL PRIMARY KEY, org_id TEXT NOT NULL, worker_id TEXT NOT NULL,
  FOREIGN KEY (worker_id, org_id) REFERENCES staff(user_id, org_id) ON DELETE CASCADE);
CREATE TABLE vendors (id SERIAL PRIMARY KEY, org_id TEXT NOT NULL, name TEXT, contact TEXT);
CREATE TABLE lots (id SERIAL PRIMARY KEY, org_id TEXT NOT NULL, vendor_id INT REFERENCES vendors(id) ON DELETE SET NULL);
CREATE TABLE devices (id SERIAL PRIMARY KEY, org_id TEXT NOT NULL, revoked_at TIMESTAMP(3));
CREATE TABLE accounts (id SERIAL PRIMARY KEY, org_id TEXT NOT NULL, balance INT NOT NULL);
CREATE TABLE ledger (id SERIAL PRIMARY KEY, org_id TEXT NOT NULL, account_id INT NOT NULL, amount INT NOT NULL);
CREATE TABLE photos (id SERIAL PRIMARY KEY, org_id TEXT NOT NULL, image_key TEXT);
CREATE TABLE items (id SERIAL PRIMARY KEY, org_id TEXT NOT NULL, name TEXT, image_key TEXT);
CREATE TABLE reports (id SERIAL PRIMARY KEY, org_id TEXT NOT NULL, note TEXT, author TEXT);
CREATE TABLE report_lines (id SERIAL PRIMARY KEY, report_id INT NOT NULL REFERENCES reports(id) ON DELETE CASCADE, photo_key TEXT);
CREATE TABLE grants (id SERIAL PRIMARY KEY, scope TEXT NOT NULL, permission TEXT);
CREATE TABLE settings (id SERIAL PRIMARY KEY, owner_kind TEXT NOT NULL, owner_ref TEXT NOT NULL, secret TEXT);
CREATE TABLE audit_lines (id SERIAL PRIMARY KEY, org_id TEXT NOT NULL, action TEXT NOT NULL, after JSONB);
CREATE TABLE monthly_rollup (org_id TEXT, n INT);
`;

/** Model → table: the ORM's mapped names. */
const MODELS: Readonly<Record<string, string>> = {
  TenantClosing: 'tenant_closings',
  Patient: 'patients',
  Visit: 'visits',
  Staff: 'staff',
  StaffRole: 'staff_roles',
  Roster: 'rosters',
  Vendor: 'vendors',
  Lot: 'lots',
  Device: 'devices',
  Account: 'accounts',
  Ledger: 'ledger',
  Photo: 'photos',
  Item: 'items',
  Report: 'reports',
  ReportLine: 'report_lines',
  Grant: 'grants',
  Setting: 'settings',
  AuditLine: 'audit_lines',
  LegacyClosing: 'legacy_closings',
};

const camel = (column: string) => column.replace(/_([a-z])/gu, (_, letter: string) => letter.toUpperCase());
const snake = (field: string) => field.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`);

function rowOf(raw: Record<string, unknown>): TenantClosingRow {
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [camel(key), value])) as unknown as TenantClosingRow;
}

/** `where` as SQL: a value is `=`, null is `IS NULL`. */
function whereOf(where: Record<string, unknown>, params: unknown[]): string {
  return Object.entries(where)
    .filter(([, value]) => value !== undefined)
    .map(([field, value]) => {
      if (value === null) return `"${snake(field)}" IS NULL`;
      params.push(value);
      return `"${snake(field)}" = $${params.length}`;
    })
    .join(' AND ');
}

export function purgeHost() {
  const pg = new PGlite();
  const statements: string[] = [];
  let transactions = 0;
  const logged = (db: Db) => ({
    query: async <R>(sql: string, params: readonly unknown[] = []) => {
      statements.push(sql);
      return db.query<R>(sql, [...params]);
    },
  });
  const on = (tx?: unknown) => logged((tx as Transaction | undefined) ?? pg);

  /** The lifecycle's table, over SQL (only what the engine and the sweep call). */
  const table = (tx?: unknown): TenantClosingTable => ({
    findUnique: async ({ where }) => {
      const { rows } = await on(tx).query<Record<string, unknown>>(`SELECT * FROM tenant_closings WHERE tenant_id = $1`, [where.tenantId]);
      return rows[0] === undefined ? null : rowOf(rows[0]);
    },
    findMany: async ({ where, take }) => {
      const params: unknown[] = [];
      let sql = `SELECT * FROM tenant_closings WHERE purged_at IS NULL`;
      if (where.OR !== undefined) {
        params.push(where.OR[0].purgeAt.gt, where.OR[1].tenantId.gt);
        sql += ` AND (purge_at > $1 OR (purge_at = $1 AND tenant_id > $2))`;
      }
      params.push(take);
      const { rows } = await on(tx).query<Record<string, unknown>>(`${sql} ORDER BY purge_at, tenant_id LIMIT $${params.length}`, params);
      return rows.map(rowOf);
    },
    create: async () => {
      throw new Error('not used here');
    },
    deleteMany: async ({ where }) => {
      const params: unknown[] = [];
      const result = await on(tx).query(`DELETE FROM tenant_closings WHERE ${whereOf(where, params)}`, params);
      return { count: result.affectedRows ?? 0 };
    },
    updateMany: async ({ where, data }) => {
      const params: unknown[] = [];
      const condition = whereOf(where, params);
      const set = Object.entries(data).map(([field, value]) => {
        params.push(value);
        return `"${snake(field)}" = $${params.length}`;
      });
      const result = await on(tx).query(`UPDATE tenant_closings SET ${set.join(', ')} WHERE ${condition}`, params);
      return { count: result.affectedRows ?? 0 };
    },
  });

  const objects = new Set<string>();
  const members = (key: string) => [key, `${key}.thumb`];
  const knobs = {
    heldCalls: [] as string[][],
    zeroCalls: 0,
    revokeCalls: 0,
    clearCalls: 0,
    mirrorCalls: [] as { tenantId: string; fields: Record<string, unknown> }[],
    /** Runs inside the flip's transaction, right before the CAS: a write that committed just before it. */
    beforeCas: null as null | ((tx: Transaction) => Promise<void>),
  };
  const errors: { act: string; tenantId: string; error: unknown }[] = [];

  const storage: TenantPurgeStorage = {
    discard: async (_scope, keys) => {
      for (const key of keys) for (const member of members(key)) objects.delete(member);
    },
    members,
    state: async (key) => (objects.has(key) ? 'present' : 'absent'),
  };

  const base = lifecycleHost();
  const tree: TenantTreePort<unknown> = {
    treeNode: async (id) => {
      const { rows } = await on().query<{ id: string; parent_id: string | null; path: string }>(`SELECT id, parent_id, path FROM orgs WHERE id = $1`, [id]);
      return rows[0] === undefined ? null : { id: rows[0].id, parentId: rows[0].parent_id, path: rows[0].path };
    },
    treeAncestors: async () => [],
    treeDescendants: async (id, tx) => {
      const { rows } = await on(tx).query<{ id: string; parent_id: string | null; path: string; status: string }>(
        `SELECT d.id, d.parent_id, d.path, d.status FROM orgs o JOIN orgs d ON d.path LIKE o.path || '%' WHERE o.id = $1 ORDER BY length(d.path)`,
        [id],
      );
      return rows.map((row) => ({ id: row.id, parentId: row.parent_id, path: row.path, status: row.status }));
    },
    moveSubtree: async () => 0,
  };
  const api = createApiTenant<ClinicStatus, unknown>({
    ...coreConfig(),
    port: {
      bySlug: async () => null,
      byId: async (id, tx) => {
        const { rows } = await on(tx).query<{ id: string; status: ClinicStatus; name: string }>(`SELECT id, status, name FROM orgs WHERE id = $1`, [id]);
        return rows[0] === undefined ? null : { ...rows[0], slug: rows[0].id };
      },
      setStatusIf: async (id, from, to, tx) => {
        if (knobs.beforeCas !== null) {
          const race = knobs.beforeCas;
          knobs.beforeCas = null;
          await race(tx as Transaction);
        }
        const result = await on(tx).query(`UPDATE orgs SET status = $3 WHERE id = $1 AND status = $2`, [id, from, to]);
        return (result.affectedRows ?? 0) > 0;
      },
      clearProfile: async (tx, id) => {
        knobs.clearCalls += 1;
        await on(tx).query(`UPDATE orgs SET city = NULL WHERE id = $1`, [id]);
      },
      timeZone: async () => 'UTC',
    },
    tree,
  });

  let engine: TenantPurge | null = null;
  const lifecycle: TenantLifecycleConfig<ClinicStatus, unknown> = {
    ...base.lifecycle,
    openDescendants: { kind: 'units', path: 'units' },
    onPurgeDue: undefined,
    purge: {
      run: (tenantId, at) => (engine as TenantPurge).run(tenantId, at),
      sweepImages: (now) => (engine as TenantPurge).sweepImages(now),
    },
    mirror: undefined,
    db: { transaction: (run) => pg.transaction((tx) => run(tx)), table: (tx) => table(tx) },
    audit: async (tx, action, event) => {
      await on(tx).query(`INSERT INTO audit_lines (org_id, action, after) VALUES ($1, $2, $3)`, [event.tenantId, action, JSON.stringify(event)]);
    },
    invalidate: async () => undefined,
    onError: (error, at) => errors.push({ ...at, error }),
  };

  const config: TenantPurgeConfig<unknown> = {
    keyColumns: ['org_id', 'scope', 'owner_ref', 'tenant_id'],
    models: { resolve: (model) => MODELS[model] ?? null },
    tables: [
      { model: 'Patient', key: { column: 'org_id' }, action: 'erase' },
      {
        model: 'Staff',
        key: { column: 'org_id' },
        action: 'keepAndStrip',
        law: 'a roster names its worker',
        strip: { set: `"active" = false`, when: `"active"` },
        heldBy: {
          holders: [{ model: 'Roster', column: 'worker_id', matches: 'user_id' }],
          children: [{ model: 'StaffRole', column: 'staff_id', references: 'id' }],
        },
      },
      {
        model: 'Vendor',
        key: { column: 'org_id' },
        action: 'keepAndStrip',
        law: 'a lot names its vendor',
        strip: { set: `"contact" = NULL`, when: `"contact" IS NOT NULL` },
        heldBy: { holders: [{ model: 'Lot', column: 'vendor_id', matches: 'id' }], children: [] },
      },
      { model: 'Photo', key: { column: 'org_id' }, action: 'erase' },
      { model: 'Setting', key: { column: 'owner_ref', equals: { owner_kind: 'ORG' } }, action: 'erase' },
      { model: 'Grant', key: { column: 'scope' }, action: 'erase' },
      {
        model: 'ReportLine',
        key: { through: { model: 'Report', column: 'report_id', references: 'id', key: { column: 'org_id' } } },
        action: 'keepAndStrip',
        law: 'the refund the report answers',
        strip: { set: `"photo_key" = NULL`, when: `"photo_key" IS NOT NULL` },
      },
      {
        model: 'Report',
        key: { column: 'org_id' },
        action: 'keepAndStrip',
        law: 'the refund it records',
        strip: { set: `"note" = NULL, "author" = $2`, when: `("note" IS NOT NULL OR "author" <> $2)`, values: [() => 'Removed person'] },
      },
      { model: 'Item', key: { column: 'org_id' }, action: 'keepAndStrip', law: 'the goods sold', strip: { set: `"image_key" = NULL`, when: `"image_key" IS NOT NULL` } },
      { model: 'Visit', key: { column: 'org_id' }, action: 'keep', law: 'medical record' },
      { model: 'Roster', key: { column: 'org_id' }, action: 'keep', law: 'labour record' },
      { model: 'Lot', key: { column: 'org_id' }, action: 'keep', law: 'tax record' },
      { model: 'Device', key: { column: 'org_id' }, action: 'keep', law: 'its captures are money records' },
      { model: 'Account', key: { column: 'org_id' }, action: 'keep', law: 'money' },
      { model: 'Ledger', key: { column: 'org_id' }, action: 'keep', law: 'money' },
      { model: 'AuditLine', key: { column: 'org_id' }, action: 'keep', law: 'audit trail' },
      { model: 'LegacyClosing', key: { column: 'org_id' }, action: 'keep', law: 'platform rule' },
      { model: 'TenantClosing', key: { column: 'tenant_id' }, action: 'keep', law: 'platform rule' },
      { table: 'monthly_rollup', action: 'keep', law: 'platform rule' },
      { table: 'tenant_data_exports', action: 'keep', law: 'the export erases its own' },
    ],
    db: {
      transaction: (run) => {
        transactions += 1;
        return pg.transaction((tx) => run(tx));
      },
      execute: async (sql, params, tx) => (await on(tx).query(sql, params)).affectedRows ?? 0,
      query: async <R>(sql: string, params: readonly unknown[], tx?: unknown) => (await on(tx).query<R>(sql, params)).rows,
    },
    revokeCredentials: async (tx, tenantId) => {
      knobs.revokeCalls += 1;
      await on(tx).query(`UPDATE devices SET revoked_at = now() WHERE org_id = $1 AND revoked_at IS NULL`, [tenantId]);
    },
    collectImageKeys: async (tenantId) => {
      const { rows } = await on().query<{ key: string }>(
        `SELECT image_key AS key FROM photos WHERE org_id = $1 AND image_key IS NOT NULL
          UNION ALL SELECT image_key FROM items WHERE org_id = $1 AND image_key IS NOT NULL`,
        [tenantId],
      );
      return rows.map((row) => row.key);
    },
    heldElsewhere: async (tenantId, keys) => {
      knobs.heldCalls.push([...keys]);
      const { rows } = await on().query<{ key: string }>(
        `SELECT DISTINCT image_key AS key FROM photos WHERE org_id <> $1 AND image_key = ANY($2::text[])
          UNION SELECT image_key FROM items WHERE org_id <> $1 AND image_key = ANY($2::text[])`,
        [tenantId, keys],
      );
      return new Set(rows.map((row) => row.key));
    },
    beforeErase: [],
    zeroBalances: async (tx, tenantId) => {
      knobs.zeroCalls += 1;
      await on(tx).query(
        `INSERT INTO ledger (org_id, account_id, amount) SELECT org_id, id, -balance FROM accounts WHERE org_id = $1 AND balance > 0`,
        [tenantId],
      );
      await on(tx).query(`UPDATE accounts SET balance = 0 WHERE org_id = $1 AND balance > 0`, [tenantId]);
    },
    audit: async (tx, action, event) => {
      await on(tx).query(`INSERT INTO audit_lines (org_id, action, after) VALUES ($1, $2, $3)`, [event.tenantId, action, JSON.stringify(event)]);
    },
    mirrorClosing: async (tx, tenantId, fields) => {
      knobs.mirrorCalls.push({ tenantId, fields: { ...fields } });
      const set: string[] = [];
      const params: unknown[] = [tenantId];
      for (const [field, value] of Object.entries(fields)) {
        params.push(value);
        set.push(`"${snake(field)}" = $${params.length}${field === 'imageKeysOwed' ? '::text[]' : ''}`);
      }
      await on(tx).query(`UPDATE legacy_closings SET ${set.join(', ')} WHERE org_id = $1`, params);
    },
    storage,
    parseKey: (key) => {
      const scoped = /^img\/([a-z0-9-]+)\/[a-z0-9-]+\.webp$/u.exec(key);
      if (scoped) return { scope: scoped[1] as string };
      return /^img\/[a-z0-9-]+\.webp$/u.test(key) ? { scope: null } : null;
    },
    unscopedKeys: 'accept',
    imageChunk: 2,
  };

  const build = (overrides: Partial<TenantPurgeConfig<unknown>> = {}) => createTenantPurge(api, lifecycle, { ...config, ...overrides });
  engine = build();
  const lifecycleApi = createApiTenant<ClinicStatus, unknown>({
    ...coreConfig(),
    port: api.port,
    tree,
    lifecycle,
  });

  async function migrate(): Promise<void> {
    for (const name of readdirSync(MIGRATIONS).sort()) await pg.exec(readFileSync(join(MIGRATIONS, name, 'migration.sql'), 'utf8'));
    await pg.exec(SCHEMA);
  }

  /** One org under `parent` (when given), with a small domain in it. */
  async function seed(id: string, options: { parent?: string; images?: string[]; balance?: number } = {}): Promise<void> {
    const parentPath = options.parent === undefined ? '/' : (await pg.query<{ path: string }>(`SELECT path FROM orgs WHERE id = $1`, [options.parent])).rows[0]?.path;
    await pg.query(`INSERT INTO orgs (id, status, name, city, path, parent_id) VALUES ($1, 'OPEN', $1, 'Recife', $2, $3)`, [id, `${parentPath}${id}/`, options.parent ?? null]);
    await pg.query(`INSERT INTO patients (org_id, name) VALUES ($1, 'Ana'), ($1, 'Bia')`, [id]);
    await pg.query(`INSERT INTO visits (org_id, note) VALUES ($1, 'checkup')`, [id]);
    const kept = await pg.query<{ id: number }>(`INSERT INTO staff (org_id, user_id) VALUES ($1, 'u-held') RETURNING id`, [id]);
    const gone = await pg.query<{ id: number }>(`INSERT INTO staff (org_id, user_id) VALUES ($1, 'u-free') RETURNING id`, [id]);
    await pg.query(`INSERT INTO staff_roles (staff_id, role) VALUES ($1, 'nurse'), ($2, 'admin')`, [kept.rows[0]?.id, gone.rows[0]?.id]);
    await pg.query(`INSERT INTO rosters (org_id, worker_id) VALUES ($1, 'u-held')`, [id]);
    const vendor = await pg.query<{ id: number }>(`INSERT INTO vendors (org_id, name, contact) VALUES ($1, 'Acme', 'Joe') RETURNING id`, [id]);
    await pg.query(`INSERT INTO vendors (org_id, name, contact) VALUES ($1, 'Other', 'Max')`, [id]);
    await pg.query(`INSERT INTO lots (org_id, vendor_id) VALUES ($1, $2)`, [id, vendor.rows[0]?.id]);
    await pg.query(`INSERT INTO devices (org_id) VALUES ($1)`, [id]);
    await pg.query(`INSERT INTO accounts (org_id, balance) VALUES ($1, $2), ($1, 0)`, [id, options.balance ?? 0]);
    for (const key of options.images ?? []) {
      await pg.query(`INSERT INTO photos (org_id, image_key) VALUES ($1, $2)`, [id, key]);
      for (const member of members(key)) objects.add(member);
    }
    await pg.query(`INSERT INTO items (org_id, name, image_key) VALUES ($1, 'gauze', NULL)`, [id]);
    const report = await pg.query<{ id: number }>(`INSERT INTO reports (org_id, note, author) VALUES ($1, 'late', 'Carla') RETURNING id`, [id]);
    await pg.query(`INSERT INTO report_lines (report_id, photo_key) VALUES ($1, 'img/x.webp')`, [report.rows[0]?.id]);
    await pg.query(`INSERT INTO grants (scope, permission) VALUES ($1, 'read')`, [id]);
    await pg.query(`INSERT INTO settings (owner_kind, owner_ref, secret) VALUES ('ORG', $1, 's'), ('PERSON', $1, 'keep')`, [id]);
  }

  /** The org as a close leaves it: closing, both closing tables holding the same row. */
  async function closing(id: string, options: { purgeAt?: Date; status?: ClinicStatus } = {}): Promise<void> {
    const purgeAt = options.purgeAt ?? PURGE_AT;
    await pg.query(
      `INSERT INTO tenant_closings (tenant_id, requested_at, reason, prior_status, purge_at, after_close_done_at) VALUES ($1, $2, 'moving', 'OPEN', $3, $2)`,
      [id, new Date(purgeAt.getTime() - 30 * DAY_MS), purgeAt],
    );
    await pg.query(`INSERT INTO legacy_closings (org_id) VALUES ($1)`, [id]);
    await pg.query(`UPDATE orgs SET status = $2 WHERE id = $1`, [id, options.status ?? 'WINDING_DOWN']);
  }

  async function count(sql: string, ...params: unknown[]): Promise<number> {
    const { rows } = await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, params);
    return rows[0]?.n ?? 0;
  }

  /** The statements `act` issued, and how many transactions it opened. */
  async function counted<T>(act: () => Promise<T>): Promise<{ value: T; statements: string[]; transactions: number }> {
    statements.length = 0;
    const before = transactions;
    const value = await act();
    return { value, statements: [...statements], transactions: transactions - before };
  }

  return {
    pg,
    api,
    lifecycle,
    lifecycleApi,
    config,
    build,
    get engine() {
      return engine as TenantPurge;
    },
    knobs,
    errors,
    objects,
    storage,
    migrate,
    seed,
    closing,
    count,
    counted,
  };
}
