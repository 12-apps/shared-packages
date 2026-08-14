import { describe, expect, it, vi } from "vitest";

import { createSweepLease, type SweepLeaseDb } from "../sweep-lease";

/**
 * Sweep leases.
 *
 * The claim is a conditional UPDATE, so what is worth pinning here is the SHAPE
 * of the statements — that the free test and the holder match are in the
 * `where`, decided by the database, rather than in a read this code performs
 * first. A read-then-write would pass every behavioural test below and still be
 * wrong under two workers, which is the entire point of the guard.
 */

interface FakeLeaseStore {
  updateMany: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
}

/**
 * A fresh store per test — the flakiness lint forbids sharing one, and a lease
 * fake carrying state between cases would be the exact order-dependence that
 * rule exists to catch.
 */
function makeStore(overrides: Partial<FakeLeaseStore> = {}): {
  store: FakeLeaseStore;
  db: () => Promise<SweepLeaseDb>;
} {
  const store: FakeLeaseStore = {
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    create: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
  return {
    store,
    db: (): Promise<SweepLeaseDb> => Promise.resolve({ sweepLease: store }),
  };
}

describe("withSweepLease", () => {
  it("runs the work when the lease is free", async () => {
    const { db } = makeStore();
    const { withSweepLease } = createSweepLease({ db });
    const work = vi.fn().mockResolvedValue("done");

    const outcome = await withSweepLease("ledger.tick", 60_000, work);

    expect(outcome).toEqual({ ran: true, result: "done" });
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("decides freeness in the WHERE, not in a prior read", async () => {
    // The race is two workers issuing this UPDATE at once: exactly one sees a
    // row changed. Reading first and then writing would let both through.
    const { store, db } = makeStore();
    const { withSweepLease } = createSweepLease({ db });

    await withSweepLease("ledger.tick", 60_000, async () => "x");

    const claim = store.updateMany.mock.calls[0]?.[0];
    expect(claim.where.name).toBe("ledger.tick");
    // "Free" means nobody holds it, or the holder ran past their TTL.
    expect(claim.where.expiresAt).toHaveProperty("lte");
    expect(claim.data.expiresAt.getTime()).toBeGreaterThan(
      claim.where.expiresAt.lte.getTime(),
    );
  });

  it("does not run the work when another worker holds the lease", async () => {
    // No row updated (unexpired holder) and the insert collides on the primary
    // key — the two ways a claim is lost.
    const { store, db } = makeStore({
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" })),
    });
    const { withSweepLease } = createSweepLease({ db });
    const work = vi.fn();

    const outcome = await withSweepLease("ledger.tick", 60_000, work);

    expect(outcome).toEqual({ ran: false, result: null });
    expect(work).not.toHaveBeenCalled();
    // And nothing was released — releasing a lease we never took would hand the
    // sweep to a second worker, which is the bug this prevents.
    expect(store.updateMany).toHaveBeenCalledTimes(1);
  });

  it("creates the row the first time a sweep ever runs", async () => {
    const { store, db } = makeStore({
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    });
    const { withSweepLease } = createSweepLease({ db });
    const work = vi.fn().mockResolvedValue("first");

    const outcome = await withSweepLease("index.rebuild", 60_000, work);

    expect(outcome.ran).toBe(true);
    expect(store.create).toHaveBeenCalledTimes(1);
    expect(store.create.mock.calls[0]?.[0].data.name).toBe("index.rebuild");
  });

  it("releases the lease even when the work throws", async () => {
    // Otherwise one failed pass silently suspends the job for a whole TTL.
    const { store, db } = makeStore();
    const { withSweepLease } = createSweepLease({ db });

    await expect(
      withSweepLease("ledger.tick", 60_000, async () => {
        throw new Error("sweep blew up");
      }),
    ).rejects.toThrow("sweep blew up");

    const release = store.updateMany.mock.calls.at(-1)?.[0];
    expect(release.where.name).toBe("ledger.tick");
    expect(release.data.expiresAt).toBeInstanceOf(Date);
  });

  it("releases only its OWN lease", async () => {
    // If this pass overran its TTL and another worker took over, freeing that
    // worker's lease would put two of them on the same sweep.
    const { store, db } = makeStore();
    const { withSweepLease } = createSweepLease({ db });

    await withSweepLease("ledger.tick", 60_000, async () => "x");

    const claim = store.updateMany.mock.calls[0]?.[0];
    const release = store.updateMany.mock.calls.at(-1)?.[0];
    expect(release.where.holder).toBeDefined();
    expect(release.where.holder).toBe(claim.data.holder);
  });

  it("claims under the holder id the factory was given", async () => {
    // The harness (and any test simulating two workers) names its holders; the
    // claim must carry that identity or "release only its own" is untestable.
    const { store, db } = makeStore();
    const { withSweepLease, holder } = createSweepLease({ db, holder: "worker-a" });

    await withSweepLease("ledger.tick", 60_000, async () => "x");

    expect(holder).toBe("worker-a");
    expect(store.updateMany.mock.calls[0]?.[0].data.holder).toBe("worker-a");
  });

  it("surfaces an unreachable store instead of passing it off as contention", async () => {
    // The failure this helper must never have. "Another worker holds it" and
    // "the store is down" both end with no work done, so a blanket catch would
    // make an outage look like a healthy multi-worker deployment — every sweep
    // skipping indefinitely, no failed job, nothing to notice. Only a lost race
    // may be silent.
    const { db } = makeStore({
      updateMany: vi.fn().mockRejectedValue(new Error("connection refused")),
      create: vi.fn().mockRejectedValue(new Error("connection refused")),
    });
    const { withSweepLease } = createSweepLease({ db });
    const work = vi.fn();

    await expect(withSweepLease("ledger.tick", 60_000, work)).rejects.toThrow(
      "connection refused",
    );
    expect(work).not.toHaveBeenCalled();
  });

  it("surfaces a missing lease table rather than skipping forever", async () => {
    // The concrete way this bites: the migration has not been applied. Every
    // protected sweep would otherwise stop, silently, for as long as that lasts.
    const { db } = makeStore({
      updateMany: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("relation does not exist"), { code: "P2021" })),
    });
    const { withSweepLease } = createSweepLease({ db });

    await expect(withSweepLease("ledger.tick", 60_000, vi.fn())).rejects.toThrow(
      "relation does not exist",
    );
  });

  it("treats only a unique violation on insert as a lost race", async () => {
    // The one error that legitimately means "somebody else got there first".
    // Anything else from the insert is a real fault and must not be silent.
    const { db } = makeStore({
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockRejectedValue(Object.assign(new Error("bad column"), { code: "P2000" })),
    });
    const { withSweepLease } = createSweepLease({ db });

    await expect(withSweepLease("ledger.tick", 60_000, vi.fn())).rejects.toThrow("bad column");
  });
});
