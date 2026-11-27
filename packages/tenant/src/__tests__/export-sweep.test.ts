import { describe, expect, it } from 'vitest';

import { exportHost, exportRow } from './export-fixtures';

/** The sweep job's handler (ported from the host's sweep suite). */

const AT = new Date('2026-11-25T12:00:00.000Z');
const LONG_AGO = new Date('2026-11-25T11:00:00.000Z');

describe('sweep', () => {
  it('queues a quiet build again instead of building it, one job per try', async () => {
    const env = exportHost();
    env.rows.set('e1', exportRow({ startedAt: LONG_AGO, attempts: 1 }));
    env.rows.set('fresh', exportRow({ id: 'fresh', tenantId: 't-2', startedAt: new Date('2026-11-25T11:55:00.000Z'), attempts: 1 }));
    expect(await env.build().sweep(AT)).toMatchObject({ queued: 1 });
    expect(env.queued).toEqual([{ exportId: 'e1', why: { source: 'sweep', attempts: 1 } }]);
    expect(env.objects.size).toBe(0);
  });

  it('queues a build whose first enqueue was lost (never started, asked long ago)', async () => {
    const env = exportHost();
    env.rows.set('e1', exportRow({ requestedAt: LONG_AGO }));
    expect(await env.build().sweep(AT)).toMatchObject({ queued: 1 });
    expect(env.queued).toEqual([{ exportId: 'e1', why: { source: 'sweep', attempts: 0 } }]);
  });

  it('fails an export out of tries and tells its person in the same pass', async () => {
    const env = exportHost();
    env.rows.set('e2', exportRow({ id: 'e2', startedAt: LONG_AGO, attempts: 3 }));
    expect(await env.build().sweep(AT)).toMatchObject({ queued: 0, failed: 1, told: 1 });
    expect(env.rows.get('e2')).toMatchObject({ status: 'FAILED' });
    expect(env.rows.get('e2')?.notifiedAt).toBeInstanceOf(Date);
    expect(env.legacy.size).toBe(0);
    expect(env.notices).toEqual([{ type: 'clinic.export_ready', payload: expect.objectContaining({ exportId: 'e2', failed: true }) }]);
  });

  it('never fails a build that renewed its claim since the read', async () => {
    const env = exportHost();
    env.rows.set('e2', exportRow({ id: 'e2', startedAt: LONG_AGO, attempts: 3 }));
    const engine = env.build({
      db: {
        ...env.config.db,
        table: () => ({
          ...env.table,
          findMany: async (args) => {
            const found = await env.table.findMany(args);
            // The build renews its claim between the sweep's read and its write.
            env.rows.set('e2', { ...(env.rows.get('e2') as ReturnType<typeof exportRow>), startedAt: new Date('2026-11-25T11:59:00.000Z') });
            return found;
          },
        }),
      },
    });
    await engine.sweep(AT);
    expect(env.rows.get('e2')?.status).toBe('PREPARING');
  });

  it('tells again a READY export whose notice was never recorded, only after a while', async () => {
    const env = exportHost();
    const expiresAt = new Date('2026-12-02T12:00:00.000Z');
    env.rows.set('old', exportRow({ id: 'old', status: 'READY', readyAt: LONG_AGO, expiresAt, storageKey: 'k' }));
    env.rows.set('new', exportRow({ id: 'new', tenantId: 't-2', status: 'READY', readyAt: new Date('2026-11-25T11:59:00.000Z'), expiresAt, storageKey: 'k2' }));
    expect(await env.build().sweep(AT)).toMatchObject({ told: 1 });
    expect(env.notices.map((notice) => notice.payload.exportId)).toEqual(['old']);
  });

  it('deletes the archive of an export past its link, and stamps it', async () => {
    const env = exportHost();
    env.rows.set('e3', exportRow({ id: 'e3', status: 'READY', storageKey: 'exports/t-1/e3.zip', expiresAt: LONG_AGO, notifiedAt: LONG_AGO }));
    env.objects.set('exports/t-1/e3.zip', Buffer.from('PK'));
    expect(await env.build().sweep(AT)).toMatchObject({ deleted: 1 });
    expect(env.objects.size).toBe(0);
    expect(env.rows.get('e3')?.deletedAt).toEqual(AT);
    expect(await env.build().sweep(AT)).toMatchObject({ deleted: 0 });
  });

  it('reads at most sweepBatch rows per step', async () => {
    const env = exportHost();
    for (const id of ['a', 'b', 'c']) env.rows.set(id, exportRow({ id, tenantId: id, requestedAt: LONG_AGO }));
    const limits = { ...env.config.limits, sweepBatch: 2 };
    expect(await env.build({ limits }).sweep(AT)).toMatchObject({ queued: 2 });
  });
});
