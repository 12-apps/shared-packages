import { dueReminder, isFreshSignIn, purgeDateOf } from "./schedule-math";
import { standingOf, type SessionIdentity, type SessionStanding } from "./standing";
import type {
  AccountDeletionConfig,
  AccountStateRow,
  DeletionCaller,
  DeletionMailKind,
  DeletionReport,
} from "./types";

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

const DEFAULT_FRESH_MS = 10 * 60_000;
const PAGE = 50;
const MAX_PAGES = 20;
const PURGE_LEASE_MS = 30 * 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

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

const isUniqueViolation = (error: unknown): boolean => (error as { code?: string } | null)?.code === "P2002";

export function createAccountDeletionService(config: AccountDeletionConfig): AccountDeletionService {
  assertDeletionConfig(config);
  const table = async () => (await config.getDb()).authAccountState;
  const freshMs = config.freshSignInMs ?? DEFAULT_FRESH_MS;
  const freshProviders = new Set(config.freshSignInProviders ?? ["google"]);
  const report_ = (error: unknown, act: string, userId: string): void => {
    if (config.onError) config.onError(error, { act, userId });
    else console.error(`[account-deletion] ${act} failed for ${userId}`, error);
  };
  const read = async (userId: string): Promise<AccountStateRow | null> => (await table()).findUnique({ where: { userId } });

  /** Send what the row's outbox owes, and clear it only once the mail left. */
  const flush = async (userId: string, kind: string, purgeAt: Date): Promise<boolean> => {
    try {
      const to = await config.emailOf(userId);
      if (!to) throw new Error("no e-mail for the person yet");
      await config.mail({ kind: kind as DeletionMailKind, to, userId, purgeAt });
    } catch (error) {
      report_(error, `mail:${kind}`, userId);
      return false;
    }
    await (await table()).updateMany({ where: { userId, mailOwed: kind, mailPurgeAt: purgeAt }, data: { mailOwed: null, mailPurgeAt: null } });
    return true;
  };

  /** A host hook whose failure must not undo, or skip, what follows it. */
  const tryHook = async (act: string, userId: string, run: () => Promise<void>): Promise<void> => {
    try {
      await run();
    } catch (error) {
      report_(error, act, userId);
    }
  };

  const report = async (caller: DeletionCaller, now = new Date()): Promise<DeletionReport> => {
    const [row, blockers, forfeits, hasPassword] = await Promise.all([
      read(caller.userId),
      config.blockers?.(caller.userId, now) ?? Promise.resolve([]),
      config.forfeits?.(caller.userId, now) ?? Promise.resolve([]),
      config.hasPassword(caller.userId),
    ]);
    const pending = Boolean(row?.requestedAt && !row.deletedAt);
    return {
      state: pending ? "pending" : "active",
      purgeAt: pending && row?.purgeAt ? row.purgeAt.toISOString() : null,
      graceDays: config.graceDays,
      blockers,
      forfeits,
      confirm: hasPassword ? "password" : "google",
      freshSignIn: isFreshSignIn(caller.signedInAt, now.getTime(), freshMs),
      canSchedule: !pending && blockers.length === 0,
    };
  };

  const confirm = async (caller: DeletionCaller, shown: DeletionReport, password: string | null) => {
    if (shown.confirm === "google") return shown.freshSignIn ? null : ("sign-in-again" as const);
    if (!password) return "wrong-password" as const;
    const checked = await config.checkPassword(caller.email, password);
    if (checked === "rate-limited") return "rate-limited" as const;
    return checked === "ok" ? null : ("wrong-password" as const);
  };

  /** The one write that schedules: wins only from "nothing scheduled", so a double tap schedules once. */
  const claimSchedule = async (userId: string, now: Date, purgeAt: Date): Promise<boolean> => {
    const db = await table();
    const scheduled = {
      requestedAt: now,
      purgeAt,
      remindedWeekAt: null,
      remindedDayAt: null,
      purgeClaimedAt: null,
      mailOwed: "scheduled",
      mailPurgeAt: purgeAt,
    };
    const { count } = await db.updateMany({
      where: { userId, requestedAt: null, deletedAt: null },
      data: { ...scheduled, sessionEpoch: { increment: 1 } },
    });
    if (count === 1) return true;
    if (await db.findUnique({ where: { userId } })) return false;
    try {
      await db.create({ data: { userId, sessionEpoch: 1, ...scheduled } });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  };

  const schedule = async (caller: DeletionCaller, password: string | null, now = new Date()): Promise<ScheduleOutcome> => {
    if (caller.impersonated) return { ok: false, reason: "impersonating" };
    const shown = await report(caller, now);
    if (shown.state === "pending") return { ok: false, reason: "pending" };
    if (!shown.canSchedule) return { ok: false, reason: "blocked" };
    const refused = await confirm(caller, shown, password);
    if (refused) return { ok: false, reason: refused };
    if ((await read(caller.userId))?.deletedAt) return { ok: false, reason: "deleted" };
    const purgeAt = purgeDateOf(now, config.graceDays);
    if (!(await claimSchedule(caller.userId, now, purgeAt))) return { ok: false, reason: "pending" };
    // The act is done (the epoch moved): what follows is recorded or retried, never a reason to fail it.
    await tryHook("audit:scheduled", caller.userId, () => config.audit("scheduled", caller.userId, now));
    await flush(caller.userId, "scheduled", purgeAt);
    await tryHook("onScheduled", caller.userId, () => config.onScheduled?.(caller.userId, caller.email, now) ?? Promise.resolve());
    return { ok: true, purgeAt };
  };

  const cancel = async (caller: DeletionCaller, now = new Date()): Promise<CancelOutcome> => {
    if (caller.impersonated) return { ok: false, reason: "impersonating" };
    const row = await read(caller.userId);
    if (!row?.purgeAt) return { ok: false, reason: "not-scheduled" };
    // Moves the epoch too: a token minted during the window (somebody else's,
    // with the password) does not outlive the cancel. The person signs in again.
    const { count } = await (await table()).updateMany({
      where: { userId: caller.userId, requestedAt: { not: null }, deletedAt: null, purgeClaimedAt: null, purgeAt: { gt: now } },
      data: {
        requestedAt: null,
        purgeAt: null,
        remindedWeekAt: null,
        remindedDayAt: null,
        sessionEpoch: { increment: 1 },
        mailOwed: "cancelled",
        mailPurgeAt: row.purgeAt,
      },
    });
    if (count !== 1) return { ok: false, reason: "not-scheduled" };
    await tryHook("audit:cancelled", caller.userId, () => config.audit("cancelled", caller.userId, now));
    await flush(caller.userId, "cancelled", row.purgeAt);
    return { ok: true };
  };

  const remind = async (row: AccountStateRow, now: Date): Promise<boolean> => {
    const kind = dueReminder(row, now);
    if (!kind || !row.purgeAt || row.mailOwed) return false;
    const stamp = kind === "week-before" ? "remindedWeekAt" : "remindedDayAt";
    const { count } = await (await table()).updateMany({
      where: { userId: row.userId, [stamp]: null, mailOwed: null, deletedAt: null, requestedAt: row.requestedAt, purgeAt: row.purgeAt },
      data: { [stamp]: now, mailOwed: kind, mailPurgeAt: row.purgeAt },
    });
    if (count !== 1) return false;
    return flush(row.userId, kind, row.purgeAt);
  };

  const purge = async (row: AccountStateRow, now: Date): Promise<boolean> => {
    if (!row.requestedAt || !row.purgeAt || row.deletedAt || row.purgeAt.getTime() > now.getTime()) return false;
    const db = await table();
    const leaseExpired = new Date(now.getTime() - PURGE_LEASE_MS);
    // The lease: taken from nobody, or from a pass that died over 30 min ago.
    const claimed = await db.updateMany({
      where: {
        userId: row.userId,
        deletedAt: null,
        requestedAt: { not: null },
        purgeAt: { lte: now },
        OR: [{ purgeClaimedAt: null }, { purgeClaimedAt: { lte: leaseExpired } }],
      },
      data: { purgeClaimedAt: now },
    });
    if (claimed.count !== 1) return false;
    // `erase` must be idempotent: after a failure the lease expires and it runs again.
    await config.erase(row.userId, (await config.emailOf(row.userId)) ?? "", now);
    await config.audit("purged", row.userId, now);
    const done = await db.updateMany({ where: { userId: row.userId, purgeClaimedAt: now, deletedAt: null }, data: { deletedAt: now } });
    return done.count === 1;
  };

  const sweep = async (now = new Date()): Promise<SweepSummary> => {
    let mailed = 0;
    let purged = 0;
    let failed = 0;
    const weekAhead = new Date(now.getTime() + 7 * DAY_MS);
    const dayAhead = new Date(now.getTime() + DAY_MS);
    const leaseExpired = new Date(now.getTime() - PURGE_LEASE_MS);
    const seen = new Set<string>();
    for (let page = 0; page < MAX_PAGES; page += 1) {
      // Only rows that need something, so rows with nothing to do never starve the rest.
      const rows = (
        await (await table()).findMany({
          where: {
            deletedAt: null,
            OR: [
              { mailOwed: { not: null } },
              { requestedAt: { not: null }, purgeAt: { lte: now }, OR: [{ purgeClaimedAt: null }, { purgeClaimedAt: { lte: leaseExpired } }] },
              { requestedAt: { not: null }, purgeAt: { gt: now, lte: weekAhead }, remindedWeekAt: null },
              { requestedAt: { not: null }, purgeAt: { gt: now, lte: dayAhead }, remindedDayAt: null },
            ],
          },
          orderBy: { purgeAt: "asc" },
          take: PAGE,
        })
      ).filter((row) => !seen.has(row.userId));
      if (rows.length === 0) break;
      for (const row of rows) {
        seen.add(row.userId);
        try {
          if (row.mailOwed && row.mailPurgeAt) {
            if (await flush(row.userId, row.mailOwed, row.mailPurgeAt)) mailed += 1;
            else failed += 1;
          } else if (await purge(row, now)) purged += 1;
          else if (await remind(row, now)) mailed += 1;
        } catch (error) {
          failed += 1;
          report_(error, "sweep", row.userId);
        }
      }
    }
    return { mailed, purged, failed };
  };

  return {
    standing: async (userId, identity) => standingOf(identity, await read(userId)),
    signInClaims: async (userId, provider, now = new Date()) => {
      const row = await read(userId);
      return {
        sv: String(row?.sessionEpoch ?? 0),
        ...(provider && freshProviders.has(provider) ? { at: String(now.getTime()) } : {}),
      };
    },
    userIdByEmail: (email) => config.userIdByEmail(email),
    report,
    schedule,
    cancel,
    sweep,
  };
}
