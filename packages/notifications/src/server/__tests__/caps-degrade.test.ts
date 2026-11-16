/* eslint-disable test-flakiness/no-global-state-mutation --
   `sends`, `emails` and `logged` RECORD what crossed the doubles; the db double's
   counter delegate is replaced per case to fail the way a real one can. */
import { describe, expect, it } from 'vitest';

import type { ApiNotifications } from '../create-api-notifications';

import { emailTransport, mountContract, phoneTransport, type PhoneSend } from './consent-contract';
import { createMemoryDb, type MemoryDb } from './memory-db';

/**
 * FUT-285 review N2 — the send counter cannot cost a person the record of the
 * event. A counter statement that throws, or a seam without the
 * `notificationSendCounter` delegate, degrades to the free channels exactly as a
 * throwing cap resolver does: the INBOX row is always written (invariant 5), and
 * the missing delegate is reported at mount.
 */

interface Harness {
  db: MemoryDb;
  api: ApiNotifications;
  sends: PhoneSend[];
  emails: string[];
  logged: string[];
}

async function mountWithCaps(prepare: (db: MemoryDb) => void): Promise<Harness> {
  const db = createMemoryDb();
  prepare(db);
  const sends: PhoneSend[] = [];
  const emails: string[] = [];
  const logged: string[] = [];
  const api = mountContract(db, {
    caps: { timeZone: 'America/Sao_Paulo' },
    logger: { info: () => undefined, error: (message: string) => void logged.push(message) },
  });
  api.transports.register(emailTransport(emails));
  api.transports.register(phoneTransport('SMS', sends));
  await api.preferences.save('u1', { orders: { SMS: true } });
  return { db, api, sends, emails, logged };
}

const emit = (api: ApiNotifications) =>
  api.notify({ type: 'order.paid', recipient: { userId: 'u1', clientId: 't1' }, payload: { code: 'N2' } }, { sync: true });

describe('a send counter that fails', () => {
  it('a counter statement that throws: the inbox row and e-mail are written, the paid channel is dropped', async () => {
    const h = await mountWithCaps((db) => {
      const failing = () => Promise.reject(new Error('connection reset'));
      Object.assign(db, { notificationSendCounter: { createMany: failing, updateMany: failing } });
    });
    const result = await emit(h.api);
    expect(result.channels).toEqual(['EMAIL']);
    expect(h.db.rows.notifications).toHaveLength(1);
    expect(h.emails).toEqual(['u1']);
    expect(h.sends).toEqual([]);
  });

  it('a seam without the delegate: reported at mount, and every emit still writes its inbox row', async () => {
    const h = await mountWithCaps((db) => {
      delete (db as { notificationSendCounter?: unknown }).notificationSendCounter;
    });
    expect(h.logged.some((line) => line.includes('notificationSendCounter'))).toBe(true);
    const result = await emit(h.api);
    expect(result.channels).toEqual(['EMAIL']);
    expect(h.db.rows.notifications).toHaveLength(1);
    expect(h.sends).toEqual([]);
  });
});
