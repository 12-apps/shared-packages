import { describe, expect, it, vi } from 'vitest';

import { WebhookVerificationError } from '../core/errors';
import type {
  RetryableAttemptBucket,
  StoredWebhookDelivery,
  WebhookInbox,
} from '../core/ports';
import { backoffFor } from '../core/webhook-replay';
import { createMemoryWebhookInbox, type MemoryWebhookInbox } from '../memory-webhook-inbox';
import { createPrismaWebhookInbox, type WebhookEventDelegate } from '../prisma/webhook-inbox';
import {
  infinitePayDelivery,
  setupCustomInboxWorld,
  setupGatewayWorld,
  stoneDelivery,
  pixInput,
  OTHER_TENANT,
  STUB_CREDS,
  TENANT,
} from './fixtures';

/**
 * Replay of retryable webhook deliveries (FUT-341).
 *
 * Every instant is fixed and every row's clock is set explicitly, so nothing
 * here depends on how long the suite takes to run. The instants come from
 * `clock()` per test rather than module constants: a `Date` is mutable, and
 * sharing one across tests is exactly the order-dependence trap the flakiness
 * lint is there to catch.
 */
const MINUTE_MS = 60_000;

function clock(): { now: Date; stranded: Date; minutesAgo: (minutes: number) => Date } {
  const now = new Date('2026-07-27T12:00:00Z');
  return {
    now,
    /** Longer ago than any backoff step, the cap included. */
    stranded: new Date('2026-07-27T02:00:00Z'),
    minutesAgo: (minutes) => new Date(now.getTime() - minutes * MINUTE_MS),
  };
}

/**
 * The bucket list the sweep builds, rebuilt here so the store's contract can be
 * exercised on its own. `everything` is the degenerate "any age qualifies"
 * list — for the tests that are about statuses and caps rather than backoff.
 */
function buckets(
  now: Date,
  maxAttempts: number,
  cutoffFor: (attempts: number) => Date = (attempts) =>
    new Date(now.getTime() - backoffFor(attempts)),
): RetryableAttemptBucket[] {
  return Array.from({ length: maxAttempts }, (_unused, attempts) => ({
    attempts,
    updatedBefore: cutoffFor(attempts),
  }));
}

function everything(now: Date, maxAttempts = 10): RetryableAttemptBucket[] {
  return buckets(now, maxAttempts, () => now);
}

/**
 * Run `step` `times` times, one after another.
 *
 * Module scope on purpose: a counter declared inside an `it` is state shared
 * across that test's assertions, which is what the flakiness lint is there to
 * stop — and a repeat count is the one thing several of these tests need.
 */
async function repeat(times: number, step: () => Promise<void>): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await step();
  }
}

/** Record one delivery and put its row into a given state. */
async function seedRow(
  inbox: MemoryWebhookInbox,
  eventId: string,
  state: { failures?: number; liveFailures?: number; processed?: boolean; updatedAt: Date },
): Promise<string> {
  const { id } = await inbox.record(TENANT, stoneDelivery(eventId, 'PAID'), eventId);
  for (let i = 0; i < (state.failures ?? 0); i += 1) {
    await inbox.markFailed(id, 'boom', 'REPLAY');
  }
  for (let i = 0; i < (state.liveFailures ?? 0); i += 1) {
    await inbox.markFailed(id, 'boom', 'LIVE');
  }
  if (state.processed) await inbox.markProcessed(id);
  inbox.backdate(id, state.updatedAt);
  return id;
}

describe('backoffFor', () => {
  it('doubles the wait with each counted attempt, starting at one minute', () => {
    expect(backoffFor(0)).toBe(MINUTE_MS);
    expect(backoffFor(1)).toBe(2 * MINUTE_MS);
    expect(backoffFor(2)).toBe(4 * MINUTE_MS);
    expect(backoffFor(5)).toBe(32 * MINUTE_MS);
  });

  it('caps the wait so a long-failing row is still retried on a human timescale', () => {
    const cap = 6 * 60 * MINUTE_MS;
    expect(backoffFor(9)).toBe(cap);
    expect(backoffFor(40)).toBe(cap);
    // 2 ** attempts overflows to Infinity long before this; the cap absorbs it.
    expect(backoffFor(5_000)).toBe(cap);
  });

  it('reads a corrupt attempt count as the first attempt rather than throwing', () => {
    expect(backoffFor(-3)).toBe(MINUTE_MS);
    expect(backoffFor(1.9)).toBe(2 * MINUTE_MS);
    expect(backoffFor(Number.NaN)).toBe(MINUTE_MS);
  });
});

