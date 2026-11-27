import { describe, expect, it } from 'vitest';

import { TenantConfigError } from '../server';
import { DAY_MS, lifecycleHost } from './lifecycle-fixtures';

/**
 * FUT-5636, the lifecycle side: `lifecycle.purge` in place of `onPurgeDue`
 * (one of them, never both), and the reopen that reads the closing row INSIDE
 * its transaction, after the move (C9b).
 */

const fakeEngine = () => ({
  run: async () => 'purged' as const,
  sweepImages: async () => ({ emptied: 0 }),
});

describe('lifecycle.purge XOR lifecycle.onPurgeDue', () => {
  it('refuses both, refuses neither naming onPurgeDue, and refuses an engine missing a member', () => {
    const host = lifecycleHost();
    expect(() => host.build({ purge: fakeEngine() })).toThrow(/lifecycle\.purge" is given with lifecycle\.onPurgeDue/u);
    expect(() => host.build({ onPurgeDue: undefined })).toThrow(/lifecycle\.onPurgeDue/u);
    expect(() => host.build({ onPurgeDue: undefined, purge: { run: fakeEngine().run } as never })).toThrow(TenantConfigError);
    expect(() => host.build({ onPurgeDue: undefined, purge: { run: fakeEngine().run } as never })).toThrow(/lifecycle\.purge\.sweepImages/u);
    expect(() => host.build({ onPurgeDue: undefined, purge: fakeEngine() })).not.toThrow();
  });

  it('with the engine, the sweep stamps nothing itself and reports the image pass; a failing pass goes to onError', async () => {
    const host = lifecycleHost();
    const now = new Date('2026-03-01T00:00:00.000Z');
    const lifecycle = host.build({ onPurgeDue: undefined, purge: fakeEngine() }).lifecycle;
    await lifecycle?.close({ tenant: host.tenantOf('t-1')!, by: 'platform', reason: 'moving out', actorUserId: null, request: new Request('https://h.test/'), now });
    const after = new Date(now.getTime() + 31 * DAY_MS);
    expect(await lifecycle?.sweep(after)).toEqual({ reminded: { week: 0, day: 0 }, purged: 1, afterCloseRetried: 0, imagesErased: 0 });
    expect(host.closingOf('t-1')?.purgedAt).toBeNull();
    const broken = host.build({
      onPurgeDue: undefined,
      purge: { ...fakeEngine(), sweepImages: async () => Promise.reject(new Error('read failed')) },
    }).lifecycle;
    expect((await broken?.sweep(after))?.imagesErased).toBe(0);
    expect(host.errors.map((entry) => entry.act)).toEqual(['purgeImages']);
  });
});

describe('C9b: the reopen reads the closing row inside its transaction', () => {
  it('a re-close landing between the first read and the transaction: the mirror is handed the NEWER close', async () => {
    const host = lifecycleHost();
    const now = new Date('2026-03-01T00:00:00.000Z');
    const lifecycle = host.tenant().lifecycle;
    await lifecycle?.close({ tenant: host.tenantOf('t-2')!, by: 'platform', reason: 'moving out', actorUserId: null, request: new Request('https://h.test/'), now });
    const again = new Date(now.getTime() + DAY_MS);
    const raced = host.build({
      db: {
        ...host.lifecycle.db,
        transaction: async (run) => {
          // Reopened and closed again by another request, committed just before this transaction opens.
          const row = host.closingOf('t-2');
          if (row !== undefined) row.requestedAt = again;
          return host.lifecycle.db.transaction(run);
        },
      },
    }).lifecycle;
    const state = await raced?.reopen({ tenant: host.tenantOf('t-2')!, by: 'platform' });
    expect(state?.status).toBe('ON_HOLD');
    expect(host.mirrorDeletes).toEqual([{ tenantId: 't-2', requestedAt: again }]);
    expect(host.state.closings).toEqual([]);
  });

  it('restores the status the newer close started from when it differs from the first read', async () => {
    const host = lifecycleHost();
    const now = new Date('2026-03-01T00:00:00.000Z');
    await host.tenant().lifecycle?.close({ tenant: host.tenantOf('t-2')!, by: 'platform', reason: 'moving out', actorUserId: null, request: new Request('https://h.test/'), now });
    const raced = host.build({
      db: {
        ...host.lifecycle.db,
        transaction: async (run) => {
          const row = host.closingOf('t-2');
          if (row !== undefined) row.priorStatus = 'OPEN';
          return host.lifecycle.db.transaction(run);
        },
      },
    }).lifecycle;
    expect((await raced?.reopen({ tenant: host.tenantOf('t-2')!, by: 'platform' }))?.status).toBe('OPEN');
    expect(host.tenantOf('t-2')?.status).toBe('OPEN');
  });
});
