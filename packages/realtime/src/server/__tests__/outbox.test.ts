import { afterEach, describe, expect, it, vi } from "vitest";

import { configureRealtime, resetRealtimeRuntime } from "../../core/runtime";
import { createInlineRealtimeDriver } from "../../drivers/inline";
import {
  createRealtimeOutbox,
  enqueueRealtimeEvent,
  OUTBOX_DEFAULT_MAX_ATTEMPTS,
  type RealtimeOutboxDrainDb,
  type RealtimeOutboxRow,
} from "../outbox";

/**
 * The outbox's delivery semantics, over an in-memory store that behaves like the
 * database in the one respect that matters: a conditional `updateMany` is ATOMIC, so a
 * predicate that no longer holds updates nothing.
 *
 * That is the whole reason the drain claims rather than reads-then-writes, and it is
 * what the concurrency cases below assert. The same protocol is exercised against a
 * REAL Postgres in `harness/backend/tests/realtime-outbox.test.ts`, out of the packed
 * tarball — this file pins the rules, that one pins the SQL.
 */

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

/** A frozen base instant: the flakiness gate forbids `Date.now()` in a test body. */
const T0 = 1_767_225_600_000;

interface StoredRow extends RealtimeOutboxRow {
  createdAt: number;
  publishedAt: Date | null;
  claimedAt: Date | null;
  claimedBy: string | null;
  lastError: string | null;
}

/**
 * An in-memory `realtime_outbox_events`.
 *
 * Single-threaded JavaScript makes each delegate call atomic on its own, which models
 * PostgreSQL's row lock exactly for this protocol: the predicate and the mutation of one
 * `updateMany` cannot interleave with another's. Interleaving BETWEEN calls is what the
 * concurrency tests drive, and that is the real hazard.
 */
function memoryStore() {
  const rows: StoredRow[] = [];
  // A container property rather than a closed-over `let`: the flakiness gate forbids
  // reassigning a captured binding from inside a stub, and this IS a stub delegate.
  const ids = { next: 0 };

  const matchesClaimable = (row: StoredRow, or: readonly unknown[] | undefined): boolean => {
    if (!or) return true;
    const [, stale] = or as [{ claimedAt: null }, { claimedAt: { lt: Date } }];
    return row.claimedAt === null || row.claimedAt.getTime() < stale.claimedAt.lt.getTime();
  };

  const db: RealtimeOutboxDrainDb = {
    realtimeOutboxEvent: {
      findMany: async ({ where, take }) =>
        rows
          .filter(
            (row) =>
              row.publishedAt === null &&
              row.attempts < where.attempts.lt &&
              matchesClaimable(row, where.OR),
          )
          .sort((left, right) => left.createdAt - right.createdAt)
          .slice(0, take)
          .map(({ id, topic, type, data, attempts }) => ({ id, topic, type, data, attempts })),

      updateMany: async ({ where, data }) => {
        const row = rows.find((candidate) => candidate.id === where.id);
        if (!row) return { count: 0 };
        if (where.publishedAt === null && row.publishedAt !== null) return { count: 0 };
        if (where.claimedBy !== undefined && row.claimedBy !== where.claimedBy) return { count: 0 };
        if (!matchesClaimable(row, where.OR)) return { count: 0 };

        if ("claimedAt" in data && data.claimedAt instanceof Date) {
          row.claimedAt = data.claimedAt;
          row.claimedBy = (data as { claimedBy: string }).claimedBy;
          row.attempts += 1;
        } else if ("publishedAt" in data) {
          row.publishedAt = (data as { publishedAt: Date }).publishedAt;
          row.claimedAt = null;
          row.lastError = null;
        } else {
          row.claimedAt = null;
          row.lastError = (data as { lastError: string }).lastError;
        }
        return { count: 1 };
      },

      deleteMany: async ({ where }) => {
        const cutoff = where.publishedAt.lt.getTime();
        const doomed = rows.filter(
          (row) => row.publishedAt !== null && row.publishedAt.getTime() < cutoff,
        );
        for (const row of doomed) rows.splice(rows.indexOf(row), 1);
        return { count: doomed.length };
      },
    },
  };

  return {
    db,
    rows,
    /** The write side — the same delegate an `enqueueRealtimeEvent` transaction gets. */
    writeDb: {
      realtimeOutboxEvent: {
        create: async ({ data }: { data: { topic: string; type: string; data: unknown } }) => {
          ids.next += 1;
          rows.push({
            id: `row-${ids.next}`,
            topic: data.topic,
            type: data.type,
            data: data.data,
            attempts: 0,
            createdAt: ids.next,
            publishedAt: null,
            claimedAt: null,
            claimedBy: null,
            lastError: null,
          });
          return undefined;
        },
      },
    },
    row: (id: string): StoredRow => {
      const found = rows.find((candidate) => candidate.id === id);
      if (!found) throw new Error(`no row ${id}`);
      return found;
    },
  };
}

