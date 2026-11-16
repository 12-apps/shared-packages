/* eslint-disable test-flakiness/no-test-isolation, test-flakiness/no-global-state-mutation --
   `db`, `sends`, `emails` and `reached` are rebuilt per case in `beforeEach`;
   the rule flags the module-scoped bindings they are assigned to, and the
   recorders are what the assertions read. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as server from '../index';
import type { ApiNotifications } from '../create-api-notifications';

import {
  clinicConsent,
  consentOf,
  emailTransport,
  mountContract,
  phoneTransport,
  type CapsConfig,
  type ContractConfig,
  type PhoneSend,
} from './consent-contract';
import { createMemoryDb, type MemoryDb } from './memory-db';

/**
 * FUT-285 contract — the paid-message caps.
 *
 * On `main` nothing counts: the 11th SMS of a person's day and the 501st of a
 * store's month are sent like the first (no cap anywhere on the emit path,
 * `router.ts:235-259`).
 *
 * The contract (owner, 2026-11-16):
 *  - per PERSON per DAY (host value, default 10) and per TENANT per MONTH
 *    (host value, default 500), each delivery on a paid channel counting ONE
 *    message, counted at CREATION;
 *  - the counter is an atomic increment-below-cap: N parallel creations at
 *    cap-1 let exactly one through;
 *  - at a cap only the paid channel is skipped: the free channels the person
 *    already has on and the inbox remain (nothing is turned on for them);
 *  - a message refused by one scope does not consume the other;
 *  - the tenant hook fires ONCE per (tenant, period), under concurrency too,
 *    when the cap first refuses a message; the person cap tells nobody;
 *  - the person's day is in the host's zone, the tenant's month in the
 *    tenant's zone.
 */

let db: MemoryDb;
let sends: PhoneSend[];
let emails: string[];
let reached: { tenantId: string; period: string }[];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  // 12:00 in São Paulo (UTC-3).
  vi.setSystemTime(new Date('2026-11-16T15:00:00.000Z'));
  db = createMemoryDb();
  sends = [];
  emails = [];
  reached = [];
});

afterEach(() => {
  vi.useRealTimers();
});

function caps(overrides: Partial<CapsConfig> = {}): CapsConfig {
  return {
    timeZone: 'America/Sao_Paulo',
    perRecipientDaily: () => 3,
    perTenantMonthly: () => 5,
    onTenantCapReached: (tenantId, period) => {
      reached.push({ tenantId, period });
    },
    ...overrides,
  };
}

async function mount(extra: Partial<ContractConfig> = {}): Promise<ApiNotifications> {
  const api = mountContract(db, { caps: caps(), ...extra });
  api.transports.register(emailTransport(emails));
  api.transports.register(phoneTransport('SMS', sends));
  api.transports.register(phoneTransport('WHATSAPP', sends));
  for (const userId of ['u1', 'u2', 'u3']) {
    await api.preferences.save(userId, { orders: { SMS: true } });
  }
  return api;
}

function emit(api: ApiNotifications, userId: string, clientId?: string) {
  return api.notify(
    { type: 'order.paid', recipient: { userId, ...(clientId ? { clientId } : {}) }, payload: { code: 'C' } },
    { sync: true },
  );
}

const paid = (channels: readonly string[]): string[] =>
  channels.filter((channel) => channel === 'SMS' || channel === 'WHATSAPP');

describe('defaults', () => {
  it('the package defaults are 10 a person a day and 500 a tenant a month', () => {
    expect(server.DEFAULT_PER_RECIPIENT_DAILY_CAP).toBe(10);
    expect(server.DEFAULT_PER_TENANT_MONTHLY_CAP).toBe(500);
  });

  it('with no resolver, the 11th paid message of a person\'s day is refused', async () => {
    const api = await mount({ caps: { timeZone: 'America/Sao_Paulo' } });
    for (let i = 0; i < 10; i += 1) expect(paid((await emit(api, 'u1')).channels)).toEqual(['SMS']);
    expect(paid((await emit(api, 'u1')).channels)).toEqual([]);
    expect(sends).toHaveLength(10);
  });
});

