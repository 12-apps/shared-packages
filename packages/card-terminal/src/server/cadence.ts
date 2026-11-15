/**
 * The single-flight queue the capture sweep runs on. A literal, not an import:
 * this package depends on nothing of the payments packages. It is the same
 * string `@12-apps/jobs` exports as `SWEEP_QUEUE`, so a host that already runs
 * its sweeps there adds this one with no new queue.
 */
export const SWEEP_QUEUE = 'sweeps';