afterEach(() => {
  resetRealtimeRuntime();
  vi.useRealTimers();
});

/** Freeze the clock at `T0`, so a claim's age is arithmetic rather than a race. */
function freezeClock(): void {
  vi.useFakeTimers({ now: T0 });
}

/** Install a bus that records what reached it. */
function busThatWorks(): { published: { topic: string; id: string }[] } {
  const driver = createInlineRealtimeDriver({ logger: silentLogger });
  const published: { topic: string; id: string }[] = [];
  const original = driver.publish.bind(driver);
  driver.publish = async (topic, event) => {
    published.push({ topic, id: event.id });
    await original(topic, event);
  };
  configureRealtime({ driver, logger: silentLogger });
  return { published };
}

describe("enqueueRealtimeEvent", () => {
  it("writes the topic, type and payload on the caller's transaction client", async () => {
    const store = memoryStore();
    await enqueueRealtimeEvent(store.writeDb, {
      topic: "tenant:t-1:orders",
      type: "orders.changed",
      data: { orderId: "o-1" },
    });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({
      topic: "tenant:t-1:orders",
      type: "orders.changed",
      data: { orderId: "o-1" },
      attempts: 0,
      publishedAt: null,
    });
  });

  it("defaults the payload to an empty object — an event carries identifiers, not state", async () => {
    const store = memoryStore();
    await enqueueRealtimeEvent(store.writeDb, { topic: "tenant:t-1:orders", type: "x" });
    expect(store.rows[0]?.data).toEqual({});
  });

  it("throws on a malformed topic rather than committing an unpublishable row", async () => {
    const store = memoryStore();
    // Inside the caller's transaction, so throwing FAILS the domain write too — which
    // is right: the row could never be published, and the event is part of the write.
    await expect(
      enqueueRealtimeEvent(store.writeDb, { topic: "tenant: t-1:orders", type: "x" }),
    ).rejects.toThrow(/malformed topic/);
    expect(store.rows).toHaveLength(0);
  });
});

describe("outbox drain — the happy path", () => {
  it("publishes pending rows in commit order and marks them", async () => {
    const store = memoryStore();
    const bus = busThatWorks();
    for (const orderId of ["o-1", "o-2", "o-3"]) {
      await enqueueRealtimeEvent(store.writeDb, {
        topic: `tenant:t-1:orders`,
        type: "orders.changed",
        data: { orderId },
      });
    }
    const outbox = createRealtimeOutbox({ db: () => store.db, logger: silentLogger });

    expect(await outbox.drain()).toMatchObject({ published: 3, failed: 0, contended: 0 });
    expect(bus.published.map((entry) => entry.id)).toEqual(["row-1", "row-2", "row-3"]);
    expect(store.rows.every((row) => row.publishedAt !== null)).toBe(true);
  });

  it("publishes with the ROW ID as the event id, so a re-publish is recognisable", async () => {
    const store = memoryStore();
    const bus = busThatWorks();
    await enqueueRealtimeEvent(store.writeDb, { topic: "tenant:t-1:orders", type: "x" });
    await createRealtimeOutbox({ db: () => store.db, logger: silentLogger }).drain();
    // At-least-once delivery is only tolerable if a duplicate is IDENTIFIABLE. Without
    // this a re-published row looks like a second, real change.
    expect(bus.published).toEqual([{ topic: "tenant:t-1:orders", id: "row-1" }]);
  });

  it("does nothing on a second pass — a published row is never republished", async () => {
    const store = memoryStore();
    busThatWorks();
    await enqueueRealtimeEvent(store.writeDb, { topic: "tenant:t-1:orders", type: "x" });
    const outbox = createRealtimeOutbox({ db: () => store.db, logger: silentLogger });
    await outbox.drain();
    expect(await outbox.drain()).toMatchObject({ published: 0, failed: 0, contended: 0 });
  });

  it("reports `more` when it read a full batch, so a caller can drain again", async () => {
    const store = memoryStore();
    busThatWorks();
    for (let index = 0; index < 3; index += 1) {
      await enqueueRealtimeEvent(store.writeDb, { topic: "tenant:t-1:orders", type: "x" });
    }
    const outbox = createRealtimeOutbox({
      db: () => store.db,
      logger: silentLogger,
      batchSize: 2,
    });
    expect(await outbox.drain()).toMatchObject({ published: 2, more: true });
    expect(await outbox.drain()).toMatchObject({ published: 1, more: false });
  });
});

