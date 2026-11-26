import { describe, expect, it } from 'vitest';

import { TenantConfigError, TenantLifecycleRefusal, createApiTenant } from '../server';
import { DAY_MS, lifecycleHost, request } from './lifecycle-fixtures';

/**
 * Closing a tenant, on in-memory fakes whose transactions roll back: the order
 * of the refusals, the compare-and-set race, the blockers rolling the move
 * back, the tree blocker, the two entries, and the hooks after the commit.
 */

const NOW = new Date('2026-11-26T12:00:00.000Z');

async function refusalOf(run: () => Promise<unknown>): Promise<TenantLifecycleRefusal> {
  try {
    await run();
  } catch (error) {
    if (error instanceof TenantLifecycleRefusal) return error;
    throw error;
  }
  throw new Error('expected a refusal, nothing was thrown');
}

function memberClose(host: ReturnType<typeof lifecycleHost>, overrides: Record<string, unknown> = {}) {
  const lifecycle = host.tenant().lifecycle;
  if (!lifecycle) throw new Error('no lifecycle');
  return lifecycle.close({
    tenant: { ...host.tenantOf('t-1')! },
    by: 'member',
    reason: '  Moving away  ',
    typedName: '  clínica   NORTE ',
    actorUserId: 'u-1',
    request: request(),
    now: NOW,
    ...overrides,
  });
}

