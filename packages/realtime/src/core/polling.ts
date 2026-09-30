import type { RealtimeStatus } from "../react/types";

/**
 * The two polling seams every consumer keys off, in the one place both halves
 * of the client can reach.
 *
 * They live in `core` rather than beside the React hook that first exported
 * them because the RULE they encode — keep your poll; realtime only relaxes it
 * — is the contract, not a React detail. A node consumer (`../node`) has the
 * same obligation and must not have to choose between importing React and
 * re-deriving a one-line decision the package already argues.
 */

/**
 * The query-client seam: pass the result straight to `refetchInterval`.
 *
 * Polling PAUSES only while the stream is live (events arrive pushed and each
 * one should invalidate the matching query); any other state keeps today's
 * polling exactly as it is — that is the no-regression contract.
 *
 * Only correct where a missed event cannot MISLEAD. Prefer
 * {@link reconcileRefetchInterval} otherwise.
 */
export function fallbackRefetchInterval(status: RealtimeStatus, pollMs: number): number | false {
  return status === "connected" ? false : pollMs;
}

/**
 * The OTHER query-client seam, and the default choice (FUT-440): a poll that
 * keeps RECONCILING while the stream is live instead of pausing outright.
 *
 * {@link fallbackRefetchInterval} suits a surface that can prove it heard
 * everything. A board cannot: delivery is best-effort and there is no replay,
 * so a screen that stops polling the moment it stops hearing has no route back
 * to the truth until something else happens to move. Hence a SLOW poll while
 * connected — `reconcileMs` is the ceiling on how long one dropped hint may
 * leave a screen wrong — and the surface's existing fast poll (`fallbackMs`) on
 * every other status, which is the no-regression contract unchanged.
 *
 * Never `false`: the whole point is that the poll never stops.
 */
export function reconcileRefetchInterval(
  status: RealtimeStatus,
  fallbackMs: number,
  reconcileMs: number,
): number {
  return status === "connected" ? reconcileMs : fallbackMs;
}
