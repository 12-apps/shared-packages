/* eslint-disable test-flakiness/no-global-state-mutation --
   `sends` RECORDS what the transport was handed, and the db double's `update` is
   replaced per case to fail the way a real one can; each case builds its own. */
import { describe, expect, it } from 'vitest';

import { deliveriesOf, mountContract, phoneTransport, type PhoneSend } from './consent-contract';
import { createMemoryDb, type MemoryDb } from './memory-db';

/**
 * FUT-285 review N8 — the provider id is written BEST-EFFORT. A write that
 * fails over it after a successful send (a unique clash, a host client that
 * predates the column) must not turn a message that WENT into a FAILED row the
 * sweep re-sends: that is a second billed message to a real phone.
 */

type UpdateArgs = { where: { id: string }; data: Record<string, unknown> };

/** Make every delivery update that carries `providerMessageId` throw. */
function refuseProviderIdWrites(db: MemoryDb): void {
  const delegate = db.notificationDelivery as unknown as { update: (args: UpdateArgs) => Promise<unknown> };
  const update = delegate.update.bind(delegate);
  delegate.update = (args) =>
    'providerMessageId' in args.data
      ? Promise.reject(new Error('Unique constraint failed on (channel, provider_message_id)'))
      : update(args);
}

describe('a failure writing the provider id after a successful send', () => {
  it('still writes SENT (without the id), and the sweep never sends it again', async () => {
    const db = createMemoryDb();
    refuseProviderIdWrites(db);
    const sends: PhoneSend[] = [];
    const api = mountContract(db, {});
    api.transports.register(phoneTransport('SMS', sends));
    await api.preferences.save('u1', { orders: { EMAIL: false, WEB_PUSH: false, SMS: true } });
    const { notificationId } = await api.notify(
      { type: 'order.paid', recipient: { userId: 'u1' }, payload: { code: 'N8' } },
      { sync: true },
    );
    const [row] = deliveriesOf(db, notificationId);
    expect(row?.status).toBe('SENT');
    expect(row?.providerMessageId ?? null).toBeNull();

    for (const entry of db.rows.deliveries) entry.updatedAt = new Date(entry.updatedAt.getTime() - 60 * 60_000);
    await api.drainPending(0);
    expect(sends).toHaveLength(1);
  });
});
