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
  if (!row) return identity.bearer || Number(identity.sv ?? "0") === 0 ? { state: "ok" } : { state: "revoked" };
  if (row.deletedAt) return { state: "revoked" };
  if (!identity.bearer && Number(identity.sv ?? "0") !== row.sessionEpoch) return { state: "revoked" };
  if (row.requestedAt && row.purgeAt) return { state: "pending", purgeAt: row.purgeAt };
  return { state: "ok" };
}

/** The path prefix whose routes a pending session still reaches. */
export function isOpenWhilePending(pathname: string | null, mount: string): boolean {
  if (!pathname) return false;
  return pathname === mount || pathname.startsWith(`${mount}/`);
}
