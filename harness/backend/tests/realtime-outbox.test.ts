/* eslint-disable test-flakiness/no-database-operations, test-flakiness/no-test-isolation --
   the DATABASE is the subject: this suite exists to prove the claim protocol behaves on a
   real Postgres, which a fake cannot answer. Every case opens its own in-process PGlite and
   closes it, so there is no shared state and nothing to order. */
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';

import {
  configureRealtime,
  createInlineRealtimeDriver,
  resetRealtimeRuntime,
  type RealtimeEvent,
} from '@12-apps/realtime';
import {
  createRealtimeOutbox,
  enqueueRealtimeEvent,
  type RealtimeOutbox,
} from '@12-apps/realtime/server';

import {
  openRealtimeDb,
  pendingOutboxIds,
  readOutboxRow,
  realtimeOutboxDrainDb,
  realtimeOutboxWriteDb,
} from '../src/realtime-db';
import type { SqlRunner } from '../src/rbac-db-shared';

/**
 * The transactional outbox, over a REAL Postgres, out of the packed tarball.
 *
 * The package's own unit tests pin the RULES against an in-memory store. This suite pins the
 * SQL those rules translate to — and specifically the one property a fake cannot answer:
 * that a CLAIM is a single conditional `UPDATE`, so PostgreSQL's row lock decides which of
 * two racing drains wins and `affectedRows` is 0 for the loser.
 *
 * A read-validate-write drain passes every unit test in a single-threaded fake and publishes
 * every row twice here.
 */

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

/** Install a bus that records what reached it, and hand back the record. */
function recordingBus(): { published: { topic: string; id: string }[] } {
  const driver = createInlineRealtimeDriver({ logger: silentLogger });
  const published: { topic: string; id: string }[] = [];
  const original = driver.publish.bind(driver);
  driver.publish = async (topic: string, event: RealtimeEvent) => {
    published.push({ topic, id: event.id });
    await original(topic, event);
  };
  configureRealtime({ driver, logger: silentLogger });
  return { published };
}

/** A drain over `pg`, named so a test can run two of them. */
function drainerOver(pg: PGlite, drainerId: string, options: { claimLeaseMs?: number } = {}): RealtimeOutbox {
  return createRealtimeOutbox({
    db: () => realtimeOutboxDrainDb(pg as unknown as SqlRunner),
    logger: silentLogger,
    drainerId,
    ...options,
  });
}

/** Enqueue inside a transaction, the way a host's domain write does. */
async function enqueue(pg: PGlite, type: string, topic = 'tenant:t-1:orders'): Promise<void> {
  await pg.transaction(async (tx) => {
    await enqueueRealtimeEvent(realtimeOutboxWriteDb(tx as unknown as SqlRunner), { topic, type });
  });
}

afterEach(() => {
  resetRealtimeRuntime();
});

describe('the outbox row commits with its cause', () => {
  it('is visible after the transaction commits', async () => {
    const pg = await openRealtimeDb();
    try {
      await enqueue(pg, 'orders.changed');
      expect(await pendingOutboxIds(pg)).toHaveLength(1);
    } finally {
      await pg.close();
    }
  });

  it('is GONE when the transaction rolls back — no event without its cause', async () => {
    const pg = await openRealtimeDb();
    try {
      await pg
        .transaction(async (tx) => {
          await enqueueRealtimeEvent(realtimeOutboxWriteDb(tx as unknown as SqlRunner), {
            topic: 'tenant:t-1:orders',
            type: 'orders.changed',
          });
          throw new Error('the domain write failed');
        })
        .catch(() => undefined);
      // The whole reason the outbox is transactional: the pair is atomic in BOTH
      // directions.
      expect(await pendingOutboxIds(pg)).toEqual([]);
    } finally {
      await pg.close();
    }
  });
});

