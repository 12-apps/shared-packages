import { randomUUID } from "node:crypto";

/**
 * Sweep leases — what makes a second queue worker safe.
 *
 * Within ONE worker the scheduled sweeps are already single-flight: they share
 * the sweep queue at concurrency 1, so a tick that outlives its interval
 * queues the next one instead of racing it. Across two workers that guarantee
 * evaporates — both read the same work list and do the same work twice.
 *
 * Correctness should already survive that (every sweep is expected to be
 * idempotent by durable markers in the host's own tables). What does NOT
 * survive is effort and noise — the work doubles, and a user can be told
 * twice. The lease closes that: one named, time-bounded claim per sweep,
 * stored in the host's database, so the guarantee becomes one pass per tick
 * across the whole deployment rather than within a worker.
 *
 * ## Why a lease row and not `pg_advisory_lock`
 *
 * The obvious answer is a Postgres advisory lock, and it is the wrong one here.
 *
 *   - A SESSION-level lock (`pg_try_advisory_lock`) must be released on the
 *     same connection that took it. ORMs pool connections and promise nothing
 *     about which one a later query gets, so the release can land elsewhere,
 *     silently fail, and strand the lock — and a stranded lock means that
 *     sweep never runs again until the connection recycles. A guard whose
 *     failure mode is "the recovery mechanism stops recovering" is worse than
 *     no guard, because nothing reports it.
 *   - The TRANSACTION-scoped variant (`pg_advisory_xact_lock`) releases
 *     correctly, but only holds while the transaction is open. Holding one for
 *     the length of a sweep means holding it across the sweep's outbound HTTP
 *     calls, which is exactly what long transactions must not do.
 *
 * A lease row has neither problem: it is ordinary typed ORM access, it does
 * not care which connection serves it, and `expiresAt` makes a crashed holder
 * recoverable with no operator action. The claim is a conditional UPDATE, so
 * the DATABASE picks the winner between racing workers — never application
 * code reading and then writing.
 *
 * The table itself ships with this package: `prisma/jobs.prisma` (the
 * `SweepLease` model) plus its migration, synced into the host's schema by the
 * host's sync script. See ADOPTING.md.
 */

/**
 * The Prisma-shaped delegate for the `sweep_leases` table. A generated Prisma
 * client's `prisma.sweepLease` satisfies it structurally; so does any adapter
 * that speaks the same two calls — with one contract to honour: `create` MUST
 * reject a duplicate primary key with an error carrying `code: "P2002"`,
 * because that is the one error the claim reads as "lost the race" rather
 * than "the store is broken".
 */
export interface SweepLeaseDelegate {
  updateMany(args: {
    where: { name: string; expiresAt?: { lte: Date }; holder?: string };
    data: { holder?: string; acquiredAt?: Date; expiresAt: Date };
  }): Promise<{ count: number }>;
  create(args: {
    data: { name: string; holder: string; acquiredAt: Date; expiresAt: Date };
  }): Promise<unknown>;
}

/** The slice of the host's DB client this module reaches. */
export interface SweepLeaseDb {
  sweepLease: SweepLeaseDelegate;
}

/**
 * How the database is obtained — lazily, per claim, so the host's client can
 * be created after this module is imported (the same seam report-builder's
 * `db` takes).
 */
export type SweepLeaseDbProvider = () => SweepLeaseDb | Promise<SweepLeaseDb>;

/** What {@link WithSweepLease} reports back about a pass. */
export interface SweepLeaseOutcome<T> {
  /** False when another worker held the lease and this pass did nothing. */
  ran: boolean;
  /** The callback's value, or null when it did not run. */
  result: T | null;
}

/** Run `work` only if this worker can claim `name`'s lease. */
export type WithSweepLease = <T>(
  name: string,
  ttlMs: number,
  work: () => Promise<T>,
) => Promise<SweepLeaseOutcome<T>>;

export interface SweepLeaseConfig {
  /** Where the `sweep_leases` table lives. */
  db: SweepLeaseDbProvider;
  /**
   * Identifies THIS process's claims. Defaults to `pid:uuid`, minted once per
   * factory call — per-process in practice, because a host creates one lease
   * per process. Release matches on it, so a lease may only ever be released
   * by the run that took it: without that, a worker whose lease expired
   * mid-sweep would come back and free the lease a DIFFERENT worker had since
   * taken — handing two workers the same sweep, which is the thing being
   * prevented. Override it only in tests that simulate two workers.
   */
  holder?: string;
}

