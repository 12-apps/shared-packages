/* eslint-disable test-flakiness/no-test-isolation, test-flakiness/no-global-state-mutation --
   `memory` and `sends` are rebuilt per case in `beforeEach`; the rule flags
   the module-scoped bindings they are assigned to. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiNotifications } from '../create-api-notifications';
import type { NotificationsDb } from '../db';

import {
  clinicConsent,
  consentOf,
  countingDb,
  emailTransport,
  mountContract,
  mutableContacts,
  phoneTransport,
  receiptsOf,
  U1_E164,
  type ContractConfig,
  type PhoneSend,
} from './consent-contract';
import { createMemoryDb, type MemoryDb } from './memory-db';

/**
 * FUT-285 contract — the query budget per send, MEASURED by counting every
 * delegate call (transactions included). No ledger holds a number for these
 * paths, so the budget lives here:
 *
 *  - an emit whose paid channels were already dropped (preference off) pays
 *    NOTHING for consent or caps;
 *  - an emit that keeps one paid channel pays ≤ 1 consent read + ≤ 2 counter
 *    statements per scope (person, tenant) — at most 5 for a tenant emit;
 *  - a dispatch re-check is ≤ 1 consent read, and 0 for a free-only dispatch;
 *  - a receipt that changes nothing is exactly 1 statement (the guarded update);
 *  - an inbound SIM is ≤ 3;
 *  - the preferences GET pays ≤ 1 more than today.
 */

/** A fixed instant for receipts and replies whose time the case does not read. */
const AT = new Date('2026-11-16T15:00:00.000Z');

let memory: MemoryDb;
let sends: PhoneSend[];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-16T15:00:00.000Z'));
  memory = createMemoryDb();
  sends = [];
});

afterEach(() => {
  vi.useRealTimers();
});

const FULL: ContractConfig = {
  requireConsent: ['SMS', 'WHATSAPP'],
  consent: clinicConsent(),
  caps: { timeZone: 'America/Sao_Paulo', perRecipientDaily: () => 100, perTenantMonthly: () => 100 },
};

function mountOn(db: NotificationsDb, config: ContractConfig): ApiNotifications {
  const api = mountContract(db, { contacts: mutableContacts(), scheduleDispatch: () => Promise.resolve(), ...config });
  api.transports.register(emailTransport([]));
  api.transports.register(phoneTransport('SMS', sends));
  api.transports.register(phoneTransport('WHATSAPP', sends));
  return api;
}

/** The statements one emit costs on a fresh mount with `config`. */
async function emitCost(config: ContractConfig, prepare: (api: ApiNotifications) => Promise<void>): Promise<number> {
  memory = createMemoryDb();
  const counted = countingDb(memory);
  const api = mountOn(counted.db, config);
  await prepare(api);
  counted.reset();
  await api.notify({ type: 'order.paid', recipient: { userId: 'u1', clientId: 't1' }, payload: { code: 'B' } });
  return counted.calls();
}

describe('the query budget', () => {
  it('an emit with no paid channel left pays nothing for consent or caps', async () => {
    const free = (api: ApiNotifications) => api.preferences.save('u1', { orders: { SMS: false, WHATSAPP: false } });
    const baseline = await emitCost({}, free);
    expect(await emitCost(FULL, free)).toBe(baseline);
  });

  it('an emit that keeps one paid channel pays at most 5 more (1 consent read + 2 per scope)', async () => {
    const baseline = await emitCost({}, (api) => api.preferences.save('u1', { orders: { WHATSAPP: true } }));
    const withAll = await emitCost(FULL, async (api) => {
      await api.preferences.save('u1', { orders: { WHATSAPP: true } });
      await consentOf(api).request('u1', 'WHATSAPP');
      await consentOf(api).applyInbound({ channel: 'WHATSAPP', from: U1_E164, text: 'SIM', at: AT, externalId: 'w' });
    });
    expect(memory.rows.deliveries.some((row) => row.channel === 'WHATSAPP')).toBe(true);
    expect(withAll - baseline).toBeLessThanOrEqual(5);
  });

  it('the dispatch re-check costs at most one consent read, and nothing on a free-only dispatch', async () => {
    async function dispatchCost(config: ContractConfig, paid: boolean): Promise<number> {
      memory = createMemoryDb();
      const counted = countingDb(memory);
      const api = mountOn(counted.db, config);
      await api.preferences.save('u1', { orders: { WHATSAPP: paid } });
      if (paid && config.consent) {
        await consentOf(api).request('u1', 'WHATSAPP');
        await consentOf(api).applyInbound({ channel: 'WHATSAPP', from: U1_E164, text: 'SIM', at: AT, externalId: 'w' });
      }
      const { notificationId } = await api.notify({ type: 'order.paid', recipient: { userId: 'u1' }, payload: { code: 'D' } });
      counted.reset();
      await api.dispatchDeliveries(notificationId);
      return counted.calls();
    }
    expect(await dispatchCost(FULL, false)).toBe(await dispatchCost({}, false));
    const paidBaseline = await dispatchCost({}, true);
    expect((await dispatchCost(FULL, true)) - paidBaseline).toBeLessThanOrEqual(1);
  });

  it('a receipt that changes nothing is exactly one statement', async () => {
    const counted = countingDb(memory);
    const api = mountOn(counted.db, FULL);
    counted.reset();
    await receiptsOf(api)({ channel: 'SMS', providerMessageId: 'SM-unknown', status: 'DELIVERED', at: AT });
    expect(counted.calls()).toBe(1);
  });

  it('an inbound SIM costs at most 3 statements', async () => {
    const counted = countingDb(memory);
    const api = mountOn(counted.db, FULL);
    await consentOf(api).request('u1', 'WHATSAPP');
    counted.reset();
    await consentOf(api).applyInbound({ channel: 'WHATSAPP', from: U1_E164, text: 'SIM', at: AT, externalId: 'w' });
    expect(counted.calls()).toBeLessThanOrEqual(3);
  });

  it('the preferences GET costs at most one more statement', async () => {
    async function getCost(config: ContractConfig): Promise<number> {
      memory = createMemoryDb();
      const counted = countingDb(memory);
      const api = mountOn(counted.db, config);
      const get = api.routes.find((entry) => entry.method === 'GET' && entry.path === '/notification-preferences');
      if (!get) throw new Error('no preferences route');
      counted.reset();
      const response = await get.handle({ actor: { userId: 'u1' }, params: {}, query: {} });
      expect((response.body as { data: { consent?: unknown } }).data.consent === undefined).toBe(config.consent === undefined);
      return counted.calls();
    }
    const baseline = await getCost({});
    expect((await getCost(FULL)) - baseline).toBeLessThanOrEqual(1);
  });
});