describe('the drain, on a real Postgres', () => {
  it('publishes pending rows in commit order and marks them', async () => {
    const pg = await openRealtimeDb();
    const bus = recordingBus();
    try {
      await enqueue(pg, 'a');
      await enqueue(pg, 'b');
      await enqueue(pg, 'c');
      const pending = await pendingOutboxIds(pg);

      expect(await drainerOver(pg, 'solo').drain()).toMatchObject({
        published: 3,
        failed: 0,
        contended: 0,
      });
      // The row id travels as the event id, which is what makes a duplicate identifiable.
      expect(bus.published.map((entry) => entry.id)).toEqual(pending);
      expect(await pendingOutboxIds(pg)).toEqual([]);
    } finally {
      await pg.close();
    }
  });

  it('never republishes a marked row', async () => {
    const pg = await openRealtimeDb();
    const bus = recordingBus();
    try {
      await enqueue(pg, 'a');
      const drain = drainerOver(pg, 'solo');
      await drain.drain();
      expect(await drain.drain()).toMatchObject({ published: 0, failed: 0, contended: 0 });
      expect(bus.published).toHaveLength(1);
    } finally {
      await pg.close();
    }
  });

  it('clears the claim and the last error when it succeeds', async () => {
    const pg = await openRealtimeDb();
    recordingBus();
    try {
      await enqueue(pg, 'a');
      const [id] = await pendingOutboxIds(pg);
      if (!id) throw new Error('no pending row');
      await drainerOver(pg, 'solo').drain();
      expect(await readOutboxRow(pg, id)).toMatchObject({
        claimedAt: null,
        lastError: null,
        attempts: 1,
      });
    } finally {
      await pg.close();
    }
  });
});

describe('TWO DRAINS, ONE ROW — the claim is atomic in the database', () => {
  it('publishes a contended row exactly once', async () => {
    const pg = await openRealtimeDb();
    const bus = recordingBus();
    try {
      await enqueue(pg, 'a');
      // Started together, so both `findMany` calls see the row before either claims it.
      const [left, right] = await Promise.all([
        drainerOver(pg, 'left').drain(),
        drainerOver(pg, 'right').drain(),
      ]);

      expect(bus.published).toHaveLength(1);
      expect(left.published + right.published).toBe(1);
      expect(left.contended + right.contended).toBe(1);
      // One claim, one attempt: the loser never took the row, so it never paid for it.
      const [id] = bus.published.map((entry) => entry.id);
      if (!id) throw new Error('nothing published');
      expect(await readOutboxRow(pg, id)).toMatchObject({ attempts: 1 });
    } finally {
      await pg.close();
    }
  });

  it('publishes twenty rows exactly once each across six concurrent drains', async () => {
    const pg = await openRealtimeDb();
    const bus = recordingBus();
    try {
      for (let index = 0; index < 20; index += 1) await enqueue(pg, `e-${index}`);
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, index) => drainerOver(pg, `d-${index}`).drain()),
      );

      expect(bus.published).toHaveLength(20);
      // The assertion a read-validate-write drain fails: no id appears twice.
      expect(new Set(bus.published.map((entry) => entry.id)).size).toBe(20);
      expect(results.reduce((total, result) => total + result.published, 0)).toBe(20);
      expect(await pendingOutboxIds(pg)).toEqual([]);
    } finally {
      await pg.close();
    }
  });

  it('leaves a row claimed by a LIVE drainer alone', async () => {
    const pg = await openRealtimeDb();
    recordingBus();
    try {
      await enqueue(pg, 'a');
      const [id] = await pendingOutboxIds(pg);
      if (!id) throw new Error('no pending row');
      // Somebody else holds it, as of now.
      await pg.query(
        `UPDATE realtime_outbox_events SET claimed_at = NOW(), claimed_by = 'other' WHERE id = $1`,
        [id],
      );
      expect(await drainerOver(pg, 'mine', { claimLeaseMs: 600_000 }).drain()).toMatchObject({
        published: 0,
        contended: 0,
      });
      expect(await readOutboxRow(pg, id)).toMatchObject({ claimedBy: 'other', attempts: 0 });
    } finally {
      await pg.close();
    }
  });

  it('takes over a claim whose lease lapsed — a dead drainer must not strand a row', async () => {
    const pg = await openRealtimeDb();
    const bus = recordingBus();
    try {
      await enqueue(pg, 'a');
      const [id] = await pendingOutboxIds(pg);
      if (!id) throw new Error('no pending row');
      // Claimed an hour ago: the holder is not coming back.
      await pg.query(
        `UPDATE realtime_outbox_events
           SET claimed_at = NOW() - INTERVAL '1 hour', claimed_by = 'dead' WHERE id = $1`,
        [id],
      );
      expect(await drainerOver(pg, 'mine').drain()).toMatchObject({ published: 1 });
      expect(bus.published).toHaveLength(1);
      // The takeover is itself a claim, so it is counted — which is what bounds a row that
      // keeps killing its drainer.
      expect(await readOutboxRow(pg, id)).toMatchObject({ attempts: 1, publishedAt: expect.any(Date) as unknown as Date });
    } finally {
      await pg.close();
    }
  });
});

