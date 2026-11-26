import { describe, expect, it } from 'vitest';

import { purgeAtFor, reminderDue, sameTenantName } from '../index';
import { TenantLifecycleRefusal, createApiTenant, createNoticeWords } from '../server';
import { serverConfig } from './fixtures';
import { DAY_MS, lifecycleHost, request } from './lifecycle-fixtures';

/** Reopening, the sweep, and the pure readings they rest on. */

/** Fresh Dates each call: no Date object is shared between tests. */
function now(): Date {
  return new Date('2026-11-26T12:00:00.000Z');
}

function purgeDay(): Date {
  return new Date(now().getTime() + 30 * DAY_MS);
}

function before(days: number): Date {
  return new Date(purgeDay().getTime() - days * DAY_MS);
}

async function closed(id: 't-1' | 't-2', by: 'member' | 'platform' = id === 't-1' ? 'member' : 'platform') {
  const made = lifecycleHost();
  const flow = made.tenant().lifecycle!;
  await flow.close({
    tenant: { ...made.tenantOf(id)! },
    by,
    reason: 'Moving',
    typedName: made.tenantOf(id)?.name,
    actorUserId: 'u-1',
    request: request(),
    now: now(),
  });
  made.log.length = 0;
  made.notices.length = 0;
  return { host: made, lifecycle: flow };
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
      purgeAt: purgeDay(),
      restored: 'ON_HOLD',
    });
    expect(host.notices.map((notice) => notice.type)).toEqual(['clinic.reopened']);
    expect(host.notices[0]?.payload.restored).toBe('ON_HOLD');
    // The older table loses only that same close (a re-close it recorded since stays).
    expect(host.mirrorDeletes).toEqual([{ tenantId: 't-2', requestedAt: now() }]);
  });

  it('restores active when no prior status was recorded (a row copied from before the column)', async () => {
    const { host, lifecycle } = await closed('t-2');
    host.closingOf('t-2')!.priorStatus = null;
    expect((await lifecycle.reopen({ tenant: host.tenantOf('t-2') as never, by: 'member' })).status).toBe('OPEN');
  });

  it('refuses a purged tenant and one that is not closing', async () => {
    const { host, lifecycle } = await closed('t-1');
    host.closingOf('t-1')!.purgedAt = purgeDay();
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
      now: now(),
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
    const after = new Date(purgeDay().getTime() + 60_000);
    expect((await lifecycle.sweep(after)).purged).toBe(counted);
    expect(host.closingOf('t-1')?.purgedAt).toEqual(stamped ? after : null);
    expect(host.knobs.purgeCalls).toBe(1);
    await lifecycle.sweep(after);
    expect(host.knobs.purgeCalls).toBe(stamped ? 1 : 2);
  });

  it('drops a stale row of a tenant that is no longer closing, with its mirror, and purges nothing', async () => {
    const { host, lifecycle } = await closed('t-1');
    (host.tenantOf('t-1') as { status: string }).status = 'OPEN';
    expect(await lifecycle.sweep(new Date(purgeDay().getTime() + 1))).toEqual({
      reminded: { week: 0, day: 0 },
      purged: 0,
      afterCloseRetried: 0,
    });
    expect(host.knobs.purgeCalls).toBe(0);
    expect(host.state.closings).toEqual([]);
    expect(host.state.mirror).toEqual({});
    expect(host.mirrorDeletes).toEqual([{ tenantId: 't-1', requestedAt: now() }]);
  });

  it('keeps a stale row whose close was replaced since the read (the delete is conditional on requestedAt)', async () => {
    const { host } = await closed('t-1');
    (host.tenantOf('t-1') as { status: string }).status = 'OPEN';
    const replaced = new Date(now().getTime() + 1000);
    const broken = host.build({
      onError: () => undefined,
      blockers: {
        ...host.lifecycle.blockers,
        read: async () => [],
      },
    });
    // The row moves under the sweep: another close replaced it between the page read and the delete.
    const realById = host.config.port.byId;
    host.config.port.byId = async (id, tx) => {
      const found = await realById(id, tx);
      if (id === 't-1') host.closingOf('t-1')!.requestedAt = replaced;
      return found;
    };
    await broken.lifecycle!.sweep(new Date(purgeDay().getTime() + 1));
    host.config.port.byId = realById;
    expect(host.closingOf('t-1')?.requestedAt).toEqual(replaced);
  });

  it('never lets 250 stale rows ahead of a due tenant keep it waiting: one pass reaches it', async () => {
    const { host, lifecycle } = await closed('t-1');
    for (let index = 0; index < 250; index += 1) {
      const id = `stale-${String(index).padStart(3, '0')}`;
      host.state.tenants.push({ id, slug: id, status: 'OPEN', name: id });
      host.state.closings.push({ ...host.closingOf('t-1')!, tenantId: id, purgeAt: new Date(index) });
    }
    const result = await lifecycle.sweep(new Date(purgeDay().getTime() + 1));
    expect(result.purged).toBe(1);
    expect(host.state.closings.map((row) => row.tenantId)).toEqual(['t-1']);
    expect(host.closingOf('t-1')?.purgedAt).not.toBeNull();
  });

  it('sweeps at most sweepBatch live tenants a pass, and one failure never stops the others', async () => {
    const { host } = await closed('t-1');
    host.state.closings.unshift({ ...host.closingOf('t-1')!, tenantId: 'ghost', purgeAt: new Date(0) });
    host.state.tenants.push({ id: 'ghost', slug: 'ghost', status: 'SHUT', name: 'Ghost' });
    const broken = host.build({
      sweepBatch: 1,
      onPurgeDue: async (tenantId) => {
        if (tenantId === 't-1') throw new Error('disk full');
        return 'purged';
      },
    });
    expect((await broken.lifecycle!.sweep(new Date(purgeDay().getTime() + 1))).purged).toBe(1);
    expect(host.knobs.purgeCalls).toBe(0);
    expect(host.errors).toEqual([]);
    const wide = host.build({
      onPurgeDue: async (tenantId) => {
        if (tenantId === 't-1') throw new Error('disk full');
        return 'purged';
      },
    });
    await wide.lifecycle!.sweep(new Date(purgeDay().getTime() + 1));
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

describe('createNoticeWords', () => {
  it('words the notices from the packs alone, with no lifecycle hooks', () => {
    const words = createNoticeWords(createApiTenant(serverConfig()), {
      copy: {
        locales: {
          'en-GB': {
            noticePlatformScheduledTitle: (name) => `t:${name}`,
            noticePlatformScheduledBody: (n, d, r) => `b:${n}:${d}:${r}`,
            noticePlatformScheduledBodyNoReason: (n, d) => `b0:${n}:${d}`,
            noticeReopenedRestoredTitle: (n) => `rt:${n}`,
            noticeReopenedRestoredBody: (n) => `rb:${n}`,
          },
          'pt-BR': {
            noticePlatformScheduledTitle: (name) => `pt:${name}`,
            noticePlatformScheduledBody: (n, d, r) => `pb:${n}:${d}:${r}`,
            noticePlatformScheduledBodyNoReason: (n, d) => `pb0:${n}:${d}`,
            noticeReopenedRestoredTitle: (n) => `prt:${n}`,
            noticeReopenedRestoredBody: (n) => `prb:${n}`,
          },
        },
      },
    });
    const payload = { tenantId: 't-1', name: 'North', slug: 'north', purgeAt: purgeDay().toISOString(), by: 'platform' as const, reason: 'Audit' };
    expect(words('clinic.closing_scheduled', payload, { locale: 'en-GB', timeZone: 'UTC' })).toEqual({
      title: 't:North',
      body: 'b:North:26/12/2026:Audit',
    });
    expect(words('clinic.reopened', payload, { locale: null, timeZone: 'UTC' }).title).toBe('en-GB: noticeReopenedTitle(North).');
  });

  it('words a platform close with no reason through its own sentence, never "Motivo: ."', () => {
    const host = lifecycleHost();
    const words = host.tenant().lifecycle!.noticeWords;
    const payload = { tenantId: 't-2', name: 'Sul', slug: 'south', purgeAt: purgeDay().toISOString(), by: 'platform' as const, reason: null };
    expect(words('clinic.closing_scheduled', payload, { locale: 'pt-BR', timeZone: 'UTC' }).body).toBe(
      'pt-BR: platform body, no reason(Sul, 26/12/2026).',
    );
    expect(words('clinic.closing_scheduled', { ...payload, reason: '   ' }, { locale: 'pt-BR', timeZone: 'UTC' }).body).toBe(
      'pt-BR: platform body, no reason(Sul, 26/12/2026).',
    );
  });

  it('words a reopen that restored a status other than active through the restored sentences', () => {
    const host = lifecycleHost();
    const words = host.tenant().lifecycle!.noticeWords;
    const payload = { tenantId: 't-2', name: 'Sul', slug: 'south', purgeAt: purgeDay().toISOString(), by: null, reason: null };
    expect(words('clinic.reopened', { ...payload, restored: 'ON_HOLD' }, { locale: 'pt-BR', timeZone: 'UTC' })).toEqual({
      title: 'pt-BR: restored title(Sul).',
      body: 'pt-BR: restored body(Sul).',
    });
    for (const restored of ['OPEN', null, undefined]) {
      expect(words('clinic.reopened', { ...payload, restored }, { locale: 'pt-BR', timeZone: 'UTC' }).title).toBe(
        'pt-BR: noticeReopenedTitle(Sul).',
      );
    }
  });

  it('validates the copy extension for every locale of the base copy, naming the missing one', () => {
    const tenant = createApiTenant(serverConfig());
    const one = { noticePlatformScheduledTitle: () => 'x', noticePlatformScheduledBody: () => 'x', noticePlatformScheduledBodyNoReason: () => 'x', noticeReopenedRestoredTitle: () => 'x', noticeReopenedRestoredBody: () => 'x' };
    expect(() => createNoticeWords(tenant, { copy: { locales: { 'en-GB': one } } })).toThrow(/lifecycle\.copy\.locales\.pt-BR/u);
    expect(() =>
      createNoticeWords(tenant, { copy: { locales: { 'en-GB': one, 'pt-BR': { ...one, noticeReopenedRestoredBody: 'text' } } } } as never),
    ).toThrow(/noticeReopenedRestoredBody/u);
  });
});

describe('the pure readings', () => {
  it('counts the grace period in milliseconds', () => {
    expect(purgeAtFor(now(), 30).getTime() - now().getTime()).toBe(30 * DAY_MS);
  });

  it('compares names in the configured locale', () => {
    expect(sameTenantName('  İSTANBUL  klinik', 'istanbul Klinik', 'tr')).toBe(true);
    expect(sameTenantName('   ', '', 'pt-BR')).toBe(false);
  });

  it('sends the day alone when the week was missed, and nothing once due', () => {
    const days = { week: 7, day: 1 };
    expect(reminderDue(purgeDay(), { week: false, day: false }, before(0.5), days)).toBe('day');
    expect(reminderDue(purgeDay(), { week: false, day: true }, before(3), days)).toBeNull();
    expect(reminderDue(purgeDay(), { week: false, day: false }, purgeDay(), days)).toBeNull();
  });
});
