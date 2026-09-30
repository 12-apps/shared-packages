import type { JobStallConfig, JobStallPolicy } from "./types";

/**
 * The stall settings a host may configure: how long a worker's lock
 * on a running job lasts, how often the stalled checker looks, and how many
 * re-runs a stalled job gets before it is failed.
 *
 * Lives in `core`, beside `retention`, for the same reason: the root entry
 * point re-exports the error, and nothing here may pull `bullmq` into a bundle
 * that only enqueues. It is arithmetic on three numbers.
 */

/**
 * BullMQ's own defaults, spelled out. The driver passes them explicitly
 * rather than leaving them implicit, so the numbers a stall is measured
 * against are readable in this package instead of inside BullMQ's worker
 * constructor, and a BullMQ upgrade that changed them could not move them
 * silently.
 */
export const DEFAULT_STALL_POLICY: JobStallPolicy = {
  lockDurationMs: 30_000,
  stalledIntervalMs: 30_000,
  maxStalledCount: 1,
};

/** Raised for a stall setting BullMQ would reject, or one that cannot work. */
export class InvalidJobStallError extends Error {
  constructor(field: string, value: unknown, rule: string) {
    super(`stall.${field} must be ${rule}, got ${JSON.stringify(value)}.`);
    this.name = "InvalidJobStallError";
  }
}

function assertPolicyFields(where: string, policy: Partial<JobStallPolicy>): void {
  for (const field of ["lockDurationMs", "stalledIntervalMs"] as const) {
    const value = policy[field];
    if (value === undefined) continue;
    // A zero or NaN lock is renewed never and expires at once: every job
    // would be reported stalled and re-run while it is still running.
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
      throw new InvalidJobStallError(`${where}${field}`, value, "a positive integer (ms)");
    }
  }
  const count = policy.maxStalledCount;
  if (count === undefined) return;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
    throw new InvalidJobStallError(`${where}maxStalledCount`, count, "a non-negative integer");
  }
}

/**
 * Refuse a stall config that cannot work. `undefined` means "the defaults";
 * only the values a host actually spells out are checked.
 */
export function assertValidStall(stall: JobStallConfig | undefined): void {
  if (stall === undefined) return;
  if (typeof stall !== "object" || stall === null) {
    throw new InvalidJobStallError("<root>", stall, "an object");
  }
  assertPolicyFields("", stall);
  for (const [queue, policy] of Object.entries(stall.queues ?? {})) {
    if (typeof policy !== "object" || policy === null) {
      throw new InvalidJobStallError(`queues.${queue}`, policy, "an object");
    }
    assertPolicyFields(`queues.${queue}.`, policy);
  }
}

function definedFields(policy: Partial<JobStallPolicy> | undefined): Partial<JobStallPolicy> {
  const out: Partial<JobStallPolicy> = {};
  if (!policy) return out;
  if (policy.lockDurationMs !== undefined) out.lockDurationMs = policy.lockDurationMs;
  if (policy.stalledIntervalMs !== undefined) out.stalledIntervalMs = policy.stalledIntervalMs;
  if (policy.maxStalledCount !== undefined) out.maxStalledCount = policy.maxStalledCount;
  return out;
}

/**
 * The policy one queue's worker runs with: the package defaults, then the
 * host's values for every queue, then the host's values for THIS queue.
 */
export function resolveStallPolicy(
  queue: string,
  stall: JobStallConfig | undefined,
): JobStallPolicy {
  return {
    ...DEFAULT_STALL_POLICY,
    ...definedFields(stall),
    ...definedFields(stall?.queues?.[queue]),
  };
}