describe('failure, and the attempt ceiling', () => {
  it('releases the claim and records the reason when the bus is dead', async () => {
    const pg = await openRealtimeDb();
    try {
      // No driver configured: `publishRealtimeEvent` reports `no-driver` and never throws.
      await enqueue(pg, 'a');
      const [id] = await pendingOutboxIds(pg);
      if (!id) throw new Error('no pending row');
      expect(await drainerOver(pg, 'solo').drain()).toMatchObject({ published: 0, failed: 1 });
      expect(await readOutboxRow(pg, id)).toMatchObject({
        publishedAt: null,
        claimedAt: null,
        lastError: 'no-driver',
        attempts: 1,
      });
    } finally {
      await pg.close();
    }
  });

  it('stops picking a row up once it has burned its attempts, and KEEPS it', async () => {
    const pg = await openRealtimeDb();
    try {
      await enqueue(pg, 'a');
      const [id] = await pendingOutboxIds(pg);
      if (!id) throw new Error('no pending row');
      const drain = createRealtimeOutbox({
        db: () => realtimeOutboxDrainDb(pg as unknown as SqlRunner),
        logger: silentLogger,
        drainerId: 'solo',
        maxAttempts: 2,
      });
      await drain.drain();
      await drain.drain();
      // Silent infinite retry would grind the drain on a poison row; silent deletion would
      // be the exact loss the outbox exists to prevent.
      expect(await drain.drain()).toMatchObject({ published: 0, failed: 0, contended: 0 });
      expect(await readOutboxRow(pg, id)).toMatchObject({ attempts: 2, lastError: 'no-driver' });
    } finally {
      await pg.close();
    }
  });

  it('drains a row that failed once, on the next pass', async () => {
    const pg = await openRealtimeDb();
    try {
      await enqueue(pg, 'a');
      // Pass one: no bus.
      await drainerOver(pg, 'solo').drain();
      // Pass two: the bus is back. `attempts` already spent one, so the retry is bounded.
      const bus = recordingBus();
      expect(await drainerOver(pg, 'solo').drain()).toMatchObject({ published: 1 });
      expect(bus.published).toHaveLength(1);
    } finally {
      await pg.close();
    }
  });
});

describe('the purge', () => {
  it('removes published rows past the cutoff and spares the rest', async () => {
    const pg = await openRealtimeDb();
    recordingBus();
    try {
      await enqueue(pg, 'old');
      await enqueue(pg, 'fresh');
      await drainerOver(pg, 'solo').drain();
      // Backdate one of them, in the database, so the cutoff is arithmetic on real rows.
      await pg.query(
        `UPDATE realtime_outbox_events SET published_at = NOW() - INTERVAL '2 hours'
           WHERE type = 'old'`,
      );
      await enqueue(pg, 'still-pending');

      expect(await drainerOver(pg, 'solo').purgePublished(60 * 60 * 1000)).toBe(1);
      const { rows } = await pg.query<{ type: string }>(
        `SELECT type FROM realtime_outbox_events ORDER BY type`,
      );
      expect(rows.map((row) => row.type)).toEqual(['fresh', 'still-pending']);
    } finally {
      await pg.close();
    }
  });
});
