import { describe, expect, it } from 'vitest';

import { purgeAtFor, reminderDue, sameTenantName } from '../index';
import { TenantLifecycleRefusal } from '../server';
import { DAY_MS, lifecycleHost, request } from './lifecycle-fixtures';

/** Reopening, the sweep, and the pure readings they rest on. */

const NOW = new Date('2026-11-26T12:00:00.000Z');
const PURGE = new Date(NOW.getTime() + 30 * DAY_MS);
const before = (days: number) => new Date(PURGE.getTime() - days * DAY_MS);

async function closed(id: 't-1' | 't-2', by: 'member' | 'platform' = id === 't-1' ? 'member' : 'platform') {
  const host = lifecycleHost();
  const tenant = host.tenant();
  await tenant.lifecycle!.close({
    tenant: { ...host.tenantOf(id)! },
    by,
    reason: 'Moving',
    typedName: host.tenantOf(id)?.name,
    actorUserId: 'u-1',
    request: request(),
    now: NOW,
  });
  host.log.length = 0;
  host.notices.length = 0;
  return { host, lifecycle: tenant.lifecycle! };
}

describe('reopen', () => {
  it('restores the status the close started from, deletes the row and its mirror, and audits', async () => {
    const { host, lifecycle } = await closed('t-2');
    const state = await lifecycle.reopen({ tenant: { ...host.tenantOf('t-2')! }, by: 'platform' });
    expect(state).toEqual({ status: 'ON_HOLD', requestedAt: null, purgeAt: null });
    expect(host.tenantOf('t-2')?.status).toBe('ON_HOLD');
    expect(host.state.closings).toEqual([]);
    expect(host.state.mirror).toEqual({});
    expect(host.state.audit.at(-1)?.event).toEqual({
      act: 'closeReopened',
      tenantId: 't-2',
      by: 'platform',
      purgeAt: PURGE,
      restored: 'ON_HOLD',
    });
    expect(host.notices.map((notice) => notice.type)).toEqual(['clinic.reopened']);
  });

  it('restores active when no prior status was recorded (a row copied from before the column)', async () => {
    const { host, lifecycle } = await closed('t-2');
    host.closingOf('t-2')!.priorStatus = null;
    expect((await lifecycle.reopen({ tenant: host.tenantOf('t-2') as never, by: 'member' })).status).toBe('OPEN');
  });

  it('refuses a purged tenant and one that is not closing', async () => {
    const { host, lifecycle } = await closed('t-1');
    host.closingOf('t-1')!.purgedAt = PURGE;
    (host.tenantOf('t-1') as { status: string }).status = 'SHUT';
    await expect(lifecycle.reopen({ tenant: host.tenantOf('t-1') as never, by: 'member' })).rejects.toMatchObject({
      kind: 'purged',
      code: 'CLINIC_PURGED',
    });
    const other = await lifecycle.reopen({ tenant: host.tenantOf('t-2') as never, by: 'member' }).catch((error: unknown) => error);
    expect(other).toBeInstanceOf(TenantLifecycleRefusal);
    expect(other).toMatchObject({ kind: 'notClosing', status: 409 });
  });
});

