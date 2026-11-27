import { describe, expect, it, vi } from 'vitest';

import { TenantConfigError, assertPurgeClassification, createTenantPurge, type TenantPurgeConfig } from '../server';
import { purgeHost } from './purge-fixtures';

/* eslint-disable test-flakiness/no-database-operations, test-flakiness/no-long-text-match, test-flakiness/no-global-state-mutation --
   The classification cases read a real catalogue (PGlite); the rest only build configs.
   The long strings are SQL sent to the database, not text matched against; the counters are a fake host's own state. */

vi.setConfig({ testTimeout: 30_000 });

/**
 * FUT-5636: the engine's config fails loudly at startup (I12, I13), its plan
 * renders the config as table names (I3), and the classification helper the
 * host's tests call names every finding (C11).
 */

type Config = TenantPurgeConfig<unknown>;

function without(config: Config, key: keyof Config): Config {
  const copy: Record<string, unknown> = { ...config };
  delete copy[key];
  return copy as unknown as Config;
}

describe('I13: required config never defaults', () => {
  const host = purgeHost();
  const build = (config: Config) => () => createTenantPurge(host.api, host.lifecycle, config);

  it.each([
    'keyColumns',
    'models',
    'tables',
    'db',
    'revokeCredentials',
    'collectImageKeys',
    'heldElsewhere',
    'beforeErase',
    'zeroBalances',
    'mirrorClosing',
    'storage',
    'parseKey',
    'unscopedKeys',
    'imageChunk',
  ] as const)('refuses a missing %s, naming it', (key) => {
    expect(build(without(host.config, key))).toThrow(TenantConfigError);
    expect(build(without(host.config, key))).toThrow(new RegExp(`purge\\.${key}`, 'u'));
  });

  it('refuses a bad chunk, a bad unscoped choice, a storage member missing, a hook that is not a function', () => {
    expect(build({ ...host.config, imageChunk: 0 })).toThrow(/purge\.imageChunk/u);
    expect(build({ ...host.config, unscopedKeys: 'maybe' as never })).toThrow(/purge\.unscopedKeys/u);
    expect(build({ ...host.config, storage: { ...host.config.storage, state: undefined as never } })).toThrow(/purge\.storage\.state/u);
    expect(build({ ...host.config, beforeErase: ['nope' as never] })).toThrow(/purge\.beforeErase\[0\]/u);
  });

  it('refuses a model that does not resolve, the package table unresolved, and a lifecycle missing what the engine reuses', () => {
    expect(build({ ...host.config, models: { resolve: (model) => (model === 'TenantClosing' ? null : host.config.models.resolve(model)) } })).toThrow(/TenantClosing/u);
    const noAudit = { ...host.lifecycle, audit: undefined };
    expect(() => createTenantPurge(host.api, noAudit as unknown as typeof host.lifecycle, host.config)).toThrow(/lifecycle\.audit/u);
    expect(() => createTenantPurge({ ...host.api, port: { ...host.api.port, clearProfile: undefined as never } }, host.lifecycle, host.config)).toThrow(
      /port\.clearProfile/u,
    );
  });
});

describe('I12: raw SQL names tables only through models.resolve', () => {
  const host = purgeHost();
  const entry = (value: unknown) => () =>
    createTenantPurge(host.api, host.lifecycle, { ...host.config, tables: [...host.config.tables, value as Config['tables'][number]] });

  it('refuses a literal table on an erase or a strip, a model that does not resolve, a key column not listed, a duplicate', () => {
    expect(entry({ table: 'patients', action: 'erase' })).toThrow(TenantConfigError);
    expect(entry({ table: 'patients', action: 'keepAndStrip', law: 'x', strip: { set: 'a', when: 'b' } })).toThrow(/model/u);
    expect(entry({ model: 'NoSuchModel', key: { column: 'org_id' }, action: 'erase' })).toThrow(/NoSuchModel/u);
    expect(entry({ model: 'Patient', key: { column: 'owner_id' }, action: 'erase' })).toThrow(/keyColumns does not list/u);
    expect(entry({ model: 'Patient', key: { column: 'org_id' }, action: 'erase' })).toThrow(/repeats "patients"/u);
    expect(entry({ model: 'Patient', action: 'keep', key: { column: 'org_id' } })).toThrow(/law/u);
    expect(entry({ model: 'Item', key: { column: 'org_id' }, action: 'purge' })).toThrow(/not erase, keep or keepAndStrip/u);
    expect(
      entry({
        model: 'Visit',
        key: { column: 'org_id' },
        action: 'keepAndStrip',
        law: 'x',
        strip: { set: 'a', when: 'b' },
        heldBy: { holders: [{ model: 'Ghost', column: 'a', matches: 'b' }], children: [] },
      }),
    ).toThrow(/Ghost/u);
  });
});

