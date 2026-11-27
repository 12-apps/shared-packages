import { describe, expect, it } from 'vitest';

import type { TenantExportSection } from '../export';
import type { TenantPurgeConfig } from '../server';
import { exportHost, exportRow } from './export-fixtures';

/**
 * The purge's half of the data export (ported from the host's
 * purge-archives suite): a build still in flight while the tenant's purge
 * runs leaves nothing in storage, wherever the purge lands in the build.
 */

const AT = new Date('2026-11-25T12:00:00.000Z');

describe('beforeErase', () => {
  it('fits the purge engine beforeErase list as it is', () => {
    const engine = exportHost().build();
    const hooks: TenantPurgeConfig['beforeErase'] = [engine.beforeErase];
    expect(hooks).toHaveLength(1);
  });

  it('deletes the rows before the objects, with the mirror, so a READY write after the prefix delete finds no row', async () => {
    const env = exportHost();
    env.rows.set('e1', exportRow());
    env.legacy.set('e1', exportRow());
    env.rows.set('other', exportRow({ id: 'other', tenantId: 't-2' }));
    env.objects.set('exports/t-1/orphan.zip', Buffer.from('PK'));
    env.objects.set('exports/t-2/other.zip', Buffer.from('PK'));
    await env.build().beforeErase('t-1', { now: AT });
    expect(env.log.filter((line) => line === 'deleteRows' || line === 'deleteObjects')).toEqual(['deleteRows', 'deleteObjects']);
    expect([...env.rows.keys()]).toEqual(['other']);
    expect(env.legacy.size).toBe(0);
    expect([...env.objects.keys()]).toEqual(['exports/t-2/other.zip']);
  });

  it('throws when storage refuses, so the purge stops before erasing and resumes', async () => {
    const env = exportHost();
    env.knobs.deleteTenantRefuses = true;
    await expect(env.build().beforeErase('t-1', { now: AT })).rejects.toThrow('AccessDenied');
  });

  it('leaves no archive when the purge runs while the build is writing, before its upload', async () => {
    const env = exportHost();
    env.rows.set('e1', exportRow());
    const holder: { engine?: ReturnType<typeof env.build> } = {};
    const purging: TenantExportSection = {
      kind: 'file',
      name: 'a.csv',
      data: async () => {
        await holder.engine?.beforeErase('t-1', { now: AT });
        return 'x';
      },
    };
    holder.engine = env.build({ sections: [purging] });
    await expect(holder.engine.build('e1', AT)).resolves.toBe('skipped');
    expect(env.rows.size).toBe(0);
    expect([...env.objects.keys()]).toEqual([]);
  });

  it('leaves no archive when the purge runs after the build uploaded, before its READY write', async () => {
    const env = exportHost();
    env.rows.set('e1', exportRow());
    const engine = env.build();
    env.knobs.afterPut = () => engine.beforeErase('t-1', { now: AT });
    await expect(engine.build('e1', AT)).resolves.toBe('skipped');
    expect([...env.objects.keys()]).toEqual([]);
  });
});
