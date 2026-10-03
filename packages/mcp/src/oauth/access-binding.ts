import type { AccessTokenBinding } from "./access-token";
import type { RefreshTokenStore, StoredRefreshToken } from "./stores";

/** An ordinary 15-minute access token crosses zero or one refresh rotation.
 * Thirty-two allows aggressive clients without unbounded DB work. More than 32
 * rotations during one access-token lifetime refuses that old access token; the
 * client uses its newest token. A retry within the rotation grace adds no hop. */
const MAX_SUCCESSOR_HOPS = 32;

function sameIdentity(row: StoredRefreshToken, binding: AccessTokenBinding): boolean {
  return row.clientId === binding.clientId && row.userEmail === binding.email &&
    row.userSub === binding.subject;
}

/**
 * Follow only the exact issued refresh row's unique descendants to a live leaf.
 * Ordinary refresh leaves existing access valid, while disconnect/replay revokes
 * the live descendants immediately. An unrelated root created by reconnecting
 * can NEVER revive the old access token, including within the same second.
 *
 * Every hop is an indexed, at-most-two-row query. Missing successor support,
 * ambiguous branching, malformed linkage, cycles and the hard bound fail closed.
 * Store errors propagate to the verifier, which also fails closed. Do not cache
 * `true`: disconnect must take effect on the very next resource request.
 */
export async function isRefreshBindingActive(
  store: RefreshTokenStore,
  binding: AccessTokenBinding,
  nowMs = Date.now(),
): Promise<boolean> {
  const row = await store.findByHash(binding.refreshTokenHash);
  if (!row || row.tokenHash !== binding.refreshTokenHash) return false;
  return followBoundLineage(store, binding, row, nowMs);
}

async function directSuccessor(
  store: RefreshTokenStore,
  parentHash: string,
): Promise<StoredRefreshToken | null> {
  if (!store.findSuccessor) return null;
  const next = await store.findSuccessor(parentHash);
  return next?.rotatedFrom === parentHash ? next : null;
}

async function followBoundLineage(
  store: RefreshTokenStore,
  binding: AccessTokenBinding,
  first: StoredRefreshToken,
  nowMs: number,
): Promise<boolean> {
  let row: StoredRefreshToken | null = first;
  const seen = new Set<string>();
  for (let hops = 0; hops <= MAX_SUCCESSOR_HOPS; hops += 1) {
    if (!row || !sameIdentity(row, binding) || seen.has(row.tokenHash)) return false;
    seen.add(row.tokenHash);
    if (row.revokedAt === null) return row.expiresAt.getTime() > nowMs;
    if (hops === MAX_SUCCESSOR_HOPS) return false;
    row = await directSuccessor(store, row.tokenHash);
  }
  return false;
}