describe('I3: the plan renders the config as table names, in order', () => {
  const host = purgeHost();

  it('lists each table once with its action, the held ones with their children, the keys as given', () => {
    const plan = host.engine.plan();
    expect(plan.filter((step) => step.action === 'erase' || step.action === 'keepHeld').map((step) => step.table)).toEqual([
      'patients', 'staff', 'vendors', 'photos', 'settings', 'grants',
    ]);
    expect(plan.filter((step) => step.action === 'keepHeld').map((step) => [step.table, step.children])).toEqual([['staff', 1], ['vendors', 0]]);
    expect(plan.filter((step) => step.action === 'strip').map((step) => step.table)).toEqual(['report_lines', 'reports', 'items']);
    expect(plan.find((step) => step.table === 'settings')?.key).toEqual({ column: 'owner_ref', equals: { owner_kind: 'ORG' } });
    expect(plan.find((step) => step.table === 'monthly_rollup')).toEqual({ table: 'monthly_rollup', action: 'keep' });
    expect(Object.isFrozen(plan)).toBe(true);
  });
});

describe('C11: the classification helper', () => {
  const host = purgeHost();
  const options = { keyColumns: ['org_id', 'scope', 'owner_ref', 'tenant_id'], notATenantKey: ['oauth_apps'] };

  let migrated: Promise<void> | null = null;
  async function catalog() {
    migrated ??= host.migrate();
    await migrated;
    const { rows: columns } = await host.pg.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
    );
    const byTable = new Map<string, string[]>();
    for (const { table_name, column_name } of columns) byTable.set(table_name, [...(byTable.get(table_name) ?? []), column_name]);
    const { rows: cascades } = await host.pg.query<{ child: string; parent: string }>(
      `SELECT cl.relname AS child, pl.relname AS parent FROM pg_constraint c
         JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_class pl ON pl.oid = c.confrelid
        WHERE c.contype = 'f' AND c.confdeltype = 'c'`,
    );
    return { tables: [...byTable].map(([table, cols]) => ({ table, columns: cols })), cascades };
  }

  it('passes on the real catalogue, the holders of a held table cascading from it included', async () => {
    const real = await catalog();
    expect(real.cascades).toContainEqual({ child: 'rosters', parent: 'staff' });
    expect(() => assertPurgeClassification(real, host.config, options)).not.toThrow();
  });

  it('names a table that holds a tenant key and is in no list, and one the catalogue does not have', async () => {
    const real = await catalog();
    const grown = { ...real, tables: [...real.tables, { table: 'brand_new_things', columns: ['id', 'org_id'] }, { table: 'oauth_apps', columns: ['scope'] }] };
    expect(() => assertPurgeClassification(grown, host.config, options)).toThrow(/brand_new_things: holds a tenant key \(org_id\)/u);
    const shrunk = { ...real, tables: real.tables.filter(({ table }) => table !== 'visits') };
    expect(() => assertPurgeClassification(shrunk, host.config, options)).toThrow(/visits: is in the config but not in the catalogue/u);
  });

  it('names an erased table that cascades into a kept one, and an erased child after the parent it restricts', async () => {
    const real = await catalog();
    const leaking = { ...real, cascades: [...real.cascades, { child: 'visits', parent: 'patients' }] };
    expect(() => assertPurgeClassification(leaking, host.config, options)).toThrow(/visits <- patients/u);
    const fromHeld = { ...real, cascades: [...real.cascades, { child: 'lots', parent: 'staff' }] };
    expect(() => assertPurgeClassification(fromHeld, host.config, options)).toThrow(/lots <- staff/u);
    const blocking = { ...real, restricts: [{ child: 'grants', parent: 'patients' }] };
    expect(() => assertPurgeClassification(blocking, host.config, options)).toThrow(/grants -> patients/u);
  });
});