describe('WebhookInbox.listRetryable', () => {
  it('lists both unsettled states and never a PROCESSED row', async () => {
    const { now, stranded } = clock();
    const inbox = createMemoryWebhookInbox();
    await seedRow(inbox, 'evt-pending', { updatedAt: stranded });
    await seedRow(inbox, 'evt-failed', { failures: 1, updatedAt: stranded });
    await seedRow(inbox, 'evt-done', { processed: true, updatedAt: stranded });

    const { deliveries: rows } = await inbox.listRetryable({ buckets: everything(now), limit: 10 });
    expect(rows.map((row) => row.eventId).sort()).toEqual(['evt-failed', 'evt-pending']);
  });

  it('drops rows that have burned the attempt cap', async () => {
    const { now, stranded } = clock();
    const inbox = createMemoryWebhookInbox();
    await seedRow(inbox, 'evt-under-cap', { failures: 2, updatedAt: stranded });
    await seedRow(inbox, 'evt-retired', { failures: 3, updatedAt: stranded });

    const { deliveries: rows } = await inbox.listRetryable({ buckets: everything(now, 3), limit: 10 });
    expect(rows.map((row) => row.eventId)).toEqual(['evt-under-cap']);
  });

  it('returns nothing at all for an empty bucket list', async () => {
    // "No attempt count is eligible" must mean no rows — never "no filter,
    // therefore everything". The sweep sends this list when configured with a
    // zero cap, and reading it as an absent predicate would replay the entire
    // unsettled table at once.
    const { stranded } = clock();
    const inbox = createMemoryWebhookInbox();
    await seedRow(inbox, 'evt-1', { updatedAt: stranded });

    expect(await inbox.listRetryable({ buckets: [], limit: 10 })).toEqual({
      deliveries: [],
      undecodable: [],
    });
  });

  it('holds each row to ITS OWN cutoff, not to one shared cutoff', async () => {
    const { now, minutesAgo } = clock();
    const inbox = createMemoryWebhookInbox();
    // Two counted replay failures buy a four-minute wait; none buys one minute.
    await seedRow(inbox, 'evt-still-waiting', { failures: 2, updatedAt: minutesAgo(3) });
    await seedRow(inbox, 'evt-due', { updatedAt: minutesAgo(3) });

    const { deliveries: rows } = await inbox.listRetryable({ buckets: buckets(now, 10), limit: 10 });
    expect(rows.map((row) => row.eventId)).toEqual(['evt-due']);
  });

  it('spends the limit on rows that are DUE, never on rows still waiting', async () => {
    // The starvation this shape exists to prevent. A row deep in its backoff
    // has an OLD `updatedAt` by definition, so under a single coarse cutoff it
    // sorts to the head of an oldest-first, limit-bounded batch and consumes
    // the whole budget — while the row that is genuinely due (newer, therefore
    // last) is never returned, for as long as the waiting rows keep waiting.
    const { now, minutesAgo } = clock();
    const inbox = createMemoryWebhookInbox();
    // Five counted failures buy 32 minutes; these two moved 10 minutes ago.
    await seedRow(inbox, 'evt-backoff-a', { failures: 5, updatedAt: minutesAgo(10) });
    await seedRow(inbox, 'evt-backoff-b', { failures: 5, updatedAt: minutesAgo(10) });
    // Never attempted, quiet for five minutes: due four minutes ago.
    await seedRow(inbox, 'evt-due', { updatedAt: minutesAgo(5) });

    const { deliveries: rows } = await inbox.listRetryable({ buckets: buckets(now, 10), limit: 2 });
    expect(rows.map((row) => row.eventId)).toEqual(['evt-due']);
  });

  it('keeps the drain’s budget clear of the live path’s failures', async () => {
    // A provider redelivering a broken handler must not retire the row. Both
    // rows have been tried nine times; only the one whose attempts were REPLAYS
    // has spent the drain's budget.
    const { now, stranded } = clock();
    const inbox = createMemoryWebhookInbox();
    const hammered = await seedRow(inbox, 'evt-redelivered', {
      liveFailures: 9,
      updatedAt: stranded,
    });
    await seedRow(inbox, 'evt-replayed', { failures: 9, updatedAt: stranded });

    const { deliveries: rows } = await inbox.listRetryable({ buckets: everything(now, 9), limit: 10 });

    expect(rows.map((row) => row.eventId)).toEqual(['evt-redelivered']);
    // The live attempts are still counted — support asks "how many times has
    // anything tried this" — they simply are not the drain's budget.
    expect(inbox.attemptsById()[hammered]).toBe(9);
    expect(inbox.replayAttemptsById()[hammered]).toBe(0);
  });

  it('returns the longest-stranded rows first, bounded by the limit', async () => {
    const { now, minutesAgo } = clock();
    const inbox = createMemoryWebhookInbox();
    await seedRow(inbox, 'evt-middle', { updatedAt: minutesAgo(20) });
    await seedRow(inbox, 'evt-oldest', { updatedAt: minutesAgo(90) });
    await seedRow(inbox, 'evt-newest', { updatedAt: minutesAgo(6) });

    const { deliveries: rows } = await inbox.listRetryable({ buckets: everything(now), limit: 2 });
    expect(rows.map((row) => row.eventId)).toEqual(['evt-oldest', 'evt-middle']);
  });

  it('rehydrates the delivery record() was handed, merchant included', async () => {
    const { now, stranded } = clock();
    const inbox = createMemoryWebhookInbox();
    await seedRow(inbox, 'evt-1', { updatedAt: stranded });

    const { deliveries: [row] } = await inbox.listRetryable({ buckets: everything(now), limit: 10 });
    expect(row?.merchant).toEqual(TENANT);
    expect(row?.delivery).toEqual(stoneDelivery('evt-1', 'PAID'));
  });
});

