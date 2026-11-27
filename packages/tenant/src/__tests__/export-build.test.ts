import { describe, expect, it } from 'vitest';

import type { TenantExportContext, TenantExportSection } from '../export';
import { exportHost, exportRow } from './export-fixtures';
import { readZip } from './export-zip-reader';

/**
 * The build job's handler (ported from the host's run and build suites): the
 * claim, the archive's sections in order, READY with a capped link, the
 * notice, and every way a build ends without one.
 */

const AT = new Date('2026-11-25T12:00:00.000Z');

function stored(env: ReturnType<typeof exportHost>, id = 'e1'): Record<string, string> {
  return Object.fromEntries(readZip(new Uint8Array(env.objects.get(`exports/t-1/${id}.zip`) as Buffer)));
}

describe('build', () => {
  it('claims only a row with tries left, builds on the tenant clock, marks it READY and tells the person', async () => {
    const env = exportHost();
    env.rows.set('e1', exportRow());
    env.legacy.set('e1', exportRow());
    env.knobs.timeZone = 'America/Manaus';
    const seen: TenantExportContext[] = [];
    const engine = env.build({
      sections: [{ kind: 'file', name: 'a.csv', data: async (at) => (seen.push(at), 'x') }],
    });
    await expect(engine.build('e1', AT)).resolves.toBe('built');
    expect(seen[0]).toMatchObject({ tenantId: 't-1', now: AT, timeZone: 'America/Manaus', locale: 'en-GB' });
    const row = env.rows.get('e1');
    expect(row).toMatchObject({ status: 'READY', attempts: 1, storageKey: 'exports/t-1/e1.zip', expiresAt: new Date('2026-12-02T12:00:00.000Z') });
    expect(row?.sizeBytes).toBe(env.objects.get('exports/t-1/e1.zip')?.length);
    expect(env.notices).toEqual([
      {
        type: 'clinic.export_ready',
        payload: {
          tenantId: 't-1',
          name: 'Clínica Norte',
          slug: 'north',
          exportId: 'e1',
          requestedById: 'user-1',
          expiresAt: '2026-12-02T12:00:00.000Z',
          failed: false,
        },
      },
    ]);
    expect(row?.notifiedAt).toBeInstanceOf(Date);
    // Every write was mirrored, in its own transaction: the older table reads the same.
    expect(env.legacy.get('e1')).toEqual(row);
  });

  it('writes every section in order: a file, a CSV page by page with its BOM and neutralised cells', async () => {
    const env = exportHost();
    env.rows.set('e1', exportRow());
    await env.build().build('e1', AT);
    const files = stored(env);
    expect(Object.keys(files)).toEqual(['catalogue.csv', 'patients.csv']);
    expect(files['catalogue.csv']).toBe('code,name\r\nX1,Consult\r\n');
    expect(files['patients.csv']).toBe("\ufeffPatient,Seen\r\nAna,01/11/2026\r\n'=1+1,-2\r\n");
  });

  it('names a section in the tenant archive language', async () => {
    const env = exportHost();
    env.rows.set('e1', exportRow());
    await env.build({ archiveLocale: () => 'pt-BR' }).build('e1', AT);
    expect(Object.keys(stored(env))).toEqual(['catalogue.csv', 'pacientes.csv']);
  });

  it('caps the link at the closing purge date', async () => {
    const env = exportHost();
    env.rows.set('e1', exportRow());
    const purgeAt = new Date('2026-11-28T00:00:00.000Z');
    env.closeWith(purgeAt);
    await env.build().build('e1', AT);
    expect(env.rows.get('e1')?.expiresAt).toEqual(purgeAt);
  });

  it('builds nothing when another build holds the claim, or the row is out of tries', async () => {
    const env = exportHost();
    env.rows.set('e1', exportRow({ startedAt: new Date('2026-11-25T11:55:00.000Z'), attempts: 1 }));
    env.rows.set('e2', exportRow({ id: 'e2', tenantId: 't-2', attempts: 3 }));
    const engine = env.build();
    await expect(engine.build('e1', AT)).resolves.toBe('skipped');
    await expect(engine.build('e2', AT)).resolves.toBe('skipped');
    expect(env.objects.size).toBe(0);
    expect(env.notices).toEqual([]);
  });

  it('takes over a build that went quiet', async () => {
    const env = exportHost();
    env.rows.set('e1', exportRow({ startedAt: new Date('2026-11-25T11:00:00.000Z'), attempts: 1 }));
    await expect(env.build().build('e1', AT)).resolves.toBe('built');
    expect(env.rows.get('e1')?.attempts).toBe(2);
  });

  it('tells nobody and deletes its archive when the purge erased the row mid-build', async () => {
    const env = exportHost();
    env.rows.set('e1', exportRow());
    const engine = env.build();
    env.knobs.afterPut = () => engine.beforeErase('t-1', { now: AT }).then(() => undefined);
    await expect(engine.build('e1', AT)).resolves.toBe('skipped');
    expect(env.objects.size).toBe(0);
    expect(env.notices).toEqual([]);
  });

  it('deletes its archive when the sweep failed the row under it, keeps it when another build marked it READY', async () => {
    const env = exportHost();
    env.rows.set('e1', exportRow());
    const engine = env.build();
    env.knobs.afterPut = async () => {
      env.rows.set('e1', { ...(env.rows.get('e1') as ReturnType<typeof exportRow>), status: 'FAILED' });
    };
    await expect(engine.build('e1', AT)).resolves.toBe('skipped');
    expect(env.log).toContain('delete:exports/t-1/e1.zip');
    env.rows.set('e2', exportRow({ id: 'e2' }));
    env.knobs.afterPut = async () => {
      env.rows.set('e2', { ...(env.rows.get('e2') as ReturnType<typeof exportRow>), status: 'READY', storageKey: 'exports/t-1/e2.zip' });
    };
    await expect(engine.build('e2', AT)).resolves.toBe('skipped');
    expect(env.objects.has('exports/t-1/e2.zip')).toBe(true);
    expect(env.notices).toEqual([]);
  });

  it('leaves a failed build with tries left to the sweep, telling nobody yet', async () => {
    const env = exportHost();
    env.rows.set('e1', exportRow());
    const failing: TenantExportSection = { kind: 'file', name: 'a.csv', data: async () => Promise.reject(new Error('bucket down')) };
    await expect(env.build({ sections: [failing] }).build('e1', AT)).resolves.toBe('failed');
    expect(env.rows.get('e1')?.status).toBe('PREPARING');
    expect(env.notices).toEqual([]);
    expect(env.host.errors).toEqual([expect.objectContaining({ act: 'exportBuild', tenantId: 't-1' })]);
  });

  it('fails the last try for good and tells the person', async () => {
    const env = exportHost();
    env.rows.set('e1', exportRow({ attempts: 2 }));
    const failing: TenantExportSection = { kind: 'file', name: 'a.csv', data: async () => Promise.reject(new Error('bucket down')) };
    await expect(env.build({ sections: [failing] }).build('e1', AT)).resolves.toBe('failed');
    expect(env.rows.get('e1')?.status).toBe('FAILED');
    expect(env.notices).toEqual([{ type: 'clinic.export_ready', payload: expect.objectContaining({ exportId: 'e1', expiresAt: null, failed: true }) }]);
  });

  it('fails at once, and tells, a build for a tenant purged since the press', async () => {
    const env = exportHost();
    env.rows.set('e1', exportRow());
    const shut = env.host.tenantOf('t-1');
    if (shut) shut.status = 'SHUT';
    await expect(env.build().build('e1', AT)).resolves.toBe('failed');
    expect(env.rows.get('e1')?.status).toBe('FAILED');
    expect(env.objects.size).toBe(0);
    expect(env.notices).toHaveLength(1);
  });

  it('stops without failing the row when its claim was taken mid-build (the heartbeat)', async () => {
    const env = exportHost();
    env.rows.set('e1', exportRow());
    const early = new Date('2026-11-25T11:00:00.000Z');
    const taking: TenantExportSection = {
      kind: 'rows',
      name: 'a.csv',
      header: () => ['A'],
      pages: async function* pages() {
        // Another build took the row over: the beat after this page finds the claim gone.
        env.rows.set('e1', { ...(env.rows.get('e1') as ReturnType<typeof exportRow>), startedAt: new Date('2026-11-25T11:20:00.000Z') });
        yield [['x']];
      },
    };
    await expect(env.build({ sections: [taking] }).build('e1', early)).resolves.toBe('skipped');
    expect(env.objects.size).toBe(0);
    expect(env.notices).toEqual([]);
    expect(env.rows.get('e1')?.status).toBe('PREPARING');
  });

  it('stamps the notice only when it was recorded, and survives a notify that throws', async () => {
    const env = exportHost();
    env.rows.set('e1', exportRow());
    env.knobs.notifyRecords = 'throws';
    await expect(env.build().build('e1', AT)).resolves.toBe('built');
    expect(env.rows.get('e1')?.notifiedAt).toBeNull();
    expect(env.host.errors).toEqual([expect.objectContaining({ act: 'exportNotify' })]);
  });

  it('writes a files section one file at a time, as given', async () => {
    const env = exportHost();
    env.rows.set('e1', exportRow());
    const docs: TenantExportSection = {
      kind: 'files',
      files: async function* files() {
        yield { name: 'docs/A/1.xml', data: '<a/>' };
        yield { name: 'docs/A/1-event.xml', data: new TextEncoder().encode('<e/>') };
      },
    };
    await env.build({ sections: [docs] }).build('e1', AT);
    expect(stored(env)).toEqual({ 'docs/A/1.xml': '<a/>', 'docs/A/1-event.xml': '<e/>' });
  });
});
