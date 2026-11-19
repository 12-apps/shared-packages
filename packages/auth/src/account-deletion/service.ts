import { dueReminder, isFreshSignIn, purgeDateOf, purgeDue } from "./schedule-math";
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
 * refused at once), cancelling within the grace window, the reminders 7 and 1
 * days before, and the purge — each act audited through the host's writer,
 * each mail through the host's sender, the host's own data erased by its
 * `erase` callback.
 *
 * Every write is predicated on the state it expects (`updateMany` with the
 * state in its WHERE), so two taps, a tap and a sweep, or two sweeps settle on
 * one outcome: a cancel that lands before the purge's claim wins, and a purge
 * that claimed the row is the only one to erase it.
 */

const DEFAULT_FRESH_MS = 10 * 60_000;
const STANDING_TTL_MS = 10_000;
const SWEEP_BATCH = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ScheduleOutcome =
  | { readonly ok: true; readonly purgeAt: Date }
  | { readonly ok: false; readonly reason: "impersonating" | "pending" | "blocked" | "wrong-password" | "rate-limited" | "sign-in-again" | "deleted" };

export type CancelOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: "impersonating" | "not-scheduled" };

export interface SweepSummary {
  readonly reminded: number;
  readonly purged: number;
  readonly failed: number;
}

export interface AccountDeletionService {
  /** The revocation check, one cached primary-key read: call it where the session user is resolved. */
  standing(userId: string, identity: SessionIdentity): Promise<SessionStanding>;
  /** The claims a sign-in stamps (`sv`, and `at`, when it happened). */
  signInClaims(userId: string, now?: Date): Promise<Record<string, string>>;
  report(caller: DeletionCaller, now?: Date): Promise<DeletionReport>;
  schedule(caller: DeletionCaller, password: string | null, now?: Date): Promise<ScheduleOutcome>;
  cancel(caller: DeletionCaller, now?: Date): Promise<CancelOutcome>;
  /** One pass of the job: due reminders, then due purges. Also safe to call directly. */
  sweep(now?: Date): Promise<SweepSummary>;
  /** Forget this process's copy of a person's row (after a write elsewhere). */
  forget(userId: string): void;
}