describe('a member closes', () => {
  it('moves the tenant, writes the row, mirrors and audits in one transaction, then runs the hooks', async () => {
    const host = lifecycleHost();
    const state = await memberClose(host);
    expect(state).toEqual({
      status: 'WINDING_DOWN',
      requestedAt: NOW.toISOString(),
      purgeAt: new Date(NOW.getTime() + 30 * DAY_MS).toISOString(),
    });
    expect(host.tenantOf('t-1')?.status).toBe('WINDING_DOWN');
    expect(host.closingOf('t-1')).toMatchObject({
      requestedById: 'u-1',
      reason: 'Moving away',
      priorStatus: 'OPEN',
      afterCloseDoneAt: NOW,
    });
    expect(host.log).toEqual([
      'confirm',
      'begin',
      'setStatusIf:OPEN->WINDING_DOWN',
      'blockers:tx',
      'deleteMany',
      'create',
      'mirror:replaced',
      'audit:clinic_close.scheduled',
      'commit',
      'afterClose',
      'begin',
      'updateMany',
      'mirror:afterClose',
      'commit',
      'invalidate',
      'notify:clinic.closing_scheduled',
    ]);
    expect(host.state.audit[0]?.event).toMatchObject({ act: 'closeScheduled', by: 'member', priorStatus: 'OPEN' });
    expect(host.notices[0]?.payload).toEqual({
      tenantId: 't-1',
      name: 'Clínica Norte',
      slug: 'north',
      purgeAt: state.purgeAt,
      by: 'member',
      reason: null,
      restored: null,
    });
  });

  it('asks the dangerous-act confirmation first, then the reason, then the name', async () => {
    const host = lifecycleHost();
    host.knobs.confirmRefuses = true;
    await expect(memberClose(host, { reason: 'x', typedName: 'nope' })).rejects.toThrow('PIN required');
    host.knobs.confirmRefuses = false;
    const short = await refusalOf(() => memberClose(host, { reason: ' xy ', typedName: 'nope' }));
    expect(short).toMatchObject({ kind: 'reasonTooShort', code: 'CLINIC_REASON_TOO_SHORT', status: 422 });
    expect(short.message).toBe('en-GB: refusalReasonTooShort.');
    const name = await refusalOf(() => memberClose(host, { typedName: 'Clínica Sul' }));
    expect(name).toMatchObject({ kind: 'nameMismatch', code: 'CLINIC_NAME_MISMATCH', status: 422 });
    expect(host.tenantOf('t-1')?.status).toBe('OPEN');
  });

  it('refuses a member close from a status other than active, by what the transaction reads', async () => {
    const host = lifecycleHost();
    const lifecycle = host.tenant().lifecycle;
    const onHold = await refusalOf(() =>
      lifecycle!.close({
        tenant: host.tenantOf('t-2') as never,
        by: 'member',
        reason: 'Moving',
        typedName: 'Clínica Sul',
        actorUserId: 'u-1',
        request: request(),
      }),
    );
    expect(onHold).toMatchObject({ kind: 'notActive', code: 'CLINIC_NOT_OPEN', status: 409 });
    await memberClose(host);
    const again = await refusalOf(() => memberClose(host, { tenant: { id: 't-1', slug: 'north', status: 'OPEN', name: 'Clínica Norte' } }));
    expect(again).toMatchObject({ kind: 'alreadyClosing', status: 409 });
  });

  it('loses a compare-and-set race cleanly', async () => {
    const host = lifecycleHost();
    const stale = { ...(host.tenantOf('t-1') as object), status: 'OPEN' };
    (host.tenantOf('t-1') as { status: string }).status = 'SHUT';
    const refusal = await refusalOf(() => memberClose(host, { tenant: stale }));
    expect(refusal.kind).toBe('alreadyClosing');
    expect(host.state.closings).toEqual([]);
  });

  it('rolls the move back when the recount inside the transaction finds a blocker', async () => {
    const host = lifecycleHost();
    host.knobs.onRecount = () => {
      host.knobs.blockers = [{ kind: 'patients', count: 2 }];
    };
    const refusal = await refusalOf(() => memberClose(host));
    expect(refusal).toMatchObject({ kind: 'closingBlocked', code: 'CLINIC_CLOSE_BLOCKED', details: { pending: 1 } });
    expect(refusal.message).toBe('en-GB: refusalBlocked(1).');
    expect(host.tenantOf('t-1')?.status).toBe('OPEN');
    expect(host.state.closings).toEqual([]);
    expect(host.state.mirror).toEqual({});
    expect(host.notices).toEqual([]);
  });

  it('stamps and audits an after-close hook that throws, and the act stands', async () => {
    const host = lifecycleHost();
    host.knobs.afterCloseFails = 1;
    await memberClose(host);
    expect(host.closingOf('t-1')).toMatchObject({ afterCloseDoneAt: null, afterCloseFailedAt: NOW });
    expect(host.state.audit.map((line) => line.action)).toEqual(['clinic_close.scheduled', 'clinic_close.after_close_failed']);
    expect(host.state.audit[1]?.event).toEqual({ act: 'afterCloseFailed', tenantId: 't-1', error: 'billing timeout' });
    expect(host.state.mirror['t-1']).toHaveProperty('event:afterClose', NOW);
    expect(host.errors.map((entry) => entry.act)).toEqual(['afterClose']);
    expect(host.tenantOf('t-1')?.status).toBe('WINDING_DOWN');
    expect(host.notices).toHaveLength(1);
  });

  it('never lets invalidate or notify undo the committed close', async () => {
    const host = lifecycleHost();
    const tenant = host.build({
      invalidate: async () => {
        throw new Error('cache down');
      },
      notify: async () => {
        throw new Error('mail down');
      },
    });
    const state = await tenant.lifecycle!.close({
      tenant: host.tenantOf('t-1') as never,
      by: 'member',
      reason: 'Moving',
      typedName: 'Clínica Norte',
      actorUserId: 'u-1',
      request: request(),
    });
    expect(state.status).toBe('WINDING_DOWN');
    expect(host.errors.map((entry) => entry.act)).toEqual(['invalidate', 'notify']);
  });

  it('refuses, as a programming error, a port record with no name', async () => {
    const host = lifecycleHost();
    const error = await memberClose(host, { tenant: { id: 't-1', slug: 'north', status: 'OPEN' } }).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(TenantConfigError);
    expect((error as TenantConfigError).message).toMatch(/caller's record/u);
  });
});

describe('the platform closes', () => {
  it('closes from a closableFrom status with no name, records the prior status and a null requester, and tells the reason', async () => {
    const host = lifecycleHost();
    const lifecycle = host.tenant().lifecycle!;
    await lifecycle.close({
      tenant: host.tenantOf('t-2') as never,
      by: 'platform',
      reason: 'Fraud review',
      actorUserId: 'ignored',
      request: request(),
      now: NOW,
    });
    expect(host.tenantOf('t-2')?.status).toBe('WINDING_DOWN');
    expect(host.closingOf('t-2')).toMatchObject({ requestedById: null, priorStatus: 'ON_HOLD' });
    expect(host.state.audit[0]?.event).toMatchObject({ by: 'platform', priorStatus: 'ON_HOLD', reason: 'Fraud review' });
    expect(host.notices[0]?.payload).toMatchObject({ by: 'platform', reason: 'Fraud review' });
    const words = lifecycle.noticeWords('clinic.closing_scheduled', host.notices[0]!.payload, { locale: 'pt-BR', timeZone: 'UTC' });
    expect(words).toEqual({
      title: 'pt-BR: platform title(Clínica Sul).',
      body: 'pt-BR: platform body(Clínica Sul, 26/12/2026, Fraud review).',
    });
  });

  it('refuses a status outside closableFrom', async () => {
    const host = lifecycleHost();
    (host.tenantOf('t-2') as { status: string }).status = 'AWAITING_REVIEW';
    const refusal = await refusalOf(() =>
      host.tenant().lifecycle!.close({
        tenant: host.tenantOf('t-2') as never,
        by: 'platform',
        reason: 'Fraud review',
        actorUserId: null,
        request: request(),
      }),
    );
    expect(refusal.kind).toBe('notActive');
  });
});

describe('the tree blocker', () => {
  const tree = [
    { id: 't-1', parentId: null, path: '/t-1/' },
    { id: 't-2', parentId: 't-1', path: '/t-1/t-2/' },
  ];

  it('counts an open unit, and only an open one', async () => {
    const host = lifecycleHost({ tree });
    const lifecycle = host.tenant().lifecycle!;
    expect(await lifecycle.blockers('t-1', NOW)).toEqual([{ kind: 'units', count: 1, path: 'units' }]);
    const refusal = await refusalOf(() => memberClose(host));
    expect(refusal.kind).toBe('closingBlocked');
    (host.tenantOf('t-2') as { status: string }).status = 'WINDING_DOWN';
    expect(await lifecycle.blockers('t-1', NOW)).toEqual([]);
  });

  it('counts open units in ONE read, from the status the descendants read carries', async () => {
    const host = lifecycleHost({ tree });
    await host.tenant().lifecycle!.blockers('t-1', NOW);
    expect(host.log).toEqual(['blockers', 'treeDescendants']);
  });

  it('names the tree port when its descendants read carries no status', async () => {
    const host = lifecycleHost({ tree });
    const tenant = createApiTenant({
      ...host.config,
      tree: { ...host.config.tree!, treeDescendants: async () => tree },
      lifecycle: host.lifecycle,
    });
    await expect(tenant.lifecycle!.blockers('t-1', NOW)).rejects.toMatchObject({ key: 'tree.treeDescendants' });
  });

  it('hands the after-close hook the node, so a unit can leave its root alone', async () => {
    const host = lifecycleHost({ tree });
    (host.tenantOf('t-2') as { status: string }).status = 'OPEN';
    await host.tenant().lifecycle!.close({
      tenant: host.tenantOf('t-2') as never,
      by: 'member',
      reason: 'Moving',
      typedName: 'Clínica Sul',
      actorUserId: 'u-1',
      request: request(),
    });
    expect(host.knobs.lastNode).toEqual({ id: 't-2', parentId: 't-1', path: '/t-1/t-2/' });
  });
});

describe('blockers and state', () => {
  it('answers the host blockers with their paths and details, dropping zero counts', async () => {
    const host = lifecycleHost();
    host.knobs.blockers = [
      { kind: 'patients', count: 0 },
      { kind: 'invoices', count: 2, detail: { amount: 1200, day: '01/12' } },
    ];
    expect(await host.tenant().lifecycle!.blockers('t-1')).toEqual([
      { kind: 'invoices', count: 2, detail: { amount: 1200, day: '01/12' }, path: 'billing' },
    ]);
  });

  it('names a kind the host did not list', async () => {
    const host = lifecycleHost();
    host.knobs.blockers = [{ kind: 'beds', count: 1 }];
    await expect(host.tenant().lifecycle!.blockers('t-1')).rejects.toBeInstanceOf(TenantConfigError);
  });

  it('reads nothing for a live tenant, and the row for a gone one', async () => {
    const host = lifecycleHost();
    const lifecycle = host.tenant().lifecycle!;
    expect(await lifecycle.state({ id: 't-1', status: 'OPEN' })).toEqual({ status: 'OPEN', requestedAt: null, purgeAt: null });
    expect(host.log).toEqual([]);
    await memberClose(host);
    host.log.length = 0;
    expect(await lifecycle.state({ id: 't-1', status: 'WINDING_DOWN' })).toMatchObject({ requestedAt: NOW.toISOString() });
    expect(host.log).toEqual(['findUnique']);
  });
});