describe('createPrismaWebhookInbox.listRetryable', () => {
  interface Row {
    id: string;
    merchantKind: string;
    merchantId: string;
    provider: string;
    eventId: string;
    headers: string;
    payload: string;
  }

  function row(id: string, headers: string): Row {
    return {
      id,
      merchantKind: 'TENANT',
      merchantId: 'tenant-1',
      provider: 'stone',
      eventId: `evt-${id}`,
      headers,
      payload: '{"eventId":"x"}',
    };
  }

  /** A delegate that records the args it was handed and returns `rows`. */
  function fakeDelegate(rows: Row[]): {
    delegate: WebhookEventDelegate;
    queries: unknown[];
    updates: unknown[];
  } {
    const queries: unknown[] = [];
    const updates: unknown[] = [];
    return {
      queries,
      updates,
      delegate: {
        async create() {
          throw new Error('not part of this test');
        },
        async findUnique() {
          return null;
        },
        async updateMany(args) {
          updates.push(args);
          return { count: 1 };
        },
        async update(args) {
          updates.push(args);
          return undefined;
        },
        async findMany(args) {
          queries.push(args);
          return rows;
        },
      },
    };
  }

  it('asks for the DUE rows outright — one branch per attempt count, oldest first', async () => {
    // The predicate is pushed into the query, so `take` bounds rows the sweep
    // can act on. A single coarse cutoff plus an in-memory re-filter would let
    // rows still inside a long backoff (old `updatedAt`, so first in this very
    // ordering) consume the whole batch and starve the due ones.
    const { now, minutesAgo } = clock();
    const { delegate, queries } = fakeDelegate([]);

    await createPrismaWebhookInbox(delegate).listRetryable({
      buckets: buckets(now, 3),
      limit: 25,
    });

    // Spelled out rather than derived from the input: the backoff curve each
    // bucket carries is the thing being asserted, and restating the helper
    // would assert nothing.
    expect(queries).toEqual([
      {
        where: {
          status: { in: ['PENDING', 'FAILED'] },
          OR: [
            { replayAttempts: 0, updatedAt: { lte: minutesAgo(1) } },
            { replayAttempts: 1, updatedAt: { lte: minutesAgo(2) } },
            { replayAttempts: 2, updatedAt: { lte: minutesAgo(4) } },
          ],
        },
        orderBy: { updatedAt: 'asc' },
        take: 25,
      },
    ]);
  });

  it('answers an empty bucket list without querying at all', async () => {
    // "No attempt count is eligible" is a decided answer, not an absent
    // predicate. Left to the client, an empty `OR` is its reading to make — and
    // a gate on money-adjacent rows is the wrong place to discover it changed.
    const { delegate, queries } = fakeDelegate([row('a', '{}')]);

    const rows = await createPrismaWebhookInbox(delegate).listRetryable({
      buckets: [],
      limit: 10,
    });

    expect(rows).toEqual({ deliveries: [], undecodable: [] });
    expect(queries).toEqual([]);
  });

  it('SKIPS a row whose stored headers are malformed instead of losing the batch', async () => {
    const { now } = clock();
    const { delegate } = fakeDelegate([
      row('a', '{"x-webhook-secret":"shh"}'),
      row('b', 'not json at all'),
      row('c', '[1,2,3]'),
      row('d', '{"x-count":7,"x-trace":"abc"}'),
    ]);

    const { deliveries: rows, undecodable } = await createPrismaWebhookInbox(
      delegate,
    ).listRetryable({
      buckets: everything(now),
      limit: 10,
    });

    // Every other paid order in the batch survives, which is the point of not
    // throwing. The unusable rows are REPORTED rather than dropped: they each
    // spent a slot, and only the sweep retiring them gives that slot back.
    expect(rows.map((entry) => entry.id)).toEqual(['a', 'd']);
    expect(undecodable).toEqual(['b', 'c']);
    expect(rows[0]?.delivery.headers).toEqual({ 'x-webhook-secret': 'shh' });
    // A non-string header value cannot have come from a WebhookDelivery: the
    // pair is dropped, the row is kept.
    expect(rows[1]?.delivery.headers).toEqual({ 'x-trace': 'abc' });
  });

  it('guards the retirement write in the query, not in a prior read', async () => {
    // A read-then-write would only narrow the race. The status test has to be
    // part of the same statement, which is what `updateMany` buys here.
    const { delegate, updates } = fakeDelegate([]);

    await createPrismaWebhookInbox(delegate).markFailed('whk_1', 'undecodable', 'REPLAY');

    expect(updates).toEqual([
      {
        where: { id: 'whk_1', status: { in: ['PENDING', 'FAILED'] } },
        data: {
          status: 'FAILED',
          lastError: 'undecodable',
          attempts: { increment: 1 },
          replayAttempts: { increment: 1 },
        },
      },
    ]);
  });

  it('maps a row into the delivery a replay feeds back into the pipeline', async () => {
    const { now } = clock();
    const { delegate } = fakeDelegate([row('a', '{}')]);
    const { deliveries: rows } = await createPrismaWebhookInbox(delegate).listRetryable({
      buckets: everything(now),
      limit: 10,
    });
    expect(rows[0]).toEqual({
      id: 'a',
      merchant: { kind: 'TENANT', id: 'tenant-1' },
      delivery: { provider: 'stone', rawBody: '{"eventId":"x"}', headers: {} },
      eventId: 'evt-a',
    });
  });

  it('charges a failure to the budget that made it, and only that one', async () => {
    // `attempts` is telemetry over both paths; `replay_attempts` is the drain's
    // budget. A live redelivery incrementing the budget is what would let a
    // provider hammering a broken handler retire the row before the drain ever
    // reached it.
    const { delegate, updates } = fakeDelegate([]);
    const inbox = createPrismaWebhookInbox(delegate);

    await inbox.markFailed('whk_1', 'host boom', 'REPLAY');
    await inbox.markFailed('whk_1', 'host boom', 'LIVE');
    await inbox.markProcessed('whk_1');

    expect(updates).toEqual([
      {
        // The status guard rides in the WHERE on every failure write, not just
        // the retirement one: PROCESSED is terminal for all of them.
        where: { id: 'whk_1', status: { in: ['PENDING', 'FAILED'] } },
        data: {
          status: 'FAILED',
          lastError: 'host boom',
          attempts: { increment: 1 },
          replayAttempts: { increment: 1 },
        },
      },
      {
        where: { id: 'whk_1', status: { in: ['PENDING', 'FAILED'] } },
        data: { status: 'FAILED', lastError: 'host boom', attempts: { increment: 1 } },
      },
      {
        where: { id: 'whk_1' },
        data: { status: 'PROCESSED', processedAt: expect.any(Date), attempts: { increment: 1 } },
      },
    ]);
  });
});

