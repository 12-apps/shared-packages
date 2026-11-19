import type { AccountStateRow } from "./types";

/**
 * Whether a session token still speaks for its person. Sessions are JWTs
 * with no database adapter, so revocation is a counter: the token carries
 * the epoch it was signed in under (claim `sv`), and scheduling a deletion
 * moves the row's. A token whose epoch is stale, or whose account was purged,
 * is no session; while a deletion is pending, only the deletion's own routes
 * are open. A token signed in before the claim existed counts as epoch 0,
 * which an account keeps until its first scheduling.
 */
export type SessionStanding =
  | { readonly state: "ok" }
  | { readonly state: "revoked" }
  | { readonly state: "pending"; readonly purgeAt: Date };

export interface SessionIdentity {
  /** The `sv` claim, when the token carries one. */
  readonly sv?: string | null;
  /** A bearer (an assistant's token) carries no epoch. */
  readonly bearer?: boolean;
}

/** The sign-in claim the epoch rides in. */
export const SESSION_EPOCH_CLAIM = "sv";
/** The sign-in claim the sign-in time rides in (ms since the epoch). */
export const SIGNED_IN_AT_CLAIM = "at";

export function standingOf(identity: SessionIdentity, row: Pick<AccountStateRow, "sessionEpoch" | "purgeAt" | "requestedAt" | "deletedAt"> | null): SessionStanding {
  const epoch = Number(identity.sv ?? "0");
  if (!row) return identity.bearer || epoch === 0 ? OK : REVOKED;
  if (row.deletedAt || !epochMatches(identity, epoch, row.sessionEpoch)) return REVOKED;
  return row.requestedAt && row.purgeAt ? { state: "pending", purgeAt: row.purgeAt } : OK;
}

const OK: SessionStanding = { state: "ok" };
const REVOKED: SessionStanding = { state: "revoked" };

/** A bearer carries no epoch; a cookie session's must be the row's. */
function epochMatches(identity: SessionIdentity, epoch: number, current: number): boolean {
  return Boolean(identity.bearer) || epoch === current;
}

/** The path prefix whose routes a pending session still reaches. */
export function isOpenWhilePending(pathname: string | null, mount: string): boolean {
  if (!pathname) return false;
  return pathname === mount || pathname.startsWith(`${mount}/`);
}
