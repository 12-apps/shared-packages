/**
 * Single-use guard for the stateless authorization codes (12-23, ported from
 * future-pay's `lib/mcp/oauth/token-replay.ts`).
 *
 * A code is a signed blob with a `jti`, so "already redeemed" has to be remembered
 * somewhere. The in-process option remembers it IN THIS PROCESS: a small map of
 * `jti → expiry`, self-pruning once the code that carried it would have expired
 * anyway, so the set never grows without bound.
 *
 * ⚠️ MULTI-INSTANCE LIMITATION (best-effort single-use): that map lives in ONE
 * process. On a horizontally-scaled deployment a code could be replayed against a
 * second instance that has not yet seen the `jti`, within the ≤60s code lifetime.
 * Single-use is therefore strictly guaranteed only on a SINGLE instance — which is
 * why choosing it is explicit and cannot happen by omission: `codeReplay` has no
 * default, so a host either names a shared store or types `'in-process'`. BEFORE
 * running this surface on more than one instance, pass a `codeReplay` store backed
 * by something shared and atomic — a short-TTL row with a unique constraint, or a
 * distributed cache with an atomic set-if-absent. The port exists precisely so
 * that is a config change rather than a patch to the grant handler.
 */

export interface CodeReplayStore {
  /**
   * Record a code's `jti` as consumed. `false` means it was ALREADY recorded (a
   * replay); `true` is the first redemption. Must be atomic to be a real guard.
   */
  consume(jti: string, nowMs: number): Promise<boolean> | boolean;
}

/** Retain slightly beyond the 60s code TTL to cover the verify clock tolerance. */
const RETENTION_MS = 90_000;

/**
 * The in-process store — correct on ONE instance, see the caveat above. Reached by
 * passing `codeReplay: 'in-process'`, which is a required acknowledgement rather
 * than a default: the config has no default for this field precisely because the
 * only possible one would fail open on a multi-pod deployment.
 */
export function inProcessCodeReplayStore(): CodeReplayStore {
  const usedJtis = new Map<string, number>();
  return {
    consume(jti: string, nowMs: number): boolean {
      for (const [seen, expiresAt] of usedJtis) {
        if (expiresAt <= nowMs) usedJtis.delete(seen);
      }
      if (usedJtis.has(jti)) return false;
      usedJtis.set(jti, nowMs + RETENTION_MS);
      return true;
    },
  };
}