describe('gateway.replayWebhooks', () => {
  it('finishes a PENDING row the provider will never redeliver', async () => {
    const { now, stranded } = clock();
    const world = setupGatewayWorld();
    await world.gateway.charge(TENANT, pixInput('order-1'));
    // A process that died between record() and markProcessed: the row is
    // committed, the charge was never applied, and the provider already has its
    // 2xx — nothing but this sweep will ever come back for it.
    const { id } = await world.webhooks.record(TENANT, stoneDelivery('evt-1', 'PAID'), 'evt-1');
    world.webhooks.backdate(id, stranded);

    const report = await world.gateway.replayWebhooks({ now });

    expect(report).toEqual({ attempted: 1, processed: 1, failed: 0, skipped: 0, undecodable: 0 });
    expect(world.charges.all()[0]?.snapshot.status).toBe('PAID');
    expect(world.seenEvents.map((event) => event.eventId)).toEqual(['evt-1']);
    expect(world.webhooks.statuses()[id]).toBe('PROCESSED');
  });

  it('finishes a FAILED row whose handler threw the first time', async () => {
    const { now, stranded } = clock();
    const seen: string[] = [];
    const world = setupGatewayWorld(async (event) => {
      seen.push(event.eventId);
      if (seen.length === 1) throw new Error('order confirmation blew up');
    });
    await world.gateway.charge(TENANT, pixInput('order-1'));
    await expect(
      world.gateway.handleWebhook(TENANT, stoneDelivery('evt-1', 'PAID')),
    ).rejects.toThrow('order confirmation blew up');
    const [id = ''] = Object.keys(world.webhooks.statuses());
    world.webhooks.backdate(id, stranded);

    const report = await world.gateway.replayWebhooks({ now });

    expect(report.processed).toBe(1);
    expect(seen).toEqual(['evt-1', 'evt-1']);
    expect(world.charges.all()[0]?.snapshot.status).toBe('PAID');
    expect(world.webhooks.statuses()[id]).toBe('PROCESSED');
  });

  it('re-verifies a stored delivery and REFUSES one the adapter now rejects', async () => {
    // THE property this path is built around, and it is the opposite of what an
    // earlier version of this module claimed. No scheme here is timestamp-
    // bounded — every one of them reads bytes the inbox stored verbatim — so
    // `verify` is exactly as answerable on a stored row as it was at intake,
    // and it is the only thing standing between a row that reached the table by
    // some route other than the live path and `markOrderPaid`.
    const { now, stranded } = clock();
    const world = setupGatewayWorld();
    await world.gateway.charge(TENANT, pixInput('order-1'));
    // Live mode with a configured secret: the shared-secret adapter now demands
    // an `x-webhook-secret` header, which this delivery has never carried.
    world.credentials.set(TENANT, 'stone', {
      ...STUB_CREDS,
      stub: false,
      fields: { webhookSecret: 'shh' },
    });
    const delivery = stoneDelivery('evt-1', 'PAID');

    // The premise, pinned: the live path really does refuse this exact body.
    await expect(world.gateway.handleWebhook(TENANT, delivery)).rejects.toThrow(
      WebhookVerificationError,
    );

    // A row in the table anyway. The sweep must hold it to the same bar.
    const { id } = await world.webhooks.record(TENANT, delivery, 'evt-1');
    world.webhooks.backdate(id, stranded);

    const report = await world.gateway.replayWebhooks({ now });

    expect(report).toEqual({ attempted: 1, processed: 0, failed: 1, skipped: 0, undecodable: 0 });
    expect(world.seenEvents).toEqual([]);
    expect(world.charges.all()[0]?.snapshot.status).toBe('PENDING');
    expect(world.webhooks.statuses()[id]).toBe('FAILED');
    // The attempt is counted, so an unverifiable row retires instead of being
    // re-read by every pass forever.
    expect(world.webhooks.replayAttemptsById()[id]).toBe(1);
  });

  it('does not mark an InfinitePay row PAID once the provider stops confirming it', async () => {
    // InfinitePay deliveries are unsigned, so `verify` is not a signature check
    // at all — it re-asks InfinitePay over the wire whether the payment stands,
    // and `parse` then hardcodes `status: 'PAID'` on the strength of that call
    // having happened. A replay that skipped `verify` would therefore assert
    // PAID with nothing having confirmed it, which for a row sitting in backoff
    // means asserting it hours after a reversal. Here the payment is confirmed
    // at intake and refused afterwards.
    const { now, stranded } = clock();
    const world = setupGatewayWorld();
    world.credentials.set(TENANT, 'infinitepay', { environment: 'SANDBOX', fields: {}, stub: true });
    const delivery = infinitePayDelivery('order-ip', 'txn-1');
    await world.charges.create({
      merchant: TENANT,
      reference: 'order-ip',
      snapshot: {
        provider: 'infinitepay',
        providerChargeId: 'order-ip',
        status: 'PENDING',
        amount: { amountCents: 12_50, currency: 'BRL' },
        method: 'PIX',
      },
    });
    const infinitepay = world.providers.get('infinitepay');
    // The premise, pinned against the real adapter: `parse` asserts PAID all on
    // its own — its own doc comment says reaching it means `payment_check`
    // confirmed the payment. So `verify` is the confirmation, and skipping it
    // does not skip a signature check, it skips asking whether the money is
    // still there. No network here: the confirmation is stood in for, because
    // what is under test is that the sweep ASKS and honours the answer.
    const [parsed] = await infinitepay.webhook.parse(delivery, {
      environment: 'SANDBOX',
      fields: {},
      stub: true,
    });
    expect(parsed?.charge?.status).toBe('PAID');
    const confirmation = vi.spyOn(infinitepay.webhook, 'verify').mockResolvedValue(true);

    const { id } = await world.webhooks.record(TENANT, delivery, 'txn-1');
    world.webhooks.backdate(id, stranded);
    // The payment is reversed at InfinitePay while the row sits in its backoff.
    confirmation.mockResolvedValue(false);

    const report = await world.gateway.replayWebhooks({ now });

    expect(confirmation).toHaveBeenCalledTimes(1);

    expect(report).toEqual({ attempted: 1, processed: 0, failed: 1, skipped: 0, undecodable: 0 });
    expect(world.seenEvents).toEqual([]);
    // The money the merchant no longer holds was never announced as arrived.
    expect(world.charges.all()[0]?.snapshot.status).toBe('PENDING');
    expect(world.webhooks.statuses()[id]).toBe('FAILED');
  });

  it('refuses a row whose merchant no longer has credentials to verify it with', async () => {
    // Fail closed. Nothing can authenticate this delivery any more, and
    // applying an unauthenticated "paid" is the one outcome worse than the
    // support ticket a retired FAILED row becomes.
    const { now, stranded } = clock();
    const world = setupGatewayWorld();
    const { id } = await world.webhooks.record(
      OTHER_TENANT,
      stoneDelivery('evt-1', 'PAID'),
      'evt-1',
    );
    world.webhooks.backdate(id, stranded);

    const report = await world.gateway.replayWebhooks({ now });

    expect(report).toEqual({ attempted: 1, processed: 0, failed: 1, skipped: 0, undecodable: 0 });
    expect(world.seenEvents).toEqual([]);
    expect(world.webhooks.statuses()[id]).toBe('FAILED');
  });

  it('marks a row FAILED and counts exactly ONE attempt when the handler throws', async () => {
    const { now, stranded } = clock();
    const world = setupGatewayWorld(vi.fn().mockRejectedValue(new Error('host boom')));
    await world.gateway.charge(TENANT, pixInput('order-1'));
    const { id } = await world.webhooks.record(TENANT, stoneDelivery('evt-1', 'PAID'), 'evt-1');
    world.webhooks.backdate(id, stranded);

    const report = await world.gateway.replayWebhooks({ now });

    expect(report).toEqual({ attempted: 1, processed: 0, failed: 1, skipped: 0, undecodable: 0 });
    expect(world.webhooks.statuses()[id]).toBe('FAILED');
    // ONE attempt, not two: a sweep that marked the row itself on top of the
    // ingest's own mark would halve every row's retry budget.
    expect(world.webhooks.attemptsById()[id]).toBe(1);
  });

  it('keeps sweeping after a row fails — one poisoned payload strands only itself', async () => {
    const { now, minutesAgo } = clock();
    const world = setupGatewayWorld(async (event) => {
      if (event.eventId === 'evt-bad') throw new Error('host boom');
    });
    await world.gateway.charge(TENANT, pixInput('order-1'));
    const bad = await world.webhooks.record(TENANT, stoneDelivery('evt-bad', 'PAID'), 'evt-bad');
    const good = await world.webhooks.record(TENANT, stoneDelivery('evt-ok', 'PAID'), 'evt-ok');
    world.webhooks.backdate(bad.id, minutesAgo(120));
    world.webhooks.backdate(good.id, minutesAgo(60));

    const report = await world.gateway.replayWebhooks({ now });

    expect(report).toEqual({ attempted: 2, processed: 1, failed: 1, skipped: 0, undecodable: 0 });
    expect(world.webhooks.statuses()[bad.id]).toBe('FAILED');
    expect(world.webhooks.statuses()[good.id]).toBe('PROCESSED');
    expect(world.charges.all()[0]?.snapshot.status).toBe('PAID');
  });

  it('keeps sweeping when the INBOX ITSELF cannot be written', async () => {
    // The un-sticker must not be stuck by the outage it exists to recover from.
    // Every settle path is a WRITE and a write can throw; the ones that matter
    // sit outside `replayOne`'s inner try — `record` (staged here, as the
    // earliest and clearest) and `markFailed` in the ingest's own error handler.
    const { now, minutesAgo } = clock();
    const inbox = createMemoryWebhookInbox();
    const bad = await inbox.record(TENANT, stoneDelivery('evt-bad', 'PAID'), 'evt-bad');
    const good = await inbox.record(TENANT, stoneDelivery('evt-ok', 'PAID'), 'evt-ok');
    // The unwritable row is the MORE stranded of the two, so it is listed — and
    // blows up — before the row that must still be reached.
    inbox.backdate(bad.id, minutesAgo(120));
    inbox.backdate(good.id, minutesAgo(60));
    const seen: string[] = [];
    const brittle: WebhookInbox = {
      async record(merchant, delivery, eventId) {
        if (eventId === 'evt-bad') throw new Error('inbox unreachable');
        return inbox.record(merchant, delivery, eventId);
      },
      markProcessed: (id) => inbox.markProcessed(id),
      markFailed: (id, error, source) => inbox.markFailed(id, error, source),
      listRetryable: (options) => inbox.listRetryable(options),
    };
    const world = setupCustomInboxWorld(brittle, async (event) => {
      seen.push(event.eventId);
    });

    const report = await world.gateway.replayWebhooks({ now });

    expect(report).toEqual({ attempted: 2, processed: 1, failed: 1, skipped: 0, undecodable: 0 });
    expect(seen).toEqual(['evt-ok']);
    expect(inbox.statuses()[good.id]).toBe('PROCESSED');
    // Left exactly as it was — no status, no counted attempt — because the write
    // that would have said otherwise is the thing that failed. The next pass
    // finds it again, which is what a transient store fault deserves.
    expect(inbox.statuses()[bad.id]).toBe('PENDING');
    expect(inbox.attemptsById()[bad.id]).toBe(0);
  });

  it('retires rows it cannot decode so they stop owning the batch', async () => {
    // The starvation a silent skip causes: the query applies `take` BEFORE the
    // headers are parsed, so an unusable row has already spent a slot. Left
    // untouched its `updatedAt` never moves, and since the ordering is
    // oldest-first it spends that same slot on every pass — for `limit` such
    // rows the sweep never reaches a valid delivery again. Retiring them is
    // what gives the slot back.
    const { now } = clock();
    const retired: string[] = [];
    const handler = vi.fn();
    const blockedInbox: WebhookInbox = {
      async record() {
        throw new Error('nothing decodable to record in this batch');
      },
      async markProcessed() {
        throw new Error('nothing was replayed, so nothing can settle');
      },
      async markFailed(id, _error, source) {
        // Charged to the REPLAY budget: that is the counter `listRetryable`
        // buckets on, so it is the only one that climbs the row toward the cap
        // and out of the work list.
        expect(source).toBe('REPLAY');
        retired.push(id);
      },
      async listRetryable() {
        return { deliveries: [], undecodable: ['whk_bad_1', 'whk_bad_2'] };
      },
    };
    const world = setupCustomInboxWorld(blockedInbox, handler);

    const report = await world.gateway.replayWebhooks({ now });

    expect(retired).toEqual(['whk_bad_1', 'whk_bad_2']);
    expect(report).toEqual({
      attempted: 0,
      processed: 0,
      failed: 0,
      skipped: 0,
      undecodable: 2,
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not reopen a row a live delivery settled while replay was verifying', async () => {
    // `verifyAndParse` awaits credential resolution and a `verify` that, for an
    // unsigned provider, is a live call back to the provider. A live delivery
    // can settle the row during that await; when verification then fails, the
    // failure write must not walk the settled row back to FAILED, or the next
    // redelivery reads `settled: false` and re-applies an applied charge.
    const { stranded } = clock();
    const inbox = createMemoryWebhookInbox();
    const raced = await seedRow(inbox, 'evt-raced', { updatedAt: stranded });

    // The live path wins the race, mid-verify.
    await inbox.markProcessed(raced);
    // Replay's verification then fails and reports it against the same row.
    await inbox.markFailed(raced, 'signature no longer valid', 'REPLAY');

    expect(inbox.statuses()[raced]).toBe('PROCESSED');
    const redelivered = await inbox.record(
      TENANT,
      stoneDelivery('evt-raced', 'PAID'),
      'evt-raced',
    );
    expect(redelivered).toMatchObject({ duplicate: true, settled: true });
  });

  it('leaves an undecodable row alone once something else has settled it', async () => {
    // The read-then-write window, on the ONE path with no `record()` call to
    // re-check settlement at act time. A live redelivery settles the row after
    // the listing query named it undecodable; retiring it unconditionally would
    // pull a PROCESSED row back to FAILED — and `record()` reports `settled`
    // from precisely that status, so the NEXT redelivery would find it unsettled
    // and re-run the handler on a charge that already applied.
    const { stranded } = clock();
    const inbox = createMemoryWebhookInbox();
    const settled = await seedRow(inbox, 'evt-raced', { updatedAt: stranded });
    await inbox.markProcessed(settled);

    await inbox.markFailed(settled, 'headers could not be decoded', 'REPLAY');

    expect(inbox.statuses()[settled]).toBe('PROCESSED');
    // And the guard is what makes the re-application impossible: a redelivery
    // still reads this row as settled, so the pipeline stands down.
    const seen = await inbox.record(TENANT, stoneDelivery('evt-raced', 'PAID'), 'evt-raced');
    expect(seen).toMatchObject({ duplicate: true, settled: true });
  });

  it('retires an undecodable row that is still unsettled', async () => {
    // The other side of the guard: it must not become a blanket no-op, or the
    // starvation it was added to fix comes straight back.
    const { stranded } = clock();
    const inbox = createMemoryWebhookInbox();
    const stuck = await seedRow(inbox, 'evt-stuck', { updatedAt: stranded });

    await inbox.markFailed(stuck, 'headers could not be decoded', 'REPLAY');

    expect(inbox.statuses()[stuck]).toBe('FAILED');
    // Charged to the replay budget — that is the counter that climbs the row
    // toward the cap and out of the work list.
    expect(inbox.replayAttemptsById()[stuck]).toBe(1);
  });

  it('keeps replaying the good rows when part of the batch cannot be decoded', async () => {
    // The mixed batch: an unusable row must not cost the deliveries beside it.
    const { now, stranded } = clock();
    const world = setupGatewayWorld();
    await world.gateway.charge(TENANT, pixInput('order-1'));
    const recorded = await world.webhooks.record(TENANT, stoneDelivery('evt-1', 'PAID'), 'evt-1');
    world.webhooks.backdate(recorded.id, stranded);
    const realList = world.webhooks.listRetryable.bind(world.webhooks);
    // Splice an undecodable id in alongside the genuinely replayable row.
    world.webhooks.listRetryable = async (options) => ({
      ...(await realList(options)),
      undecodable: ['whk_unusable'],
    });

    const report = await world.gateway.replayWebhooks({ now });

    expect(report.undecodable).toBe(1);
    expect(report.attempted).toBe(1);
    expect(report.processed).toBe(1);
    expect(world.webhooks.statuses()[recorded.id]).toBe('PROCESSED');
  });

  it('never re-applies a delivery that already PROCESSED', async () => {
    const { now, stranded } = clock();
    const world = setupGatewayWorld();
    await world.gateway.charge(TENANT, pixInput('order-1'));
    await world.gateway.handleWebhook(TENANT, stoneDelivery('evt-1', 'PAID'));
    const [id = ''] = Object.keys(world.webhooks.statuses());
    world.webhooks.backdate(id, stranded);

    const report = await world.gateway.replayWebhooks({ now });

    expect(report).toEqual({ attempted: 0, processed: 0, failed: 0, skipped: 0, undecodable: 0 });
    expect(world.seenEvents).toHaveLength(1);
  });

  it('re-checks settlement at act time, not at list time', async () => {
    // The read-then-write window: a live delivery settles the row after the
    // listing query saw it. Replay re-enters through record(), which re-reads
    // the row, so it skips instead of applying the charge a second time.
    const { now } = clock();
    const listed: StoredWebhookDelivery = {
      id: 'whk_1',
      merchant: TENANT,
      delivery: stoneDelivery('evt-1', 'PAID'),
      eventId: 'evt-1',
    };
    const handler = vi.fn();
    const staleInbox: WebhookInbox = {
      async record() {
        return { id: 'whk_1', duplicate: true, settled: true };
      },
      async markProcessed() {
        throw new Error('must not settle an already-settled row');
      },
      async markFailed() {
        throw new Error('must not fail an already-settled row');
      },
      async listRetryable() {
        return { deliveries: [listed], undecodable: [] };
      },
    };
    const world = setupCustomInboxWorld(staleInbox, handler);

    const report = await world.gateway.replayWebhooks({ now });

    expect(report).toEqual({ attempted: 1, processed: 0, failed: 0, skipped: 1, undecodable: 0 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('leaves a row past the attempt cap alone — FAILED, and visible to support', async () => {
    const { now, stranded } = clock();
    const handler = vi.fn();
    const world = setupGatewayWorld(handler);
    const { id } = await world.webhooks.record(TENANT, stoneDelivery('evt-1', 'PAID'), 'evt-1');
    await world.webhooks.markFailed(id, 'boom', 'REPLAY');
    await world.webhooks.markFailed(id, 'boom', 'REPLAY');
    world.webhooks.backdate(id, stranded);

    const report = await world.gateway.replayWebhooks({ now, maxAttempts: 2 });

    expect(report.attempted).toBe(0);
    expect(handler).not.toHaveBeenCalled();
    expect(world.webhooks.statuses()[id]).toBe('FAILED');
  });

  it('leaves a row inside its per-attempt backoff window entirely alone', async () => {
    const { now, minutesAgo } = clock();
    const handler = vi.fn();
    const world = setupGatewayWorld(handler);
    const { id } = await world.webhooks.record(TENANT, stoneDelivery('evt-1', 'PAID'), 'evt-1');
    await world.webhooks.markFailed(id, 'boom', 'REPLAY');
    // One counted attempt buys a two-minute wait; this row moved 90s ago.
    world.webhooks.backdate(id, minutesAgo(1.5));

    const report = await world.gateway.replayWebhooks({ now });

    // Not merely skipped: never listed. `attempted: 0` therefore means "nothing
    // was due", which is what lets the host job stay silent on a zero pass
    // without that silence being able to hide a starved one.
    expect(report).toEqual({ attempted: 0, processed: 0, failed: 0, skipped: 0, undecodable: 0 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('spends its batch on due rows even when waiting rows are older', async () => {
    // The starvation regression, end to end. A row deep in its backoff has an
    // OLD `updatedAt` by construction, so under a coarse query plus an
    // in-memory filter it sorts FIRST, fills the limit, and the pass attempts
    // nothing — for as long as the backoff lasts, which at the cap is six
    // hours. The row it hides is a buyer who paid and whose 2xx the provider
    // already has: nothing else is ever coming back for it.
    const { now, minutesAgo } = clock();
    const world = setupGatewayWorld();
    await world.gateway.charge(TENANT, pixInput('order-1'));
    for (const eventId of ['evt-wait-a', 'evt-wait-b']) {
      const { id } = await world.webhooks.record(TENANT, stoneDelivery(eventId, 'PAID'), eventId);
      // Five counted replay failures buy 32 minutes; touched 10 minutes ago.
      await repeat(5, () => world.webhooks.markFailed(id, 'boom', 'REPLAY'));
      world.webhooks.backdate(id, minutesAgo(10));
    }
    const fresh = await world.webhooks.record(TENANT, stoneDelivery('evt-due', 'PAID'), 'evt-due');
    world.webhooks.backdate(fresh.id, minutesAgo(5));

    const report = await world.gateway.replayWebhooks({ now, limit: 2 });

    expect(report).toEqual({ attempted: 1, processed: 1, failed: 0, skipped: 0, undecodable: 0 });
    expect(world.webhooks.statuses()[fresh.id]).toBe('PROCESSED');
    expect(world.charges.all()[0]?.snapshot.status).toBe('PAID');
  });

  it('keeps its retry budget when a provider redelivers a failing row', async () => {
    // The live path and the sweep are bounded by unrelated things. A broken
    // handler makes the endpoint answer 5xx, the provider redelivers every few
    // minutes, and each redelivery fails again — on a shared counter that
    // spends the sweep's ten attempts within a couple of hours, after which the
    // row drops out of the work list having never been replayed at all.
    const { now, stranded } = clock();
    let handlerWorks = false;
    const world = setupGatewayWorld(async () => {
      if (!handlerWorks) throw new Error('order confirmation blew up');
    });
    await world.gateway.charge(TENANT, pixInput('order-1'));
    const delivery = stoneDelivery('evt-1', 'PAID');
    // Nine provider redeliveries against the broken handler — one short of the
    // cap, if the two budgets were one.
    await repeat(9, async () => {
      await expect(world.gateway.handleWebhook(TENANT, delivery)).rejects.toThrow();
    });
    const [id = ''] = Object.keys(world.webhooks.statuses());
    expect(world.webhooks.attemptsById()[id]).toBe(9);
    expect(world.webhooks.replayAttemptsById()[id]).toBe(0);

    // The provider gives up, the underlying fault clears, and the sweep — whose
    // whole job is this row — still has its full budget.
    handlerWorks = true;
    world.webhooks.backdate(id, stranded);
    const report = await world.gateway.replayWebhooks({ now });

    expect(report).toEqual({ attempted: 1, processed: 1, failed: 0, skipped: 0, undecodable: 0 });
    expect(world.webhooks.statuses()[id]).toBe('PROCESSED');
    expect(world.charges.all()[0]?.snapshot.status).toBe('PAID');
  });

  it('retires a row whose stored body no longer yields the event it was recorded under', async () => {
    // Otherwise the row is never settled and never counted: it would be re-read
    // by every sweep forever, holding a slot in the work list.
    const { now, stranded } = clock();
    const world = setupGatewayWorld();
    await world.gateway.charge(TENANT, pixInput('order-1'));
    const { id } = await world.webhooks.record(
      TENANT,
      stoneDelivery('evt-body', 'PAID'),
      'evt-recorded-under',
    );
    world.webhooks.backdate(id, stranded);

    const report = await world.gateway.replayWebhooks({ now });

    expect(report.failed).toBe(1);
    expect(world.webhooks.statuses()[id]).toBe('FAILED');
    expect(world.webhooks.replayAttemptsById()[id]).toBe(1);
  });

  it('honours the row limit so a backlog drains over passes', async () => {
    const { now, stranded } = clock();
    const world = setupGatewayWorld();
    await world.gateway.charge(TENANT, pixInput('order-1'));
    for (const eventId of ['evt-1', 'evt-2', 'evt-3']) {
      const { id } = await world.webhooks.record(TENANT, stoneDelivery(eventId, 'PAID'), eventId);
      world.webhooks.backdate(id, stranded);
    }

    const first = await world.gateway.replayWebhooks({ now, limit: 2 });
    expect(first.processed).toBe(2);
    const second = await world.gateway.replayWebhooks({ now, limit: 2 });
    expect(second.processed).toBe(1);
  });
});
