/**
 * Well-known queue names.
 *
 * The scheduled sweeps run SINGLE-FLIGHT: their own queue at concurrency 1,
 * so a tick that outlives its interval makes the next one WAIT rather than run
 * alongside it.
 *
 * That is a correctness property, not tuning. Every sweep walks a work list
 * and decides "has this already been handled?" by reading a row it is about
 * to write; two ticks interleaved on the same row both read the old answer.
 * Durable markers in the host's tables make that safe rather than corrupting
 * — the worst case is duplicate work, and the ledger is protected by the
 * database — but single-flight is what keeps it from happening at all, and it
 * costs nothing: sweeps run hourly and daily, and none of them is
 * latency-sensitive.
 *
 * Keeping them off the DEFAULT queue matters too, in the other direction: a
 * sweep grinding through a few hundred tenants must not occupy the workers
 * that handle a user-facing job.
 *
 * Declare a sweep with `queue: SWEEP_QUEUE, concurrency: 1` and take a
 * {@link ../lease/sweep-lease!createSweepLease | sweep lease} inside the
 * handler when more than one worker can run — the queue serializes ticks
 * within one worker, the lease serializes them across the deployment.
 */
export const SWEEP_QUEUE = "sweeps";
