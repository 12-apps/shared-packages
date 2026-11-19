import { cancelDeletion, reportFor, scheduleDeletion } from "./acts";
import { createDeletionContext } from "./context";
import { sweepDeletions } from "./sweep";
import { standingOf, type SessionIdentity, type SessionStanding } from "./standing";
import type { AccountDeletionConfig, DeletionCaller, DeletionReport } from "./types";

/**
 * The deletion's whole lifecycle over the package's own `auth_account_states`
 * row: scheduling (which moves the session epoch, so every older token is
 * refused at once), cancelling within the grace window (which moves it again),
 * the reminders 7 and 1 days before, and the purge — each act audited through
 * the host's writer, each mail through the host's sender, the host's own data
 * erased by its `erase` callback.
 *
 * Every write carries the state it expects in its WHERE, so two taps, a tap
 * and a sweep, or two sweeps settle on one outcome.
 *
 * Mails go through a one-slot outbox on the row (`mailOwed`, with the purge
 * date it names): the act writes the slot in the same statement as its own
 * state, the send is tried at once, and the slot is cleared only after the
 * mail left — so a mail outage, or an e-mail the host cannot find yet, is
 * retried by the next sweep, never lost and never sent twice (a crash after
 * the send and before the clear can repeat it once). A reminder is claimed by
 * its stamp AND the purge date it was computed for, so a cancel and a fresh
 * scheduling never get a reminder naming the old date.
 *
 * The purge takes a lease (`purgeClaimedAt`), runs the host's idempotent
 * `erase`, writes the audit, and only then stamps `deletedAt`; a failure
 * leaves the lease to expire and the next pass after it runs the purge again.
 * Once a purge was claimed, the deletion cannot be cancelled.
 */


export type ScheduleOutcome =
  | { readonly ok: true; readonly purgeAt: Date }
  | { readonly ok: false; readonly reason: "impersonating" | "pending" | "blocked" | "wrong-password" | "rate-limited" | "sign-in-again" | "deleted" };

export type CancelOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: "impersonating" | "not-scheduled" };

export interface SweepSummary {
  readonly mailed: number;
  readonly purged: number;
  readonly failed: number;
}

export interface AccountDeletionService {
  /** The revocation check: one primary-key read, never cached, wherever the session user is resolved. */
  standing(userId: string, identity: SessionIdentity): Promise<SessionStanding>;
  /** The claims a sign-in stamps: `sv`, and `at` when the provider's sign-in can stand in for a password. */
  signInClaims(userId: string, provider: string | null, now?: Date): Promise<Record<string, string>>;
  /** The user id for an e-mail (the host's), for a token with no `uid`. */
  userIdByEmail(email: string): Promise<string | null>;
  report(caller: DeletionCaller, now?: Date): Promise<DeletionReport>;
  schedule(caller: DeletionCaller, password: string | null, now?: Date): Promise<ScheduleOutcome>;
  cancel(caller: DeletionCaller, now?: Date): Promise<CancelOutcome>;
  /** One pass of the job: owed mails, due reminders, due purges, paged until done. Safe to call directly. */
  sweep(now?: Date): Promise<SweepSummary>;
}

/** Refuse a configuration that would schedule nonsense (an `Invalid Date`, a purge at once). */
export function assertDeletionConfig(config: Pick<AccountDeletionConfig, "graceDays" | "timeZone">): void {
  if (!Number.isInteger(config.graceDays) || config.graceDays < 1) {
    throw new Error(`accountDeletion.graceDays must be a whole number of days, at least 1 (got ${String(config.graceDays)})`);
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: config.timeZone });
  } catch {
    throw new Error(`accountDeletion.timeZone is not an IANA zone: ${config.timeZone}`);
  }
}

export function createAccountDeletionService(config: AccountDeletionConfig): AccountDeletionService {
  assertDeletionConfig(config);
  const ctx = createDeletionContext(config);
  return {
    standing: async (userId, identity) => standingOf(identity, await ctx.read(userId)),
    signInClaims: async (userId, provider, now = new Date()) => {
      const row = await ctx.read(userId);
      return {
        sv: String(row?.sessionEpoch ?? 0),
        ...(provider && ctx.freshProviders.has(provider) ? { at: String(now.getTime()) } : {}),
      };
    },
    userIdByEmail: (email) => config.userIdByEmail(email),
    report: (caller: DeletionCaller, now = new Date()): Promise<DeletionReport> => reportFor(ctx, caller, now),
    schedule: (caller, password, now = new Date()) => scheduleDeletion(ctx, caller, password, now),
    cancel: (caller, now = new Date()) => cancelDeletion(ctx, caller, now),
    sweep: (now = new Date()) => sweepDeletions(ctx, now),
  };
}