export interface SweepLease {
  /** The holder id this instance claims and releases under. */
  readonly holder: string;
  withSweepLease: WithSweepLease;
}

/** Prisma's unique-constraint violation: here, a lost race for the lease. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Take the lease if it is free, atomically.
 *
 * Two statements, in this order for a reason. The UPDATE handles the common
 * case — the row exists and has expired — and its `where` is the whole race:
 * two workers issuing it concurrently, exactly one reports a row changed.
 * The INSERT covers only the first time a sweep ever runs, and a unique
 * violation there means another worker created it first, which is a lost
 * race, not an error.
 */
async function claim(
  config: SweepLeaseConfig,
  holder: string,
  name: string,
  ttlMs: number,
): Promise<boolean> {
  const prisma = await config.db();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  // Deliberately NOT wrapped in a try: a failing UPDATE means the store is
  // unreachable or the table is missing, and that has to surface. Only the
  // INSERT below has an expected failure.
  const { count } = await prisma.sweepLease.updateMany({
    // `lte: now` is the free test: either nobody holds it, or whoever did
    // has run past their TTL and is presumed dead.
    where: { name, expiresAt: { lte: now } },
    data: { holder, acquiredAt: now, expiresAt },
  });
  if (count > 0) return true;
  // No row updated means either the row does not exist yet, or somebody
  // holds an unexpired lease. Only the first is worth an insert; the second
  // makes it fail on the primary key, which is the ONE error that means
  // "not acquired".
  try {
    await prisma.sweepLease.create({
      data: { name, holder, acquiredAt: now, expiresAt },
    });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    // Anything else — no table, no connection, a column that does not match
    // the schema — is not contention and must not be dressed up as it.
    // Rethrow so the job fails and the sweep's silence has a cause attached.
    throw error;
  }
}

/** Give the lease back — but only if we are still the holder. */
async function release(
  config: SweepLeaseConfig,
  holder: string,
  name: string,
): Promise<void> {
  try {
    const prisma = await config.db();
    await prisma.sweepLease.updateMany({
      // The holder match is load-bearing. If this pass overran its TTL and
      // another worker has since taken the lease, this must not free theirs.
      where: { name, holder },
      data: { expiresAt: new Date() },
    });
  } catch {
    // Release stays tolerant, unlike the claim, for two reasons. The TTL
    // frees the lease anyway — the same mechanism that covers a crashed
    // holder — so nothing is stuck. And this runs in a `finally`: a throw
    // here would REPLACE whatever the sweep itself threw, hiding the real
    // failure behind a lease error. A store that is genuinely down has
    // already been reported by the claim on the next tick, which is where
    // it belongs.
  }
}

/**
 * Build the lease helper over the host's database.
 *
 * `withSweepLease(name, ttlMs, work)` runs `work` only when this worker can
 * claim `name`'s lease. `ttlMs` must comfortably exceed how long the sweep
 * actually takes: it is the window in which a CRASHED holder blocks the next
 * run, and — more importantly — a TTL shorter than the sweep means the lease
 * expires while the work is still going and a second worker starts a
 * concurrent pass, which is precisely the situation this exists to prevent.
 * Err long; the cost of a long TTL is a delayed recovery after a crash, the
 * cost of a short one is the bug.
 *
 * Losing the claim is silent; anything else THROWS. That distinction is the
 * whole safety of this helper. "Another worker has it" and "the lease table
 * does not exist" are the same shape at the call site — both end with no work
 * done — but the first is the system working and the second means every
 * protected sweep has stopped, indefinitely, with no failed job to notice. A
 * blanket catch here would turn a missing migration or a database outage into
 * a deployment that looks healthy while doing nothing at all, which is a
 * strictly worse failure than the duplicate work this guard exists to prevent.
 *
 * So only a lost race is swallowed. A real store fault propagates, the job is
 * marked failed, and someone finds out.
 */
export function createSweepLease(config: SweepLeaseConfig): SweepLease {
  const holder = config.holder ?? `${process.pid}:${randomUUID()}`;

  const withSweepLease: WithSweepLease = async (name, ttlMs, work) => {
    const acquired = await claim(config, holder, name, ttlMs);
    if (!acquired) return { ran: false, result: null };
    try {
      return { ran: true, result: await work() };
    } finally {
      // Released whether the work threw or returned: a failed sweep must not
      // hold the lease for the rest of its TTL, or one bad pass silently
      // suspends the job for that long. The next tick retries, which is the
      // intended cadence.
      await release(config, holder, name);
    }
  };

  return { holder, withSweepLease };
}
