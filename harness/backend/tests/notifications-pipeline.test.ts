/* eslint-disable test-flakiness/no-database-operations -- the database is the
   subject: this is future-pay's `tests/integration/notifications.test.ts`, ported
   to run against the PUBLISHED tarball over a real Postgres (PGlite), driving the
   same mount the browser drives. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarnessBackend, type HarnessBackend } from '../src/app';
import {
  NOTIFICATIONS_TENANT_FREE_ID,
  NOTIFICATIONS_TENANT_ID,
} from '../src/notifications-host';

/**
 * The notification PIPELINE end-to-end (12-15): the port of future-pay's
 * integration suite — `notify()` routing (the inbox record always, plus
 * per-channel fan-out), preference gating, the delivery lifecycle, failure
 * isolation and the retry sweep — now exercised through the published package's
 * own router over its own migrations, with the host reduced to the seams
 * ADOPTING.md names.
 *
 * The unit suite pins the same fold against an in-memory seam. What only exists
 * HERE is the SQL: the keyset cursor, the `deleted_at IS NULL` filter on every
 * read, the JSONB round trip and the unique (notification, channel) key doing the
 * idempotence. An in-memory double can agree with a wrong translation.
 */

let backend: HarnessBackend;

beforeAll(async () => {
  backend = await createHarnessBackend();
}, 120_000);

afterAll(async () => {
  await backend.close();
});

beforeEach(async () => {
  const reset = await backend.app.request('/__harness/reset', { method: 'POST' });
  expect(reset.status).toBe(204);
});

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

const headers = (userId: string): Record<string, string> => ({
  'x-notifications-user': userId,
  'content-type': 'application/json',
});