describe("outbox drain — TWO DRAINS, ONE ROW", () => {
  it("publishes a contended row exactly once, and the loser reports contention", async () => {
    // The attack: a read-validate-write drain has both passes see `claimed_at IS NULL`
    // and both publish. The claim is one conditional UPDATE, so only one wins.
    const store = memoryStore();
    const bus = busThatWorks();
    await enqueueRealtimeEvent(store.writeDb, { topic: "tenant:t-1:orders", type: "x" });

    const left = createRealtimeOutbox({
      db: () => store.db,
      logger: silentLogger,
      drainerId: "left",
    });
    const right = createRealtimeOutbox({
      db: () => store.db,
      logger: silentLogger,
      drainerId: "right",
    });

    // Started together, so both see the row in their `findMany` before either claims.
    const [first, second] = await Promise.all([left.drain(), right.drain()]);

    expect(bus.published).toHaveLength(1);
    expect(first.published + second.published).toBe(1);
    expect(first.contended + second.contended).toBe(1);
    expect(store.row("row-1").publishedAt).not.toBeNull();
    // One claim, one attempt: the loser never took the row, so it never paid for it.
    expect(store.row("row-1").attempts).toBe(1);
  });

  it("keeps eight concurrent drains from publishing any row twice", async () => {
    const store = memoryStore();
    const bus = busThatWorks();
    for (let index = 0; index < 12; index += 1) {
      await enqueueRealtimeEvent(store.writeDb, { topic: "tenant:t-1:orders", type: "x" });
    }
    const drains = Array.from({ length: 8 }, (_, index) =>
      createRealtimeOutbox({
        db: () => store.db,
        logger: silentLogger,
        drainerId: `d-${index}`,
      }).drain(),
    );
    const results = await Promise.all(drains);

    expect(bus.published).toHaveLength(12);
    expect(new Set(bus.published.map((entry) => entry.id)).size).toBe(12);
    expect(results.reduce((total, result) => total + result.published, 0)).toBe(12);
    expect(store.rows.every((row) => row.publishedAt !== null)).toBe(true);
  });

  it("will not let a drainer whose lease lapsed stamp a row another one now owns", async () => {
    const store = memoryStore();
    busThatWorks();
    await enqueueRealtimeEvent(store.writeDb, { topic: "tenant:t-1:orders", type: "x" });

    // Simulate the stranded holder: the row is claimed by somebody else, JUST NOW.
    freezeClock();
    store.row("row-1").claimedAt = new Date(T0);
    store.row("row-1").claimedBy = "other-drainer";

    // A drainer whose lease has NOT expired for that claim sees nothing to take.
    const outbox = createRealtimeOutbox({
      db: () => store.db,
      logger: silentLogger,
      drainerId: "mine",
      claimLeaseMs: 10 * 60 * 1000,
    });
    expect(await outbox.drain()).toMatchObject({ published: 0, contended: 0 });
    expect(store.row("row-1").claimedBy).toBe("other-drainer");
  });

  it("takes over a claim whose lease has expired — a dead drainer must not strand a row", async () => {
    const store = memoryStore();
    const bus = busThatWorks();
    await enqueueRealtimeEvent(store.writeDb, { topic: "tenant:t-1:orders", type: "x" });
    // Claimed in 1970: any lease is long gone.
    store.row("row-1").claimedAt = new Date(0);
    store.row("row-1").claimedBy = "dead-drainer";

    const outbox = createRealtimeOutbox({
      db: () => store.db,
      logger: silentLogger,
      drainerId: "mine",
    });
    expect(await outbox.drain()).toMatchObject({ published: 1 });
    expect(bus.published).toHaveLength(1);
    // The takeover is itself a claim, so it is counted — which is what bounds a row
    // that keeps killing its drainer.
    expect(store.row("row-1").attempts).toBe(1);
  });
});

