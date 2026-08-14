/**
 * Well-known queue names — this package's own vocabulary, exported so a host
 * composes them rather than re-typing string literals that have to match.
 *
 * `DEFAULT_QUEUE` is where a definition lands when it names no queue. One
 * queue for everything is the right shape at most scales: one worker, one pair
 * of connections, one dashboard.
 *
 * `SWEEP_QUEUE` is the other one, and it exists for a correctness property
 * rather than for tuning. The scheduled sweeps run SINGLE-FLIGHT — their own
 * queue at concurrency 1 — so a tick that outlives its interval makes the next
 * one WAIT rather than run alongside it.
 *
 * Every sweep walks a work list and decides "has this already been handled?"
 * by reading a row it is about to write; two ticks interleaved on the same row
 * both read the old answer. Durable markers in the host's tables make that
 * safe rather than corrupting — the worst case is duplicate work, and the
 * ledger is protected by the database — but single-flight is what keeps it
 * from happening at all, and it costs nothing: sweeps are periodic and none of
 * them is latency-sensitive.
 *
 * Keeping them off the default queue matters too, in the other direction: a
 * sweep grinding through a long work list must not occupy the workers that
 * handle a user-facing job.
 *
 * Declare a sweep with `queue: SWEEP_QUEUE, concurrency: 1` and take a
 * {@link ../lease/sweep-lease!createSweepLease | sweep lease} inside the
 * handler when more than one worker can run — the queue serializes ticks
 * within one worker, the lease serializes them across the deployment.
 */

/** The queue a definition lands on when it names none. */
export const DEFAULT_QUEUE = "default";

/** The single-flight queue the scheduled sweeps share. */
export const SWEEP_QUEUE = "sweeps";