/** Emit through the harness's own endpoint, which calls the REAL front door. */
async function emit(body: {
  type?: string;
  userId?: string;
  clientId?: string | null;
  payload?: Record<string, unknown>;
}): Promise<{ notificationId: string; channels: string[] }> {
  const response = await backend.app.request('/__harness/notifications/emit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  return (await json<{ data: { notificationId: string; channels: string[] } }>(response)).data;
}

interface OutboxEntry {
  channel: string;
  destination: string;
  payload: string;
}

/** The retry sweep, through the harness endpoint a host would put on a cron. */
async function drain(olderThanMs: number, take?: number): Promise<{ dispatched: number }> {
  const response = await backend.app.request(
    `/__harness/notifications/drain?olderThanMs=${olderThanMs}` +
      (take === undefined ? '' : `&take=${take}`),
    { method: 'POST' },
  );
  expect(response.status).toBe(200);
  return (await json<{ data: { dispatched: number } }>(response)).data;
}

/** One dispatcher, addressable — so the suite can start two of them at once. */
function dispatch(notificationId: string): Promise<Response> {
  return backend.app.request(`/__harness/notifications/dispatch?id=${notificationId}`, {
    method: 'POST',
  });
}

/** Hold every send open, so two dispatchers are inside the window together. */
async function holdSends(held: boolean): Promise<void> {
  const response = await backend.app.request(
    `/__harness/notifications/${held ? 'hold' : 'release'}`,
    { method: 'POST' },
  );
  expect(response.status).toBe(200);
}

/** The delivery rows of one notification, as the database has them. */
async function deliveries(
  notificationId: string,
): Promise<{ status: string; attempts: number; sent_at: Date | null; error: string | null }[]> {
  const { rows } = await backend.pg.query<{
    status: string;
    attempts: number;
    sent_at: Date | null;
    error: string | null;
  }>(
    `SELECT status, attempts, sent_at, error FROM notification_deliveries
     WHERE notification_id = $1 ORDER BY channel`,
    [notificationId],
  );
  return rows;
}

async function outbox(): Promise<OutboxEntry[]> {
  const response = await backend.app.request('/__harness/notifications/outbox');
  return (await json<{ data: { entries: OutboxEntry[] } }>(response)).data.entries;
}

interface InboxPage {
  items: { id: string; title: string; body: string; readAt: string | null; link: string | null }[];
  nextCursor: string | null;
}

async function inbox(
  userId = 'owner-1',
  query = '',
): Promise<InboxPage> {
  const response = await backend.app.request(`/api/account/notifications${query}`, {
    headers: headers(userId),
  });
  expect(response.status).toBe(200);
  return (await json<{ data: InboxPage }>(response)).data;
}

async function unread(userId = 'owner-1'): Promise<number> {
  const response = await backend.app.request('/api/account/notifications/unread-count', {
    headers: headers(userId),
  });
  return (await json<{ data: { count: number } }>(response)).data.count;
}

function send(
  userId: string,
  path: string,
  body: unknown,
  method = 'POST',
): Promise<Response> {
  return backend.app.request(`/api/account${path}`, {
    method,
    headers: headers(userId),
    body: JSON.stringify(body),
  });
}

describe('notify — routing and fan-out over a real Postgres', () => {
  it('writes the inbox record and fans out to the default-enabled channels', async () => {
    const result = await emit({ payload: { code: 'B-1' } });

    // Defaults: email + web push on, the paid channels off. `owner-1` has an
    // address but no registered browser, so only EMAIL survives the gates.
    expect(result.channels).toEqual(['EMAIL']);

    const page = await inbox();
    expect(page.items[0]).toMatchObject({
      title: 'Pagamento confirmado',
      body: 'Pedido B-1 pago.',
      link: '/orders/B-1',
      readAt: null,
    });

    const sent = await outbox();
    expect(sent).toHaveLength(1);
    // The PACKAGE's email formatter produced this, absolute CTA included.
    expect(sent[0]?.channel).toBe('EMAIL');
    expect(sent[0]?.payload).toContain('Pagamento confirmado');
    expect(sent[0]?.payload).toContain('https://harness.test/orders/B-1');
  });

  it('writes the inbox record even when NO channel can carry it', async () => {
    // `chef-1` has no address and no browser: every transport declines, and the
    // notification still exists, which is the always-on inbox's whole point.
    const result = await emit({ userId: 'chef-1', payload: { code: 'B-2' } });
    expect(result.channels).toEqual([]);
    expect(await outbox()).toEqual([]);
    expect((await inbox('chef-1')).items).toHaveLength(1);
  });

  it('honours a saved preference immediately — no cache to invalidate', async () => {
    const saved = await send('owner-1', '/notification-preferences', {
      orders: { EMAIL: false, SMS: true },
    }, 'PUT');
    expect(saved.status).toBe(200);

    const result = await emit({ payload: { code: 'B-3' } });
    expect(result.channels).toEqual(['SMS']);
    const sent = await outbox();
    expect(sent[0]?.channel).toBe('SMS');
    // The SMS formatter's one-line body, and the phone normalized to E.164.
    expect(sent[0]?.payload).toContain('Pagamento confirmado: Pedido B-3 pago.');
    expect(sent[0]?.destination).toBe('+5531999998888');
  });

  it('normalizes a bare local phone before the vendor ever sees it', async () => {
    await send('chef-1', '/notification-preferences', { orders: { WHATSAPP: true } }, 'PUT');
    await emit({ userId: 'chef-1', payload: { code: 'B-4' } });
    const sent = await outbox();
    expect(sent[0]?.channel).toBe('WHATSAPP');
    expect(sent[0]?.destination).toBe('+5531988887777');
  });

  it('records a delivery per channel and flips it to SENT', async () => {
    const { notificationId } = await emit({ payload: { code: 'B-5' } });
    const { rows } = await backend.pg.query<{ channel: string; status: string; sent_at: Date | null }>(
      `SELECT channel, status, sent_at FROM notification_deliveries WHERE notification_id = $1`,
      [notificationId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ channel: 'EMAIL', status: 'SENT' });
    expect(rows[0]?.sent_at).toBeTruthy();
  });

  it('re-dispatch is idempotent: the unique key means no second delivery row', async () => {
    const { notificationId } = await emit({ payload: { code: 'B-6' } });
    // A QUEUED row would be re-sent; an already-SENT one is skipped, and the
    // fan-out cannot duplicate the row either way.
    await emit({ payload: { code: 'B-6' } });
    const { rows } = await backend.pg.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM notification_deliveries WHERE notification_id = $1`,
      [notificationId],
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('degrades to zero channels for a tenant whose plan covers only the inbox', async () => {
    const result = await emit({
      clientId: NOTIFICATIONS_TENANT_FREE_ID,
      payload: { code: 'B-7' },
    });
    expect(result.channels).toEqual([]);
    // The notification is NOT dropped — a revoked transport costs a channel.
    expect((await inbox()).items[0]?.body).toBe('Pedido B-7 pago.');
    expect(await outbox()).toEqual([]);
  });

  it('never policy-filters a PLATFORM emit (no tenant on the recipient)', async () => {
    const result = await emit({ clientId: null, payload: { code: 'B-8' } });
    expect(result.channels).toEqual(['EMAIL']);
    const { rows } = await backend.pg.query<{ client_id: string | null }>(
      `SELECT client_id FROM notifications WHERE id = $1`,
      [result.notificationId],
    );
    expect(rows[0]?.client_id).toBeNull();
  });

  it('stamps the tenant on a tenant-scoped emit', async () => {
    const { notificationId } = await emit({ payload: { code: 'B-9' } });
    const { rows } = await backend.pg.query<{ client_id: string | null; category: string }>(
      `SELECT client_id, category FROM notifications WHERE id = $1`,
      [notificationId],
    );
    expect(rows[0]).toMatchObject({ client_id: NOTIFICATIONS_TENANT_ID, category: 'orders' });
  });

  it('round-trips the JSONB payload the generator produced', async () => {
    const { notificationId } = await emit({ payload: { code: 'B-10' } });
    const { rows } = await backend.pg.query<{ data: unknown }>(
      `SELECT data FROM notifications WHERE id = $1`,
      [notificationId],
    );
    expect(rows[0]?.data).toEqual({ code: 'B-10' });
  });
});

describe('the retry sweep over real rows', () => {
  it('re-dispatches a FAILED delivery once its row is old enough', async () => {
    const { notificationId } = await emit({ payload: { code: 'C-1' } });
    // Force the failure state a dead provider would have left behind, then age
    // the row past the cutoff — the two conditions the sweep selects on.
    await backend.pg.query(
      `UPDATE notification_deliveries
       SET status = 'FAILED', error = 'provider down', sent_at = NULL,
           updated_at = NOW() - INTERVAL '10 minutes'
       WHERE notification_id = $1`,
      [notificationId],
    );

    const drained = await drain(5 * 60_000);
    expect(drained.dispatched).toBe(1);

    const { rows } = await backend.pg.query<{ status: string; error: string | null }>(
      `SELECT status, error FROM notification_deliveries WHERE notification_id = $1`,
      [notificationId],
    );
    expect(rows[0]).toMatchObject({ status: 'SENT', error: null });
  });

  it('leaves a FRESH failure alone — the cutoff is what makes the sweep safe', async () => {
    const { notificationId } = await emit({ payload: { code: 'C-2' } });
    await backend.pg.query(
      `UPDATE notification_deliveries SET status = 'FAILED', updated_at = NOW()
       WHERE notification_id = $1`,
      [notificationId],
    );
    expect((await drain(5 * 60_000)).dispatched).toBe(0);
  });

  it('picks up a QUEUED stray, which is a process that died mid-dispatch', async () => {
    const { notificationId } = await emit({ payload: { code: 'C-3' } });
    await backend.pg.query(
      `UPDATE notification_deliveries
       SET status = 'QUEUED', sent_at = NULL, updated_at = NOW() - INTERVAL '10 minutes'
       WHERE notification_id = $1`,
      [notificationId],
    );
    expect((await drain(5 * 60_000)).dispatched).toBe(1);
    const { rows } = await backend.pg.query<{ status: string }>(
      `SELECT status FROM notification_deliveries WHERE notification_id = $1`,
      [notificationId],
    );
    expect(rows[0]?.status).toBe('SENT');
  });

  it('reclaims a SENDING stray — a dispatcher that died between claim and send', async () => {
    const { notificationId } = await emit({ payload: { code: 'C-4' } });
    await backend.pg.query(
      `UPDATE notification_deliveries
       SET status = 'SENDING', sent_at = NULL, attempts = 1,
           updated_at = NOW() - INTERVAL '10 minutes'
       WHERE notification_id = $1`,
      [notificationId],
    );
    expect((await drain(5 * 60_000)).dispatched).toBe(1);
    expect((await deliveries(notificationId))[0]).toMatchObject({ status: 'SENT', attempts: 2 });
  });

  it('leaves a FRESH SENDING row alone — that dispatcher is still working', async () => {
    // The cutoff is the entire difference between "recover a dead dispatcher" and
    // "send the message a live one is sending right now".
    const { notificationId } = await emit({ payload: { code: 'C-5' } });
    await backend.pg.query(
      `UPDATE notification_deliveries SET status = 'SENDING', sent_at = NULL, updated_at = NOW()
       WHERE notification_id = $1`,
      [notificationId],
    );
    expect((await drain(5 * 60_000)).dispatched).toBe(0);
    expect((await deliveries(notificationId))[0]?.status).toBe('SENDING');
  });

  it('never selects a row it has already given up on (DEAD is terminal)', async () => {
    const { notificationId } = await emit({ payload: { code: 'C-6' } });
    await backend.pg.query(
      `UPDATE notification_deliveries
       SET status = 'DEAD', attempts = 5, updated_at = NOW() - INTERVAL '30 days'
       WHERE notification_id = $1`,
      [notificationId],
    );
    expect((await drain(5 * 60_000)).dispatched).toBe(0);
    expect((await deliveries(notificationId))[0]?.attempts).toBe(5);
  });

  it('judges staleness by updated_at, so a just-requeued row is not instantly stray', async () => {
    // The predicate defect, over real SQL: an ancient `created_at` with a fresh
    // `updated_at` is exactly the row a sweep leaves behind when it re-queues a
    // long-failing delivery. On `created_at` it is eligible again on the next
    // tick, so a 2 000-row outage backlog loops and re-sends all of it.
    const { notificationId } = await emit({ payload: { code: 'C-7' } });
    await backend.pg.query(
      `UPDATE notification_deliveries
       SET status = 'QUEUED', sent_at = NULL,
           created_at = NOW() - INTERVAL '3 days', updated_at = NOW()
       WHERE notification_id = $1`,
      [notificationId],
    );
    const before = (await outbox()).length;
    expect((await drain(5 * 60_000)).dispatched).toBe(0);
    expect((await outbox()).length).toBe(before);
  });
});

describe('two dispatchers, one delivery, over a real Postgres', () => {
  /**
   * The contract the in-memory seam cannot establish on its own.
   *
   * A single-threaded fake will happily agree with a read-validate-write
   * implementation, which is precisely how the equivalent double-send survived a
   * full suite elsewhere in this estate. Here the predicate is evaluated by
   * Postgres, in one statement, against the row version the other dispatcher
   * committed — so what passes is the claim and not the test's idea of it.
   *
   * Every case holds the sends open first: without that the first dispatcher
   * finishes before the second reads, and there is no race left to lose.
   */
  it('sends ONCE when two dispatchers race the same QUEUED delivery', async () => {
    const { notificationId } = await emit({ payload: { code: 'F-1' } });
    // Back to QUEUED, as a queue hand-off or a dead process would leave it.
    await backend.pg.query(
      `UPDATE notification_deliveries SET status = 'QUEUED', sent_at = NULL, attempts = 0
       WHERE notification_id = $1`,
      [notificationId],
    );
    const before = (await outbox()).length;

    await holdSends(true);
    const both = Promise.all([dispatch(notificationId), dispatch(notificationId)]);
    // Both dispatchers are past their reads by now; one is inside `send` and the
    // other has either claimed the row or been refused it.
    await holdSends(false);
    for (const response of await both) expect(response.status).toBe(200);

    // One provider call, one SENT row, one attempt spent.
    expect((await outbox()).length).toBe(before + 1);
    expect(await deliveries(notificationId)).toHaveLength(1);
    expect((await deliveries(notificationId))[0]).toMatchObject({ status: 'SENT', attempts: 1 });
  });

  it('never drags a committed SENT row back to QUEUED, even under two sweeps', async () => {
    const { notificationId } = await emit({ payload: { code: 'F-2' } });
    // A stale FAILED row: what a provider outage leaves for the sweep to find.
    await backend.pg.query(
      `UPDATE notification_deliveries
       SET status = 'FAILED', error = 'provider down', sent_at = NULL,
           updated_at = NOW() - INTERVAL '10 minutes'
       WHERE notification_id = $1`,
      [notificationId],
    );
    const before = (await outbox()).length;

    await holdSends(true);
    const both = Promise.all([
      backend.app.request('/__harness/notifications/drain?olderThanMs=300000', { method: 'POST' }),
      backend.app.request('/__harness/notifications/drain?olderThanMs=300000', { method: 'POST' }),
    ]);
    await holdSends(false);
    const counts = await Promise.all(
      (await both).map(async (response) =>
        (await json<{ data: { dispatched: number } }>(response)).data.dispatched,
      ),
    );

    // Exactly one sweep did the work — the requeue's `status` predicate is what
    // stops the second one forcing a SENT row back to QUEUED while `sent_at`
    // stays populated, and then sending a second billed message.
    expect(counts.reduce((total, count) => total + count, 0)).toBe(1);
    expect((await outbox()).length).toBe(before + 1);
    const [row] = await deliveries(notificationId);
    expect(row).toMatchObject({ status: 'SENT', error: null });
    expect(row?.sent_at).toBeTruthy();
  });

  it('bounds one sweep by `take`, leaving the remainder for the next tick', async () => {
    // Unbounded, a 2 000-row backlog is one run of sequential provider round
    // trips that outlives its own cron interval — so the next tick starts while
    // it is still working. The claim makes that harmless; the bound makes it rare.
    for (const code of ['F-3', 'F-4', 'F-5']) await emit({ payload: { code } });
    // Every delivery in the database, aged past the cutoff: the reset's own
    // seeded rows included, so the backlog is bigger than one tick's bound.
    await backend.pg.query(
      `UPDATE notification_deliveries
       SET status = 'FAILED', sent_at = NULL, updated_at = NOW() - INTERVAL '10 minutes'`,
    );
    const { rows: sizeRows } = await backend.pg.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM notification_deliveries`,
    );
    const backlog = Number(sizeRows[0]?.count);
    expect(backlog).toBeGreaterThan(2);
    const before = (await outbox()).length;

    const ticks: number[] = [];
    for (let tick = 0; tick < 10; tick += 1) {
      const { dispatched } = await drain(5 * 60_000, 2);
      ticks.push(dispatched);
      if (dispatched === 0) break;
    }

    // No tick exceeded the bound…
    expect(Math.max(...ticks)).toBe(2);
    // …the backlog drained exactly once over, and nothing was sent twice on the
    // way — which is the pair of properties the bound and the claim provide
    // together, and neither one alone.
    expect(ticks.reduce((total, count) => total + count, 0)).toBe(backlog);
    expect((await outbox()).length).toBe(before + backlog);
    const { rows } = await backend.pg.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM notification_deliveries WHERE status <> 'SENT'`,
    );
    expect(rows[0]?.count).toBe('0');
  });
});

describe('the inbox over real SQL', () => {
  it('pages with a keyset cursor that never skips or repeats a row', async () => {
    // The reset seeds three; add two more so two pages of two leave a remainder.
    await emit({ payload: { code: 'D-1' } });
    await emit({ payload: { code: 'D-2' } });

    const page1 = await inbox('owner-1', '?limit=2');
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBe(page1.items[1]?.id);

    const page2 = await inbox('owner-1', `?limit=2&cursor=${page1.nextCursor}`);
    const page3 = await inbox('owner-1', `?limit=2&cursor=${page2.nextCursor}`);

    const seen = [...page1.items, ...page2.items, ...page3.items].map((item) => item.id);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect(page3.nextCursor).toBeNull();
  });

  it('does not skip a row when the anchor was DELETED between the two pages', async () => {
    // The keyset, over the SQL that actually runs it. Under Prisma's positional
    // cursor `skip: 1` is an OFFSET applied AFTER the filter, so once the anchor
    // stops matching `deleted_at IS NULL` the offset eats the first SURVIVING row
    // — which then never appears in the list while still counting toward the
    // badge. The bottom visible row is the one carrying the delete button, so
    // this is the ordinary case rather than an edge one.
    await emit({ payload: { code: 'D-5' } });
    await emit({ payload: { code: 'D-6' } });

    const page1 = await inbox('owner-1', '?limit=2');
    const anchor = page1.nextCursor as string;
    const deleted = await send('owner-1', '/notifications/delete', { ids: [anchor] });
    expect((await json<{ data: { deleted: number } }>(deleted)).data.deleted).toBe(1);

    const page2 = await inbox('owner-1', `?limit=2&cursor=${anchor}`);
    const page3 = await inbox('owner-1', `?limit=2&cursor=${page2.nextCursor}`);
    const seen = [...page1.items, ...page2.items, ...page3.items].map((item) => item.id);

    // Five seeded rows, one deleted, and the four survivors are all reachable.
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.filter((id) => id !== anchor)).toHaveLength(4);
  });

  it('answers an empty page for a cursor that is not the caller’s', async () => {
    await emit({ userId: 'admin-1', payload: { code: 'D-7' } });
    const foreign = (await inbox('admin-1')).items[0]?.id as string;

    const mine = await inbox('owner-1', `?limit=2&cursor=${foreign}`);
    // Not page one: silently restarting would repeat rows already seen, and the
    // anchor's position would otherwise leak another user's `created_at` to the
    // resolution of the caller's own timestamps.
    expect(mine.items).toEqual([]);
    expect(mine.nextCursor).toBeNull();
  });

  it('is owner-scoped in every direction', async () => {
    await emit({ userId: 'admin-1', payload: { code: 'D-3' } });
    const mine = await inbox('owner-1');
    expect(mine.items.map((item) => item.body)).not.toContain('Pedido D-3 pago.');

    // And a foreign id cannot be marked read.
    const foreign = (await inbox('admin-1')).items[0]?.id as string;
    const response = await send('owner-1', '/notifications/mark-read', { ids: [foreign] });
    expect((await json<{ data: { updated: number } }>(response)).data.updated).toBe(0);
    expect(await unread('admin-1')).toBe(1);
  });

  it('drops a soft-deleted row from every read, keeping its delivery trail', async () => {
    const { notificationId } = await emit({ payload: { code: 'D-4' } });
    const before = await unread();

    const deleted = await send('owner-1', '/notifications/delete', { ids: [notificationId] });
    expect((await json<{ data: { deleted: number } }>(deleted)).data.deleted).toBe(1);

    expect((await inbox()).items.map((item) => item.id)).not.toContain(notificationId);
    expect(await unread()).toBe(before - 1);
    // Mark-read can never resurrect it…
    const resurrect = await send('owner-1', '/notifications/mark-read', { ids: [notificationId] });
    expect((await json<{ data: { updated: number } }>(resurrect)).data.updated).toBe(0);
    // …and the delivery audit trail under it survives.
    const { rows } = await backend.pg.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM notification_deliveries WHERE notification_id = $1`,
      [notificationId],
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('filters unread, and mark-all reports what actually moved', async () => {
    expect(await unread()).toBe(3);
    expect((await inbox('owner-1', '?filter=unread')).items).toHaveLength(3);

    const all = await send('owner-1', '/notifications/mark-read', { all: true });
    expect((await json<{ data: { updated: number } }>(all)).data.updated).toBe(3);
    expect(await unread()).toBe(0);

    const again = await send('owner-1', '/notifications/mark-read', { all: true });
    expect((await json<{ data: { updated: number } }>(again)).data.updated).toBe(0);
  });
});

describe('preferences and push subscriptions over real rows', () => {
  it('stores only EXPLICIT choices, and merges a single toggle over them', async () => {
    await send('owner-1', '/notification-preferences', { orders: { EMAIL: false } }, 'PUT');
    await send('owner-1', '/notification-preferences', { orders: { SMS: true } }, 'PUT');

    const { rows } = await backend.pg.query<{ category: string; channels: unknown }>(
      `SELECT category, channels FROM notification_preferences WHERE user_id = 'owner-1'`,
    );
    // ONE row, for the one category that was touched.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.channels).toEqual({
      EMAIL: false,
      SMS: true,
      WHATSAPP: false,
      WEB_PUSH: true,
    });
  });

  it('reports availability from the DESTINATION, not from the stored choice', async () => {
    const response = await backend.app.request('/api/account/notification-preferences', {
      headers: headers('admin-1'),
    });
    const payload = (
      await json<{ data: { availability: Record<string, boolean> } }>(response)
    ).data;
    // `admin-1` has an address and no phone.
    expect(payload.availability.EMAIL).toBe(true);
    expect(payload.availability.SMS).toBe(false);
    expect(payload.availability.WHATSAPP).toBe(false);
    // WEB_PUSH is probed with a hypothetical subscription, so the toggle that
    // creates one is reachable.
    expect(payload.availability.WEB_PUSH).toBe(true);
  });

  it('registers a browser and then actually pushes to it', async () => {
    const registered = await send('owner-1', '/push-subscriptions', {
      endpoint: 'https://push.harness.test/owner-1',
      keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    });
    expect((await json<{ data: { count: number } }>(registered)).data.count).toBe(1);

    await emit({ payload: { code: 'E-1' } });
    const sent = await outbox();
    // WEB_PUSH is on by default AND now has a destination.
    expect(sent.map((entry) => entry.channel).sort()).toEqual(['EMAIL', 'WEB_PUSH']);
    const push = sent.find((entry) => entry.channel === 'WEB_PUSH');
    expect(push?.destination).toBe('https://push.harness.test/owner-1');
    expect(push?.payload).toContain('Pedido E-1 pago.');
  });

  it('upserts on the endpoint, so re-subscribing a browser never duplicates', async () => {
    const body = {
      endpoint: 'https://push.harness.test/same',
      keys: { p256dh: 'p', auth: 'a' },
    };
    await send('owner-1', '/push-subscriptions', body);
    const again = await send('owner-1', '/push-subscriptions', body);
    expect((await json<{ data: { count: number } }>(again)).data.count).toBe(1);

    const removed = await send('owner-1', '/push-subscriptions', { endpoint: body.endpoint }, 'DELETE');
    expect((await json<{ data: { count: number } }>(removed)).data.count).toBe(0);
  });

  it('tells a browser whether the server still has ITS subscription', async () => {
    // What the settings screen reads instead of trusting the browser alone. Two
    // users on one machine: `PushManager` hands out the same endpoint for the same
    // browser profile, so the second *Ativar* re-owns the row and the first user's
    // is gone — while their browser keeps the subscription object and a
    // browser-only check keeps saying "recebendo alertas", with no button to fix
    // it. The 404/410 prune reaches the same state from the other side.
    const endpoint = 'https://push.harness.test/shared-counter';
    const body = { endpoint, keys: { p256dh: 'p', auth: 'a' } };
    await send('owner-1', '/push-subscriptions', body);

    const asked = `/api/account/push-subscriptions?endpoint=${encodeURIComponent(endpoint)}`;
    const mine = await backend.app.request(asked, { headers: headers('owner-1') });
    expect((await json<{ data: { registered?: boolean } }>(mine)).data.registered).toBe(true);

    // The second user on the same browser takes it over.
    await send('admin-1', '/push-subscriptions', body);
    const stolen = await backend.app.request(asked, { headers: headers('owner-1') });
    expect((await json<{ data: { registered?: boolean } }>(stolen)).data.registered).toBe(false);
    // And the new owner is told the truth too — same answer, opposite direction.
    const theirs = await backend.app.request(asked, { headers: headers('admin-1') });
    expect((await json<{ data: { registered?: boolean } }>(theirs)).data.registered).toBe(true);

    // An endpoint nobody registered answers exactly like a foreign one, so a
    // caller holding somebody else's endpoint learns nothing about who owns it.
    const unknown = await backend.app.request(
      `/api/account/push-subscriptions?endpoint=${encodeURIComponent('https://push.harness.test/nope')}`,
      { headers: headers('owner-1') },
    );
    expect((await json<{ data: { registered?: boolean } }>(unknown)).data.registered).toBe(false);
  });

  it('serves the deployment VAPID public key the browser needs', async () => {
    const response = await backend.app.request('/api/account/push-subscriptions', {
      headers: headers('owner-1'),
    });
    const payload = (
      await json<{ data: { vapidPublicKey: string | null } }>(response)
    ).data;
    expect(payload.vapidPublicKey).toBe('BHarnessVapidPublicKey');
  });
});