describe('per person per day', () => {
  it('the message past the cap keeps its free channels and its inbox row', async () => {
    const api = await mount();
    for (let i = 0; i < 3; i += 1) await emit(api, 'u1');
    const fourth = await emit(api, 'u1');
    expect(fourth.channels).toEqual(['EMAIL']);
    expect(sends).toHaveLength(3);
    expect(emails).toHaveLength(4);
    expect(db.rows.notifications).toHaveLength(4);
  });

  it('nothing is turned on for the person: with e-mail off the capped message reaches the inbox only', async () => {
    const api = await mount();
    await api.preferences.save('u1', { orders: { EMAIL: false } });
    for (let i = 0; i < 3; i += 1) await emit(api, 'u1');
    const fourth = await emit(api, 'u1');
    expect(fourth.channels).toEqual([]);
    expect(db.rows.notifications).toHaveLength(4);
  });

  it('each paid delivery counts one: SMS + WhatsApp on one emit is two messages', async () => {
    const api = await mount();
    await api.preferences.save('u1', { orders: { SMS: true, WHATSAPP: true } });
    expect(paid((await emit(api, 'u1')).channels)).toEqual(['SMS', 'WHATSAPP']);
    // 2 of 3 spent: one paid channel survives, never both.
    expect(paid((await emit(api, 'u1')).channels)).toHaveLength(1);
    expect(paid((await emit(api, 'u1')).channels)).toEqual([]);
    expect(sends).toHaveLength(3);
  });

  it('is per person: another person is unaffected', async () => {
    const api = await mount();
    for (let i = 0; i < 4; i += 1) await emit(api, 'u1');
    expect(paid((await emit(api, 'u2')).channels)).toEqual(['SMS']);
  });

  it('counts across tenants: the person cap is one budget for every store', async () => {
    const api = await mount();
    await emit(api, 'u1', 't1');
    await emit(api, 'u1', 't2');
    await emit(api, 'u1');
    expect(paid((await emit(api, 'u1', 't3')).channels)).toEqual([]);
  });

  it('rolls over at midnight in the host zone, not in UTC', async () => {
    const api = await mount();
    // 23:30 in São Paulo = 02:30 UTC the NEXT day.
    vi.setSystemTime(new Date('2026-11-17T02:30:00.000Z'));
    for (let i = 0; i < 3; i += 1) await emit(api, 'u1');
    expect(paid((await emit(api, 'u1')).channels)).toEqual([]);
    // 00:01 in São Paulo.
    vi.setSystemTime(new Date('2026-11-17T03:01:00.000Z'));
    expect(paid((await emit(api, 'u1')).channels)).toEqual(['SMS']);
  });

  it('N parallel creations at cap-1: exactly one passes', async () => {
    const api = await mount();
    await emit(api, 'u1');
    await emit(api, 'u1');
    const results = await Promise.all(Array.from({ length: 10 }, () => emit(api, 'u1')));
    expect(results.filter((result) => paid(result.channels).length > 0)).toHaveLength(1);
    expect(sends).toHaveLength(3);
    // Every one of them still reached the inbox.
    expect(db.rows.notifications).toHaveLength(12);
  });

  it('reaching the person cap tells the tenant nothing', async () => {
    const api = await mount();
    for (let i = 0; i < 4; i += 1) await emit(api, 'u1', 't1');
    expect(reached).toEqual([]);
  });

  it('a channel dropped by consent is not counted', async () => {
    const api = await mount({ requireConsent: ['WHATSAPP'], consent: clinicConsent() });
    await api.preferences.save('u1', { orders: { SMS: true, WHATSAPP: true } });
    // WhatsApp is unconfirmed: each emit spends ONE (the SMS), not two.
    for (let i = 0; i < 3; i += 1) expect(paid((await emit(api, 'u1')).channels)).toEqual(['SMS']);
  });

  it('a confirmation message counts toward the person\'s day; at the cap it is refused with CAP', async () => {
    const api = await mount({ requireConsent: ['WHATSAPP'], consent: clinicConsent() });
    for (let i = 0; i < 3; i += 1) await emit(api, 'u1');
    expect(await consentOf(api).request('u1', 'WHATSAPP')).toMatchObject({ status: 'CAP' });
    expect(sends.filter((send) => send.channel === 'WHATSAPP')).toEqual([]);
  });
});

describe('per tenant per month', () => {
  it('counts every person of the tenant; past the cap the paid channel is skipped', async () => {
    const api = await mount({ caps: caps({ perRecipientDaily: () => 100, perTenantMonthly: () => 3 }) });
    await emit(api, 'u1', 't1');
    await emit(api, 'u2', 't1');
    await emit(api, 'u3', 't1');
    const fourth = await emit(api, 'u1', 't1');
    expect(fourth.channels).toEqual(['EMAIL']);
    // Another tenant has its own month.
    expect(paid((await emit(api, 'u1', 't2')).channels)).toEqual(['SMS']);
  });

  it('a platform emit (no tenant) counts toward the person only', async () => {
    const api = await mount({ caps: caps({ perRecipientDaily: () => 100, perTenantMonthly: () => 1 }) });
    await emit(api, 'u1');
    await emit(api, 'u1');
    expect(paid((await emit(api, 'u1', 't1')).channels)).toEqual(['SMS']);
  });

  it('the resolver is asked per tenant', async () => {
    const asked: string[] = [];
    const api = await mount({
      caps: caps({
        perRecipientDaily: () => 100,
        perTenantMonthly: (tenantId) => {
          asked.push(tenantId);
          return tenantId === 'big' ? 100 : 1;
        },
      }),
    });
    await emit(api, 'u1', 'small');
    expect(paid((await emit(api, 'u2', 'small')).channels)).toEqual([]);
    await emit(api, 'u1', 'big');
    expect(paid((await emit(api, 'u2', 'big')).channels)).toEqual(['SMS']);
    expect(asked).toContain('small');
    expect(asked).toContain('big');
  });

  it('rolls over on the 1st in the TENANT\'s zone', async () => {
    const api = await mount({
      caps: caps({ perRecipientDaily: () => 100, perTenantMonthly: () => 1, timeZone: 'UTC', timeZoneOf: () => 'America/Sao_Paulo' }),
    });
    // 23:59 on Nov 30 in São Paulo = Dec 1 02:59 UTC: still November for the tenant.
    vi.setSystemTime(new Date('2026-12-01T02:59:00.000Z'));
    await emit(api, 'u1', 't1');
    expect(paid((await emit(api, 'u2', 't1')).channels)).toEqual([]);
    vi.setSystemTime(new Date('2026-12-01T03:01:00.000Z'));
    expect(paid((await emit(api, 'u2', 't1')).channels)).toEqual(['SMS']);
  });

  it('N parallel creations at cap-1: exactly one passes', async () => {
    const api = await mount({ caps: caps({ perRecipientDaily: () => 100, perTenantMonthly: () => 3 }) });
    await emit(api, 'u1', 't1');
    await emit(api, 'u2', 't1');
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => emit(api, ['u1', 'u2', 'u3'][i % 3] ?? 'u1', 't1')),
    );
    expect(results.filter((result) => paid(result.channels).length > 0)).toHaveLength(1);
    expect(sends).toHaveLength(3);
  });
});