describe('the sweep', () => {
  it('sends the week and the day once each, stamped only once recorded', async () => {
    const { host, lifecycle } = await closed('t-1');
    expect((await lifecycle.sweep(before(10))).reminded).toEqual({ week: 0, day: 0 });
    host.knobs.notifyRecords = false;
    expect((await lifecycle.sweep(before(6.5))).reminded).toEqual({ week: 0, day: 0 });
    expect(host.closingOf('t-1')?.remindedWeekAt).toBeNull();
    host.knobs.notifyRecords = true;
    expect((await lifecycle.sweep(before(6.5))).reminded).toEqual({ week: 1, day: 0 });
    expect((await lifecycle.sweep(before(6))).reminded).toEqual({ week: 0, day: 0 });
    expect((await lifecycle.sweep(before(0.5))).reminded).toEqual({ week: 0, day: 1 });
    expect((await lifecycle.sweep(before(0.25))).reminded).toEqual({ week: 0, day: 0 });
    expect(host.notices.map((notice) => notice.type)).toEqual(['clinic.closing_week', 'clinic.closing_day']);
    expect(host.state.mirror['t-1']).toHaveProperty('event:reminded');
  });

  it('retries a failed after-close hook until it goes through, once', async () => {
    const host = lifecycleHost();
    host.knobs.afterCloseFails = 2;
    const lifecycle = host.tenant().lifecycle!;
    await lifecycle.close({
      tenant: { ...host.tenantOf('t-1')! },
      by: 'member',
      reason: 'Moving',
      typedName: 'Clínica Norte',
      actorUserId: 'u-1',
      request: request(),
      now: NOW,
    });
    expect((await lifecycle.sweep(before(20))).afterCloseRetried).toBe(0);
    expect((await lifecycle.sweep(before(20))).afterCloseRetried).toBe(1);
    expect((await lifecycle.sweep(before(20))).afterCloseRetried).toBe(0);
    expect(host.knobs.afterCloseCalls).toBe(3);
    expect(host.state.audit.filter((line) => line.action === 'clinic_close.after_close_failed')).toHaveLength(2);
  });

  it.each([
    ['purged', 1, true],
    ['already', 0, true],
    ['skipped', 0, false],
  ] as const)('stamps the purge on %s', async (outcome, counted, stamped) => {
    const { host, lifecycle } = await closed('t-1');
    host.knobs.purge = outcome;
    const after = new Date(PURGE.getTime() + 60_000);
    expect((await lifecycle.sweep(after)).purged).toBe(counted);
    expect(host.closingOf('t-1')?.purgedAt).toEqual(stamped ? after : null);
    expect(host.knobs.purgeCalls).toBe(1);
    await lifecycle.sweep(after);
    expect(host.knobs.purgeCalls).toBe(stamped ? 1 : 2);
  });

  it('skips a stale row of a tenant that is no longer closing, and one failure never stops the others', async () => {
    const { host, lifecycle } = await closed('t-1');
    (host.tenantOf('t-1') as { status: string }).status = 'OPEN';
    expect(await lifecycle.sweep(new Date(PURGE.getTime() + 1))).toEqual({
      reminded: { week: 0, day: 0 },
      purged: 0,
      afterCloseRetried: 0,
    });
    expect(host.knobs.purgeCalls).toBe(0);

    (host.tenantOf('t-1') as { status: string }).status = 'WINDING_DOWN';
    host.state.closings.unshift({ ...host.closingOf('t-1')!, tenantId: 'ghost', purgeAt: new Date(0) });
    const broken = host.build({
      onPurgeDue: async (tenantId) => {
        if (tenantId === 't-1') throw new Error('disk full');
        return 'purged';
      },
    });
    host.state.tenants.push({ id: 'ghost', slug: 'ghost', status: 'SHUT', name: 'Ghost' });
    expect((await broken.lifecycle!.sweep(new Date(PURGE.getTime() + 1))).purged).toBe(1);
    expect(host.errors.map((entry) => `${entry.act}:${entry.tenantId}`)).toEqual(['sweep:t-1']);
  });

  it('words each reminder in the locale asked, the day in the zone asked', async () => {
    const { host, lifecycle } = await closed('t-1');
    await lifecycle.sweep(before(6.5));
    const payload = host.notices[0]!.payload;
    expect(lifecycle.noticeWords('clinic.closing_week', payload, { locale: 'xx', timeZone: 'UTC' })).toEqual({
      title: 'en-GB: noticeWeekTitle(Clínica Norte).',
      body: 'en-GB: noticeWeekBody(Clínica Norte, 26/12/2026).',
    });
    expect(() => lifecycle.noticeWords('clinic.export_ready', payload, { locale: null, timeZone: 'UTC' })).toThrow(RangeError);
  });
});

describe('the pure readings', () => {
  it('counts the grace period in milliseconds', () => {
    expect(purgeAtFor(NOW, 30).getTime() - NOW.getTime()).toBe(30 * DAY_MS);
  });

  it('compares names in the configured locale', () => {
    expect(sameTenantName('  İSTANBUL  klinik', 'istanbul Klinik', 'tr')).toBe(true);
    expect(sameTenantName('   ', '', 'pt-BR')).toBe(false);
  });

  it('sends the day alone when the week was missed, and nothing once due', () => {
    const days = { week: 7, day: 1 };
    expect(reminderDue(PURGE, { week: false, day: false }, before(0.5), days)).toBe('day');
    expect(reminderDue(PURGE, { week: false, day: true }, before(3), days)).toBeNull();
    expect(reminderDue(PURGE, { week: false, day: false }, PURGE, days)).toBeNull();
  });
});
