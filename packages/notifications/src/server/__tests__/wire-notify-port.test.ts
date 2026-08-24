/**
 * `wireNotifyPort` — the adapter that ends the silent invite.
 *
 * The cases are grouped by the property that makes the port safe to hand a
 * package which knows nothing about a host's pipeline: an emit is an OUTCOME,
 * never an exception. Every failure path this package can produce is covered,
 * because "never throws" is not a claim a type can carry.
 */

import { describe, expect, it } from 'vitest';

import { UnknownNotificationRecipientError, UnknownNotificationTypeError } from '../../errors';
import { wireNotifyPort, type NotifyPortSource } from '../wire-notify-port';

interface Call {
  kind: 'notify' | 'byPermission';
  args: unknown[];
}

/**
 * A recorder built per case — the flakiness lane refuses a closed-over binding
 * reassigned from inside a stub, so state lives on a container instead.
 */
function source(overrides: Partial<NotifyPortSource> = {}): {
  api: NotifyPortSource;
  calls: Call[];
} {
  const calls: Call[] = [];
  const api: NotifyPortSource = {
    notify: ((...args: unknown[]) => {
      calls.push({ kind: 'notify', args });
      return Promise.resolve({ notificationId: 'n1', channels: ['EMAIL'] });
    }) as NotifyPortSource['notify'],
    notifyByPermission: ((...args: unknown[]) => {
      calls.push({ kind: 'byPermission', args });
      return Promise.resolve({ notified: ['u1'], skipped: [] });
    }) as NotifyPortSource['notifyByPermission'],
    ...overrides,
  };
  return { api, calls };
}

describe('addressing one user', () => {
  it('routes a userId recipient at notify and accepts the emit', async () => {
    const { api, calls } = source();
    const outcome = await wireNotifyPort(api).emit({
      type: 'team.invited',
      recipient: { userId: 'u1' },
      payload: { inviteId: 'i1' },
    });

    expect(outcome).toEqual({ accepted: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.kind).toBe('notify');
    expect(calls[0]?.args[0]).toEqual({
      type: 'team.invited',
      recipient: { userId: 'u1' },
      payload: { inviteId: 'i1' },
    });
  });
});

describe('addressing whoever holds a permission', () => {
  it('routes a tenant+permission recipient at notifyByPermission', async () => {
    const { api, calls } = source();
    const outcome = await wireNotifyPort(api).emit({
      type: 'payment.short',
      recipient: { tenantId: 't1', permission: 'payments:manage' },
      payload: { orderId: 'o1' },
    });

    expect(outcome).toEqual({ accepted: true });
    expect(calls[0]?.kind).toBe('byPermission');
    expect(calls[0]?.args.slice(0, 2)).toEqual(['t1', ['payments:manage']]);
    expect(calls[0]?.args[2]).toEqual({ type: 'payment.short', payload: { orderId: 'o1' } });
  });

  it('reports reaching nobody as unaccepted WITHOUT calling it a failure of the pipeline', async () => {
    // A tenant with no manager is a correct fan-out that reached zero people.
    // The count travels in the reason so a host can tell the two apart.
    const { api } = source({
      notifyByPermission: (() =>
        Promise.resolve({
          notified: [],
          skipped: [{ userId: 'u9', reason: 'missing-permission' }],
        })) as NotifyPortSource['notifyByPermission'],
    });

    const outcome = await wireNotifyPort(api).emit({
      type: 'payment.short',
      recipient: { tenantId: 't1', permission: 'payments:manage' },
      payload: {},
    });

    expect(outcome.accepted).toBe(false);
    expect(outcome.reason).toContain('no user of tenant "t1" holds "payments:manage"');
    expect(outcome.reason).toContain('1 candidates skipped');
  });
});

describe('the never-throws rule', () => {
  it('turns an unregistered type into the wiring-gap reason', async () => {
    const { api } = source({
      notify: (() =>
        Promise.reject(new UnknownNotificationTypeError('team.invited'))) as NotifyPortSource['notify'],
    });

    const outcome = await wireNotifyPort(api).emit({
      type: 'team.invited',
      recipient: { userId: 'u1' },
      payload: {},
    });

    expect(outcome.accepted).toBe(false);
    // The most likely thing to be wrong the first time a package's event
    // reaches a host: the blueprint was declared and never bound.
    expect(outcome.reason).toContain('no generator is registered');
    expect(outcome.reason).toContain('team.invited');
  });

  it('turns an unresolvable recipient into a reason rather than an exception', async () => {
    const { api } = source({
      notify: (() =>
        Promise.reject(new UnknownNotificationRecipientError('u404'))) as NotifyPortSource['notify'],
    });

    const outcome = await wireNotifyPort(api).emit({
      type: 'team.invited',
      recipient: { userId: 'u404' },
      payload: {},
    });

    expect(outcome.accepted).toBe(false);
    expect(outcome.reason).toContain('does not resolve to a user');
  });

  it('surfaces the missing audience directory loudly, still without throwing', async () => {
    // This is the unmounted `notifyByPermission`, whose rejection is the one
    // the package deliberately makes loud: the alternative is a money alert
    // nobody gets.
    const { api } = source({
      notifyByPermission: (() =>
        Promise.reject(
          new Error('notifyByPermission() needs an `audience` directory'),
        )) as NotifyPortSource['notifyByPermission'],
    });

    const outcome = await wireNotifyPort(api).emit({
      type: 'payment.short',
      recipient: { tenantId: 't1', permission: 'payments:manage' },
      payload: {},
    });

    expect(outcome.accepted).toBe(false);
    expect(outcome.reason).toContain('`audience` directory');
  });

  it('survives a non-Error rejection — a caller must never see one either', async () => {
    const { api } = source({
      notify: (() => Promise.reject('database is on fire')) as NotifyPortSource['notify'],
    });

    const outcome = await wireNotifyPort(api).emit({
      type: 'team.invited',
      recipient: { userId: 'u1' },
      payload: {},
    });

    expect(outcome).toEqual({ accepted: false, reason: 'database is on fire' });
  });
});