describe('the permission fan-out against a real grant table', () => {
  async function fanOut(): Promise<{
    notified: string[];
    skipped: { userId: string; reason: string }[];
  }> {
    const response = await backend.app.request('/__harness/notifications/fan-out', {
      method: 'POST',
    });
    expect(response.status).toBe(200);
    return (
      await json<{ data: { notified: string[]; skipped: { userId: string; reason: string }[] } }>(
        response,
      )
    ).data;
  }

  it('reaches only the holders of BOTH permissions', async () => {
    const result = await fanOut();
    expect(result.notified).toEqual(['owner-1']);
    // `admin-1` holds one of the two; under OR they would be notified into a 403.
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { userId: 'admin-1', reason: 'missing-permission' },
        { userId: 'chef-1', reason: 'missing-permission' },
      ]),
    );
  });

  it('does not let a grant held at ANOTHER tenant qualify a candidate here', async () => {
    // `chef-1` IS a candidate at `harness` (they hold `stock:read` there) and the
    // qualifying pair lives at `harness-free`. Union the scopes — the obvious way
    // to "simplify" the resolver — and this user is told about a store whose money
    // they have no authority over.
    await fanOut();
    const { rows } = await backend.pg.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM notifications
       WHERE user_id = 'chef-1' AND type = 'payment.short'`,
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('stamps the addressed notification with the tenant and its category', async () => {
    await fanOut();
    const { rows } = await backend.pg.query<{ client_id: string; category: string; title: string }>(
      `SELECT client_id, category, title FROM notifications
       WHERE user_id = 'owner-1' AND type = 'payment.short'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      client_id: NOTIFICATIONS_TENANT_ID,
      category: 'payments',
      title: 'Pagamento a menor',
    });
  });

  it('notifies a holder exactly once, however many grants they hold', async () => {
    await backend.pg.query(
      `INSERT INTO notification_audience (client_id, user_id, permission)
       VALUES ($1, 'owner-1', 'stock:read')`,
      [NOTIFICATIONS_TENANT_ID],
    );
    const result = await fanOut();
    expect(result.notified).toEqual(['owner-1']);
    const { rows } = await backend.pg.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM notifications
       WHERE user_id = 'owner-1' AND type = 'payment.short'`,
    );
    expect(rows[0]?.count).toBe('1');
  });
});