export function createAccountDeletionService(config: AccountDeletionConfig): AccountDeletionService {
  const cache = new Map<string, { row: AccountStateRow | null; at: number }>();
  const db = async () => (await config.getDb()).authAccountState;
  const freshMs = config.freshSignInMs ?? DEFAULT_FRESH_MS;

  const read = async (userId: string, cached: boolean): Promise<AccountStateRow | null> => {
    const kept = cached ? cache.get(userId) : undefined;
    if (kept && Date.now() - kept.at < STANDING_TTL_MS) return kept.row;
    const row = await (await db()).findUnique({ where: { userId } });
    if (cache.size > 5_000) cache.clear();
    cache.set(userId, { row, at: Date.now() });
    return row;
  };

  const send = async (kind: DeletionMailKind, userId: string, to: string, purgeAt: Date): Promise<void> => {
    // A mail is never the reason an act did not happen.
    await config.mail({ kind, userId, to, purgeAt }).catch(() => undefined);
  };

  const report = async (caller: DeletionCaller, now = new Date()): Promise<DeletionReport> => {
    const [row, blockers, forfeits, hasPassword] = await Promise.all([
      read(caller.userId, false),
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

  const schedule = async (caller: DeletionCaller, password: string | null, now = new Date()): Promise<ScheduleOutcome> => {
    if (caller.impersonated) return { ok: false, reason: "impersonating" };
    const shown = await report(caller, now);
    if (shown.state === "pending") return { ok: false, reason: "pending" };
    if (!shown.canSchedule) return { ok: false, reason: "blocked" };
    const refused = await confirm(caller, shown, password);
    if (refused) return { ok: false, reason: refused };
    const row = await read(caller.userId, false);
    if (row?.deletedAt) return { ok: false, reason: "deleted" };
    const purgeAt = purgeDateOf(now, config.graceDays);
    const scheduled = { requestedAt: now, purgeAt, remindedWeekAt: null, remindedDayAt: null };
    await (await db()).upsert({
      where: { userId: caller.userId },
      create: { userId: caller.userId, sessionEpoch: 1, ...scheduled },
      update: { sessionEpoch: { increment: 1 }, ...scheduled },
    });
    cache.delete(caller.userId);
    await config.onScheduled?.(caller.userId, caller.email, now);
    await config.audit("scheduled", caller.userId, now);
    await send("scheduled", caller.userId, caller.email, purgeAt);
    return { ok: true, purgeAt };
  };

  const cancel = async (caller: DeletionCaller, now = new Date()): Promise<CancelOutcome> => {
    if (caller.impersonated) return { ok: false, reason: "impersonating" };
    const row = await read(caller.userId, false);
    const { count } = await (await db()).updateMany({
      where: { userId: caller.userId, requestedAt: { not: null }, deletedAt: null },
      data: { requestedAt: null, purgeAt: null, remindedWeekAt: null, remindedDayAt: null },
    });
    cache.delete(caller.userId);
    if (count !== 1) return { ok: false, reason: "not-scheduled" };
    await config.audit("cancelled", caller.userId, now);
    if (row?.purgeAt) await send("cancelled", caller.userId, caller.email, row.purgeAt);
    return { ok: true };
  };

  const remind = async (row: AccountStateRow, email: (userId: string) => Promise<string | null>, now: Date): Promise<boolean> => {
    const kind = dueReminder(row, now);
    if (!kind || !row.purgeAt) return false;
    const stamp = kind === "week-before" ? "remindedWeekAt" : "remindedDayAt";
    const { count } = await (await db()).updateMany({ where: { userId: row.userId, [stamp]: null, deletedAt: null, requestedAt: { not: null } }, data: { [stamp]: now } });
    const to = count === 1 ? await email(row.userId) : null;
    if (to) await send(kind, row.userId, to, row.purgeAt);
    return count === 1;
  };

  const purge = async (row: AccountStateRow, email: (userId: string) => Promise<string | null>, now: Date): Promise<boolean> => {
    if (!purgeDue(row, now)) return false;
    const table = await db();
    // Claimed first: only the pass that stamped the row erases it.
    const { count } = await table.updateMany({
      where: { userId: row.userId, deletedAt: null, requestedAt: { not: null }, purgeAt: { lte: now } },
      data: { deletedAt: now },
    });
    if (count !== 1) return false;
    try {
      await config.erase(row.userId, (await email(row.userId)) ?? "", now);
    } catch (error) {
      await table.updateMany({ where: { userId: row.userId, deletedAt: now }, data: { deletedAt: null } });
      throw error;
    }
    cache.delete(row.userId);
    await config.audit("purged", row.userId, now);
    return true;
  };

  const sweep = async (now = new Date()): Promise<SweepSummary> => {
    const rows = await (await db()).findMany({
      where: { deletedAt: null, requestedAt: { not: null }, purgeAt: { lte: new Date(now.getTime() + 7 * DAY_MS) } },
      orderBy: { purgeAt: "asc" },
      take: SWEEP_BATCH,
    });
    let reminded = 0;
    let purged = 0;
    let failed = 0;
    const email = async (userId: string): Promise<string | null> => (await config.emailOf(userId)) ?? null;
    for (const row of rows) {
      try {
        if (await purge(row, email, now)) purged += 1;
        else if (await remind(row, email, now)) reminded += 1;
      } catch {
        failed += 1;
      }
    }
    return { reminded, purged, failed };
  };

  return {
    standing: async (userId, identity) => standingOf(identity, await read(userId, true)),
    signInClaims: async (userId, now = new Date()) => {
      const row = await read(userId, false);
      return { sv: String(row?.sessionEpoch ?? 0), at: String(now.getTime()) };
    },
    report,
    schedule,
    cancel,
    sweep,
    forget: (userId) => {
      cache.delete(userId);
    },
  };
}