describe('a refusal by one scope does not consume the other', () => {
  it('a message the tenant refused leaves the person\'s day untouched', async () => {
    const api = await mount({ caps: caps({ perRecipientDaily: () => 2, perTenantMonthly: () => 1 }) });
    expect(paid((await emit(api, 'u1', 't1')).channels)).toEqual(['SMS']); // person 1, t1 1
    expect(paid((await emit(api, 'u1', 't1')).channels)).toEqual([]); // t1 refuses
    // If the refused one had counted, the person would be at 2 and this would be refused.
    expect(paid((await emit(api, 'u1', 't2')).channels)).toEqual(['SMS']);
  });

  it('a message the person cap refused leaves the tenant\'s month untouched', async () => {
    const api = await mount({ caps: caps({ perRecipientDaily: () => 1, perTenantMonthly: () => 2 }) });
    await emit(api, 'u1', 't1'); // person u1 1, t1 1
    expect(paid((await emit(api, 'u1', 't1')).channels)).toEqual([]); // u1 refuses
    expect(paid((await emit(api, 'u2', 't1')).channels)).toEqual(['SMS']); // t1 still had room
  });
});

describe('the tenant hook — once per (tenant, period)', () => {
  it('fires when the cap first refuses a message, with the month, and not again that month', async () => {
    const api = await mount({ caps: caps({ perRecipientDaily: () => 100, perTenantMonthly: () => 2 }) });
    await emit(api, 'u1', 't1');
    await emit(api, 'u2', 't1');
    expect(reached).toEqual([]); // at the cap, nothing refused yet
    await emit(api, 'u3', 't1');
    await emit(api, 'u1', 't1');
    expect(reached).toEqual([{ tenantId: 't1', period: '2026-11' }]);
  });

  it('fires exactly once under concurrency', async () => {
    const api = await mount({ caps: caps({ perRecipientDaily: () => 100, perTenantMonthly: () => 1 }) });
    await Promise.all(Array.from({ length: 10 }, (_, i) => emit(api, ['u1', 'u2', 'u3'][i % 3] ?? 'u1', 't1')));
    expect(reached).toEqual([{ tenantId: 't1', period: '2026-11' }]);
  });

  it('fires again in the next period, and per tenant', async () => {
    const api = await mount({ caps: caps({ perRecipientDaily: () => 100, perTenantMonthly: () => 1 }) });
    await emit(api, 'u1', 't1');
    await emit(api, 'u2', 't1');
    await emit(api, 'u1', 't2');
    await emit(api, 'u2', 't2');
    vi.setSystemTime(new Date('2026-12-10T15:00:00.000Z'));
    await emit(api, 'u1', 't1');
    await emit(api, 'u2', 't1');
    expect(reached).toEqual([
      { tenantId: 't1', period: '2026-11' },
      { tenantId: 't2', period: '2026-11' },
      { tenantId: 't1', period: '2026-12' },
    ]);
  });

  it('a throwing hook never fails the emit', async () => {
    const api = await mount({
      caps: caps({
        perRecipientDaily: () => 100,
        perTenantMonthly: () => 1,
        onTenantCapReached: () => {
          throw new Error('hook down');
        },
      }),
    });
    await emit(api, 'u1', 't1');
    await expect(emit(api, 'u2', 't1')).resolves.toMatchObject({ channels: ['EMAIL'] });
  });
});

describe('a resolver that fails', () => {
  it('degrades to the free channels — a paid message is never sent uncounted', async () => {
    const api = await mount({
      caps: caps({
        perRecipientDaily: () => {
          throw new Error('settings unreachable');
        },
      }),
    });
    const result = await emit(api, 'u1');
    expect(result.channels).toEqual(['EMAIL']);
    expect(sends).toEqual([]);
  });
});
