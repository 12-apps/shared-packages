import type { AuthRateLimiter } from "./email-credentials/types";

/**
 * A fixed-window rate limiter, in process memory.
 *
 * ## Why the package ships one
 *
 * `createEmailCredentials` takes an {@link AuthRateLimiter} port and shipped no
 * implementation, so every host wrote this same file — the same map, the same
 * sweep, the same four buckets — and any two would have disagreed about how
 * many sign-in attempts a person gets. Counting attempts in a window is not a
 * product decision; how many attempts is, which is why the numbers are config
 * and the mechanism is not.
 *
 * ## Per process, deliberately, and worth being honest about
 *
 * With several containers behind a proxy an attacker gets the budget once per
 * container. That is a real weakening and it is still worth having: the attack
 * it actually blunts is the naive one from a single client, and the alternative
 * — a Redis round trip on every sign-in attempt — would make a Redis URL a
 * requirement for signing in at all, which is a much worse failure mode than a
 * limit that is N times looser than it reads.
 *
 * A host that wants a shared counter implements the port against its own store;
 * that is the one-line swap this seam exists for.
 */

/** The bucket a key belongs to, which is the part before the first colon. */
const bucketOf = (key: string): string => key.split(":")[0] ?? "";

export interface InProcessRateLimiterConfig {
  /**
   * Attempts allowed per bucket, per window.
   *
   * Keys are the operation names the flow uses — `signin`, `signup`, `reset`,
   * `resend`. Anything absent falls to {@link defaultLimit}.
   */
  limits?: Record<string, number>;
  /** Attempts for a bucket with no entry in {@link limits}. Defaults to 5. */
  defaultLimit?: number;
  /** Window length in milliseconds. Defaults to five minutes. */
  windowMs?: number;
  /**
   * How many live windows to hold before sweeping expired ones.
   *
   * The map is keyed by address, so an attacker walking a dictionary would grow
   * it without bound. Sweeping on insert past a threshold keeps that bounded
   * without a timer the host has to own.
   */
  sweepAt?: number;
  /** Injectable clock, so a test does not have to wait five real minutes. */
  now?: () => number;
}

/**
 * The defaults, which encode the only opinion here worth having.
 *
 * Sign-in is the one an attacker hammers and the one a real person retypes a
 * few times; ten in five minutes is generous for the second and useless for the
 * first. The three that SEND MAIL are tighter, because the cost of getting them
 * wrong is landing in somebody's inbox repeatedly — and because a person who
 * legitimately needs a reset link needs one, not five.
 */
export const DEFAULT_RATE_LIMITS: Record<string, number> = {
  signin: 10,
  reset: 3,
  resend: 3,
  signup: 5,
};

interface Window {
  count: number;
  resetsAt: number;
}

export function createInProcessRateLimiter(
  config: InProcessRateLimiterConfig = {},
): AuthRateLimiter {
  const {
    limits = DEFAULT_RATE_LIMITS,
    defaultLimit = 5,
    windowMs = 5 * 60 * 1000,
    sweepAt = 10_000,
    now = Date.now,
  } = config;

  const windows = new Map<string, Window>();

  return {
    async check(key) {
      const at = now();
      const limit = limits[bucketOf(key)] ?? defaultLimit;
      const existing = windows.get(key);

      if (!existing || existing.resetsAt <= at) {
        windows.set(key, { count: 1, resetsAt: at + windowMs });
        if (windows.size > sweepAt) {
          for (const [candidate, window] of windows) {
            if (window.resetsAt <= at) windows.delete(candidate);
          }
        }
        return true;
      }

      if (existing.count >= limit) return false;
      existing.count += 1;
      return true;
    },
  };
}
