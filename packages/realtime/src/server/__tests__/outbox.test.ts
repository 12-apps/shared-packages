import { afterEach, describe, expect, it, vi } from "vitest";

import { configureRealtime, resetRealtimeRuntime } from "../../core/runtime";
import { createInlineRealtimeDriver } from "../../drivers/inline";
import {
  createRealtimeOutbox,
  enqueueRealtimeEvent,
  OUTBOX_DEFAULT_MAX_ATTEMPTS,
  type OutboxDrainResult,
  type RealtimeOutbox,
  type RealtimeOutboxDrainDb,
  type RealtimeOutboxRow,
  type RealtimeOutboxWriteDb,
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
          // The refund shape: a GLOBAL fault gives the claim's attempt back.
          if ((data as { attempts?: { decrement: 1 } }).attempts) row.attempts -= 1;
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

/**
 * The exact drain loop `ADOPTING.md` prescribes — `while (pass.more) pass = await drain()` —
 * plus how many ticks it took.
 *
 * A named helper with a container rather than two `let`s in a test body: the flakiness gate
 * reads a reassigned binding as mutable shared state, and the tick COUNT is the assertion
 * that matters (a global fault used to keep `more` true until every row had hit
 * `maxAttempts`).
 */
async function drainToCompletion(
  outbox: RealtimeOutbox,
  limit = 50,
): Promise<{ ticks: number; last: OutboxDrainResult }> {
  const run = { ticks: 1, last: await outbox.drain() };
  while (run.last.more && run.ticks < limit) {
    run.last = await outbox.drain();
    run.ticks += 1;
  }
  return run;
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

/**
 * Install a bus that is THERE and refuses — the `error` reason.
 *
 * Distinct from "no driver configured" in the one way that now matters: a driver whose
 * publish throws is a bus that is unwell, so the attempt stands. A process with no driver
 * at all never claims a row in the first place.
 */
function busThatRefuses(): void {
  const driver = createInlineRealtimeDriver({ logger: silentLogger });
  driver.publish = () => Promise.reject(new Error("redis is down"));
  configureRealtime({ driver, logger: silentLogger });
}

/**
 * Install a bus that DISAPPEARS after `afterPublishes` successful publishes.
 *
 * The only way `no-driver` is reachable inside a pass now that `drainOnce` checks first:
 * a concurrent `stop()` between the check and a publish. Deterministic here rather than
 * raced — `publishRealtimeEvent` re-reads the runtime per call, so the row after the reset
 * gets `no-driver` while the ones before it succeeded.
 */
function busThatVanishes(afterPublishes: number): { published: string[] } {
  const driver = createInlineRealtimeDriver({ logger: silentLogger });
  const published: string[] = [];
  driver.publish = async (_topic, event) => {
    published.push(event.id);
    if (published.length >= afterPublishes) resetRealtimeRuntime();
    await Promise.resolve();
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
  it("publishes pending rows in created_at order and marks them", async () => {
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
    // A driver that is THERE and throws: `publishRealtimeEvent` reports `error` and never
    // throws onward. The attempt stands — that is what bounds a row that keeps failing.
    busThatRefuses();
    await enqueueRealtimeEvent(store.writeDb, { topic: "tenant:t-1:orders", type: "x" });
    const outbox = createRealtimeOutbox({ db: () => store.db, logger: silentLogger });

    expect(await outbox.drain()).toMatchObject({ published: 0, failed: 1 });
    const row = store.row("row-1");
    expect(row.publishedAt).toBeNull();
    expect(row.lastError).toBe("error");
    // Released, so the next pass retries immediately; the attempt is already spent.
    expect(row.claimedAt).toBeNull();
    expect(row.attempts).toBe(1);
  });

  it("stops picking a POISON row up once it has burned its attempts", async () => {
    const store = memoryStore();
    busThatWorks();
    // A malformed topic is the genuinely per-row fault: `publishRealtimeEvent` answers
    // `invalid-topic` and will answer it again for ever. Reachable only from outside
    // `enqueueRealtimeEvent`, which validates inside the caller's transaction — a legacy
    // row, or hand-written SQL. Written straight into the store for that reason.
    store.rows.push({
      id: "poison",
      topic: "tenant: t-1:orders",
      type: "x",
      data: {},
      attempts: 0,
      createdAt: 0,
      publishedAt: null,
      claimedAt: null,
      claimedBy: null,
      lastError: null,
    });
    const outbox = createRealtimeOutbox({
      db: () => store.db,
      logger: silentLogger,
      maxAttempts: 3,
    });
    for (let pass = 0; pass < 3; pass += 1) await outbox.drain();
    expect(store.row("poison").attempts).toBe(3);

    // A fourth pass must find nothing — silent infinite retry would grind the drain on a
    // poison row forever. The exclusion is in the candidate READ (`attempts < maxAttempts`),
    // i.e. in SQL, which is what keeps it from wedging the drain.
    expect(await outbox.drain()).toMatchObject({ published: 0, failed: 0, contended: 0 });
    // And the row STAYS, with its reason: silent deletion is the loss the outbox exists
    // to prevent.
    expect(store.rows).toHaveLength(1);
    expect(store.row("poison").lastError).toBe("invalid-topic");
  });

  it("keeps draining PAST a poison row — one bad row blocks nobody", async () => {
    const store = memoryStore();
    const bus = busThatWorks();
    store.rows.push({
      id: "poison",
      topic: "tenant: t-1:orders",
      type: "x",
      data: {},
      attempts: 0,
      createdAt: 0,
      publishedAt: null,
      claimedAt: null,
      claimedBy: null,
      lastError: null,
    });
    // Behind it, and created later, so the poison row is claimed FIRST.
    await enqueueRealtimeEvent(store.writeDb, { topic: "tenant:t-1:orders", type: "good" });

    // The head-of-line property, in the same pass: `invalid-topic` is a property of that
    // row alone, so the pass carries on rather than ending on the first failure.
    expect(await outbox().drain()).toMatchObject({ published: 1, failed: 1, aborted: false });
    expect(bus.published.map((entry) => entry.id)).toEqual(["row-1"]);

    function outbox() {
      return createRealtimeOutbox({ db: () => store.db, logger: silentLogger });
    }
  });

  it("counts attempts as CLAIMS, so a drainer that never returns still burns one", async () => {
    const store = memoryStore();
    busThatRefuses();
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

/**
 * The per-row budget is not charged for a deployment-wide fault.
 *
 * The failure being defended against: `REDIS_URL` unset is a DOCUMENTED, supported
 * degradation (clients fall back to polling), and the drain loop `ADOPTING.md` prescribes
 * is `while (pass.more) pass = await drain()`. Charging `no-driver` per row made that loop
 * burn a whole backlog to `maxAttempts` inside one job tick, after which the candidate read
 * excludes every one of those rows FOR EVER — exactly-once persistence preserved, and then
 * the publish abandoned by a counter meant for poison rows.
 */
describe("outbox drain — a GLOBAL fault must not spend a per-ROW budget", () => {
  it("claims NOTHING when this process has no bus at all", async () => {
    const store = memoryStore();
    for (let index = 0; index < 5; index += 1) {
      await enqueueRealtimeEvent(store.writeDb, { topic: "tenant:t-1:orders", type: "x" });
    }
    const outbox = createRealtimeOutbox({ db: () => store.db, logger: silentLogger });

    expect(await outbox.drain()).toEqual({
      published: 0,
      failed: 0,
      contended: 0,
      // `more: false` is the load-bearing half: it is what ends the prescribed loop.
      more: false,
      aborted: true,
    });
    // Untouched — not claimed, not charged, not released. "There is no bus to drain to"
    // is a property of the PASS.
    expect(store.rows.every((row) => row.attempts === 0 && row.claimedAt === null)).toBe(true);
  });

  it("does not hot-loop a backlog to the ceiling, however often it is drained", async () => {
    const store = memoryStore();
    for (let index = 0; index < 4; index += 1) {
      await enqueueRealtimeEvent(store.writeDb, { topic: "tenant:t-1:orders", type: "x" });
    }
    const outbox = createRealtimeOutbox({
      db: () => store.db,
      logger: silentLogger,
      batchSize: 2,
      maxAttempts: 3,
    });
    // The prescribed drain loop, run to completion. Before the fix this terminated only
    // because every row had reached `maxAttempts`.
    const offline = await drainToCompletion(outbox);
    expect(offline.ticks).toBe(1);
    expect(store.rows.every((row) => row.attempts === 0)).toBe(true);

    // And the backlog is still publishable the moment a bus arrives — which is the
    // property the burn destroyed.
    const bus = busThatWorks();
    expect((await drainToCompletion(outbox)).last.aborted).toBe(false);
    expect(bus.published).toHaveLength(4);
    expect(store.rows.every((row) => row.publishedAt !== null)).toBe(true);
  });

  it("REFUNDS the attempt when the bus vanishes mid-pass, and stops the pass", async () => {
    const store = memoryStore();
    for (let index = 0; index < 4; index += 1) {
      await enqueueRealtimeEvent(store.writeDb, { topic: "tenant:t-1:orders", type: "x" });
    }
    // A concurrent `stop()`: the driver is there when the pass starts and gone by row two.
    const bus = busThatVanishes(1);
    const outbox = createRealtimeOutbox({ db: () => store.db, logger: silentLogger });

    expect(await outbox.drain()).toMatchObject({ published: 1, failed: 1, aborted: true });
    expect(bus.published).toEqual(["row-1"]);
    // Row two was claimed against a bus that had already gone, so its attempt is given
    // back: the row did nothing wrong.
    expect(store.row("row-2")).toMatchObject({
      attempts: 0,
      claimedAt: null,
      lastError: "no-driver",
      publishedAt: null,
    });
    // And rows three and four were never claimed at all — the pass stopped.
    expect(store.row("row-3").attempts).toBe(0);
    expect(store.row("row-4").attempts).toBe(0);
  });

  it("stops the pass on a bus that is unwell, rather than spending every row on it", async () => {
    const store = memoryStore();
    busThatRefuses();
    for (let index = 0; index < 4; index += 1) {
      await enqueueRealtimeEvent(store.writeDb, { topic: "tenant:t-1:orders", type: "x" });
    }
    const outbox = createRealtimeOutbox({ db: () => store.db, logger: silentLogger });

    // `error` came out of the shared driver, so it is read as the bus rather than the row:
    // the attempt stands (a row that keeps failing must still be bounded) and the other
    // three keep their full budget for the pass after the outage.
    expect(await outbox.drain()).toMatchObject({ published: 0, failed: 1, aborted: true });
    expect(store.rows.map((row) => row.attempts)).toEqual([1, 0, 0, 0]);
  });
});

/**
 * The write seam refuses the BASE client at compile time.
 *
 * "Exactly-once PERSISTENCE" is stated as a structural property, and it only holds if the
 * row is written on the transaction that causes it. `ADOPTING.md` rule 4 says so and a
 * rule cannot be type-checked — this is the one place the compiler can hold it.
 */
describe("enqueueRealtimeEvent — the transaction client, structurally", () => {
  /** The BASE Prisma client's distinguishing feature: it can open a transaction. */
  interface BaseClientLike {
    $transaction<T>(run: (tx: unknown) => Promise<T>): Promise<T>;
    realtimeOutboxEvent: {
      create(args: { data: { topic: string; type: string; data: unknown } }): Promise<unknown>;
    };
  }
  /** A `Prisma.TransactionClient` has no `$transaction` — that is what makes it one. */
  interface TxClientLike {
    realtimeOutboxEvent: {
      create(args: { data: { topic: string; type: string; data: unknown } }): Promise<unknown>;
    };
  }
  type Fits<T> = T extends RealtimeOutboxWriteDb ? true : false;

  it("accepts a transaction client and REJECTS the base client", async () => {
    // Type-level, and it fails `check-types` rather than a run: if the guard regressed,
    // `Fits<BaseClientLike>` would be `true` and this annotation would not compile.
    const txFits: Fits<TxClientLike> = true;
    const baseFits: Fits<BaseClientLike> = false;
    expect([txFits, baseFits]).toEqual([true, false]);

    const store = memoryStore();
    const baseLike = { ...store.writeDb, $transaction: () => Promise.resolve(undefined) };
    // @ts-expect-error — `$transaction?: never` is what turns `enqueueRealtimeEvent(prisma,
    // …)` — the non-atomic pair the outbox exists to eliminate — into a compile error.
    await enqueueRealtimeEvent(baseLike, { topic: "tenant:t-1:orders", type: "x" });
    // It still works at RUNTIME, which is the point: the guarantee is the compiler's, and
    // nothing here can tell whether a caller was inside a transaction.
    expect(store.rows).toHaveLength(1);
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