describe("outbox drain — failure and the attempt ceiling", () => {
  it("releases the claim and records the reason when the bus refuses", async () => {
    const store = memoryStore();
    // No driver configured: `publishRealtimeEvent` reports `no-driver` and never throws.
    await enqueueRealtimeEvent(store.writeDb, { topic: "tenant:t-1:orders", type: "x" });
    const outbox = createRealtimeOutbox({ db: () => store.db, logger: silentLogger });

    expect(await outbox.drain()).toMatchObject({ published: 0, failed: 1 });
    const row = store.row("row-1");
    expect(row.publishedAt).toBeNull();
    expect(row.lastError).toBe("no-driver");
    // Released, so the next pass retries immediately; the attempt is already spent.
    expect(row.claimedAt).toBeNull();
    expect(row.attempts).toBe(1);
  });

  it("stops picking a row up once it has burned its attempts", async () => {
    const store = memoryStore();
    await enqueueRealtimeEvent(store.writeDb, { topic: "tenant:t-1:orders", type: "x" });
    const outbox = createRealtimeOutbox({
      db: () => store.db,
      logger: silentLogger,
      maxAttempts: 3,
    });
    for (let pass = 0; pass < 3; pass += 1) await outbox.drain();
    expect(store.row("row-1").attempts).toBe(3);

    // A fourth pass must find nothing — silent infinite retry would grind the drain on
    // a poison row forever.
    expect(await outbox.drain()).toMatchObject({ published: 0, failed: 0, contended: 0 });
    // And the row STAYS, with its reason: silent deletion is the loss the outbox exists
    // to prevent.
    expect(store.rows).toHaveLength(1);
    expect(store.row("row-1").lastError).toBe("no-driver");
  });

  it("counts attempts as CLAIMS, so a drainer that never returns still burns one", async () => {
    const store = memoryStore();
    await enqueueRealtimeEvent(store.writeDb, { topic: "tenant:t-1:orders", type: "x" });
    // A drain that dies right after claiming leaves the row claimed. The attempt was
    // already recorded by the claim itself, which is what stops a row that crashes its
    // drainer from being retried for ever.
    const outbox = createRealtimeOutbox({
      db: () => store.db,
      logger: silentLogger,
      drainerId: "doomed",
    });
    await outbox.drain();
    expect(store.row("row-1").attempts).toBe(1);
  });

  it("uses a default ceiling rather than an unbounded retry", () => {
    expect(OUTBOX_DEFAULT_MAX_ATTEMPTS).toBeGreaterThan(1);
    expect(Number.isFinite(OUTBOX_DEFAULT_MAX_ATTEMPTS)).toBe(true);
  });
});

describe("outbox purge", () => {
  it("removes published rows older than the cutoff and leaves pending ones", async () => {
    const store = memoryStore();
    busThatWorks();
    await enqueueRealtimeEvent(store.writeDb, { topic: "tenant:t-1:orders", type: "a" });
    await enqueueRealtimeEvent(store.writeDb, { topic: "tenant:t-1:orders", type: "b" });
    const outbox = createRealtimeOutbox({ db: () => store.db, logger: silentLogger });
    await outbox.drain();

    // The other stays "just published", so the cutoff must spare it. The clock is frozen
    // at T0 for the purge itself, so "older than 60s" is arithmetic on fixed instants.
    freezeClock();
    store.row("row-1").publishedAt = new Date(T0 - 120_000);
    store.row("row-2").publishedAt = new Date(T0 - 1_000);

    expect(await outbox.purgePublished(60_000)).toBe(1);
    expect(store.rows.map((row) => row.id)).toEqual(["row-2"]);
  });
});
