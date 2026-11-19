/**
 * Deleting one's own account — the package's public surface (`createApiAuth`'s
 * `accountDeletion`). A host passes configuration only: who is calling, its
 * blockers, what the person gives up, how to erase its own data, how to mail
 * and how to audit. Everything else — the grace window, the revocation, the
 * routes and their wire, the reminders, the job — is the package's.
 */

/** Something the person must settle before the deletion may be scheduled. */
export interface DeletionBlocker {
  /** The host's own kind ("order", "soleOwner"…), for the screen's copy. */
  readonly kind: string;
  /** What the screen names it by: the store, the pedido. */
  readonly label: string;
  /** The screen that settles it. */
  readonly href: string;
}

/** Something given up with the account (money a store holds): shown, never a blocker. */
export interface DeletionForfeit {
  readonly kind: string;
  readonly label: string;
  /** Already worded by the host ("R$ 18,50", "2 vales"). */
  readonly amount: string;
  readonly href: string;
}

/** Who is asking, as the host resolved them. */
export interface DeletionCaller {
  readonly userId: string;
  readonly email: string;
  /** An operator acting as the person: refused, never the person's act. */
  readonly impersonated?: boolean;
  /** The `at` sign-in claim: when this session's sign-in happened (ms, as a string). */
  readonly signedInAt?: string | null;
}

export type DeletionAuditAct = "scheduled" | "cancelled" | "purged";

export type DeletionMailKind = "scheduled" | "week-before" | "day-before" | "cancelled";

export interface DeletionMail {
  readonly kind: DeletionMailKind;
  readonly to: string;
  readonly userId: string;
  readonly purgeAt: Date;
}

export interface AccountDeletionConfig {
  /** Days between scheduling and the purge (Future Pay: 15). */
  readonly graceDays: number;
  /** Resolve the caller of a route, or `null` when signed out. */
  readonly resolveCaller: (request: Request) => Promise<DeletionCaller | null>;
  /** What blocks this person's deletion right now. */
  readonly blockers?: (userId: string, now: Date) => Promise<readonly DeletionBlocker[]>;
  /** What this person gives up with the account. */
  readonly forfeits?: (userId: string, now: Date) => Promise<readonly DeletionForfeit[]>;
  /** Whether the person has a password (else they confirm with a fresh Google sign-in). */
  readonly hasPassword: (userId: string) => Promise<boolean>;
  /** Check the password; the host's sign-in check, rate limit included. */
  readonly checkPassword: (email: string, password: string) => Promise<"ok" | "wrong" | "rate-limited">;
  /** At scheduling, after the epoch moved: revoke what the host issued itself (app links, tokens). */
  readonly onScheduled?: (userId: string, email: string, now: Date) => Promise<void>;
  /** The purge: erase and anonymise every row of the host's that holds the person. */
  readonly erase: (userId: string, email: string, now: Date) => Promise<void>;
  /** The person's current e-mail, for the job's reminders and the purge (the request carries it otherwise). */
  readonly emailOf: (userId: string) => Promise<string | null>;
  /** Send one of the four mails; the words are `accountDeletionMail(kind, …)`. */
  readonly mail: (message: DeletionMail) => Promise<void>;
  /** Record who did what and when, through the host's audit writer. */
  readonly audit: (act: DeletionAuditAct, userId: string, at: Date) => Promise<void>;
  /** The database client, structurally (`authAccountState`). */
  readonly getDb: () => Promise<AccountStateDb> | AccountStateDb;
  /** How recent a Google sign-in must be to stand in for the password (ms, default 10 min). */
  readonly freshSignInMs?: number;
}

/** What the screen shows: the wire of `GET`. */
export interface DeletionReport {
  readonly state: "active" | "pending";
  readonly purgeAt: string | null;
  readonly graceDays: number;
  readonly blockers: readonly DeletionBlocker[];
  readonly forfeits: readonly DeletionForfeit[];
  readonly confirm: "password" | "google";
  readonly freshSignIn: boolean;
  readonly canSchedule: boolean;
}

/** The row, as the package reads and writes it. */
export interface AccountStateRow {
  readonly userId: string;
  readonly sessionEpoch: number;
  readonly requestedAt: Date | null;
  readonly purgeAt: Date | null;
  readonly remindedWeekAt: Date | null;
  readonly remindedDayAt: Date | null;
  readonly deletedAt: Date | null;
}

/** The slice of a Prisma client the package needs (the synced `AuthAccountState`). */
export interface AccountStateDb {
  authAccountState: {
    findUnique(args: { where: { userId: string } }): Promise<AccountStateRow | null>;
    findMany(args: { where: Record<string, unknown>; orderBy?: Record<string, "asc" | "desc">; take?: number }): Promise<AccountStateRow[]>;
    upsert(args: {
      where: { userId: string };
      create: Record<string, unknown> & { userId: string };
      update: Record<string, unknown>;
    }): Promise<AccountStateRow>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
}
