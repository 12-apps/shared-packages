/**
 * The lifecycle's config and its answers: closing a tenant, reopening it, the
 * sweep that reminds and purges, and the hooks through which the host does
 * whatever its own domain needs on each step.
 *
 * OPT-IN, like the tree and slug resolution: `createApiTenant({ lifecycle })`
 * (or `createTenantLifecycle`). A host that wires it MUST return `name` from
 * its tenant port's `bySlug` and `byId` (ADOPTING.md, "Lifecycle").
 */
import type { TenantRecord, TenantTreeNode } from '../port';

/** Who closes: a member of the tenant (from `active` only, name typed), or the platform (any `closableFrom`, no name). */
export type TenantCloseEntry = 'member' | 'platform';

/** One kind of blocker the host names, and the path (under the tenant) that resolves it. */
export interface TenantBlockerKind {
  kind: string;
  path: string;
}

/** What the host's blocker read answers: how many of a kind still block the close. */
export interface TenantBlockerCount {
  kind: string;
  count: number;
  /** Whatever the host wants the blocker sentence to read (an amount, a date). Passed through. */
  detail?: Readonly<Record<string, string | number>>;
}

/** A blocker as the package answers it: the count with its resolve path. */
export interface TenantBlocker extends TenantBlockerCount {
  path: string;
}

/** One `tenant_closings` row, as the package reads it. */
export interface TenantClosingRow {
  tenantId: string;
  requestedAt: Date;
  requestedById: string | null;
  reason: string;
  priorStatus: string | null;
  purgeAt: Date;
  remindedWeekAt: Date | null;
  remindedDayAt: Date | null;
  purgedAt: Date | null;
  afterCloseDoneAt: Date | null;
  afterCloseFailedAt: Date | null;
}

/** What a close writes into a fresh row. */
export type TenantClosingCreate = Pick<
  TenantClosingRow,
  'tenantId' | 'requestedAt' | 'requestedById' | 'reason' | 'priorStatus' | 'purgeAt'
>;

/** The stamps the package writes, each only while still null. */
export type TenantClosingStamp = 'remindedWeekAt' | 'remindedDayAt' | 'purgedAt' | 'afterCloseDoneAt' | 'afterCloseFailedAt';

/**
 * The slice of the synced Prisma model (`tenantClosing`) the package uses, on
 * the host's client or transaction. A host passes its delegate, or an adapter
 * with these five members.
 */
export interface TenantClosingTable {
  findUnique(args: { where: { tenantId: string } }): Promise<TenantClosingRow | null>;
  /**
   * A page of the rows not purged yet, oldest purge first, after the keyset
   * `after` (the last row of the previous page) when given.
   */
  findMany(args: {
    where: {
      purgedAt: null;
      OR?: [{ purgeAt: { gt: Date } }, { purgeAt: Date; tenantId: { gt: string } }];
    };
    orderBy: [{ purgeAt: 'asc' }, { tenantId: 'asc' }];
    take: number;
  }): Promise<TenantClosingRow[]>;
  create(args: { data: TenantClosingCreate }): Promise<unknown>;
  /** A reopen deletes by tenant; the sweep deletes a stale row only while it is the one it read (`requestedAt`, not purged). */
  deleteMany(args: { where: { tenantId: string; requestedAt?: Date; purgedAt?: null } }): Promise<{ count: number }>;
  updateMany(args: {
    where: { tenantId: string } & Partial<Record<TenantClosingStamp, null>>;
    data: Partial<Record<TenantClosingStamp, Date>>;
  }): Promise<{ count: number }>;
}

/** A stamp the package wrote, handed to the mirror so an old table moves with it. */
export type TenantClosingEvent =
  | { kind: 'reminded'; which: 'week' | 'day'; at: Date }
  | { kind: 'afterClose'; ok: boolean; at: Date }
  | { kind: 'purged'; at: Date };

/**
 * OPT-IN expand-and-contract: a host moving an older closing table onto
 * `tenant_closings` mirrors every package write into it, IN THE SAME
 * TRANSACTION as the package's own write, until its contract release drops it.
 */
export interface TenantClosingMirror<Tx> {
  /** A close replaced the tenant's row (`row` is what was written). */
  replaced(tx: Tx, row: TenantClosingCreate): Promise<void>;
  /** A stamp landed; write it where still null, as the package did. */
  event(tx: Tx, tenantId: string, event: TenantClosingEvent): Promise<void>;
  /**
   * A reopen, or the sweep's stale-row drop, deleted the tenant's row.
   * `requestedAt` is the deleted row's own: delete the older table's row only
   * while it is that same close (a re-close the older release wrote since
   * stays). Absent when the package read no row (a reopen of a close only the
   * older table holds): delete by tenant.
   */
  deleted(tx: Tx, tenantId: string, requestedAt?: Date): Promise<void>;
}

/** The facts of an audited act. The host writes its own `after` shape from them. */
export type TenantAuditEvent =
  | { act: 'closeScheduled'; tenantId: string; by: TenantCloseEntry; reason: string; purgeAt: Date; priorStatus: string }
  | { act: 'closeReopened'; tenantId: string; by: TenantCloseEntry; purgeAt: Date | null; restored: string }
  | { act: 'afterCloseFailed'; tenantId: string; error: string };

/** What every notice the lifecycle raises carries. */
export interface TenantNoticePayload {
  tenantId: string;
  name: string;
  slug: string;
  /** ISO instant the tenant's data is purged. */
  purgeAt: string;
  /** Who scheduled the close, on the scheduled notice; null on the others. */
  by: TenantCloseEntry | null;
  /** The close's reason, on a platform close's scheduled notice only (the owner reads why). */
  reason: string | null;
  /**
   * The status a reopen restored, on the reopened notice; absent or null on
   * the others. When it is not the active status (a tenant the platform
   * closed while suspended), the notice reads the lifecycle extension's
   * restored sentences, never "it is live again".
   */
  restored?: string | null;
}

/**
 * The sentences only a lifecycle host writes, on top of the base pack: the
 * platform close's notice (with its reason, and without one), and the reopen
 * notice of a tenant restored to a status other than active (it is not live
 * again: a suspended tenant stays suspended).
 */
export interface TenantLifecycleCopyPack {
  readonly noticePlatformScheduledTitle: (name: string) => string;
  readonly noticePlatformScheduledBody: (name: string, purgeDay: string, reason: string) => string;
  /** The platform close's body when the notice carries no reason. */
  readonly noticePlatformScheduledBodyNoReason: (name: string, purgeDay: string) => string;
  readonly noticeReopenedRestoredTitle: (name: string) => string;
  readonly noticeReopenedRestoredBody: (name: string) => string;
}

/** The keys of the lifecycle's copy extension, in a fixed order. */
export const TENANT_LIFECYCLE_COPY_KEYS = [
  'noticePlatformScheduledTitle',
  'noticePlatformScheduledBody',
  'noticePlatformScheduledBodyNoReason',
  'noticeReopenedRestoredTitle',
  'noticeReopenedRestoredBody',
] as const satisfies readonly (keyof TenantLifecycleCopyPack)[];

export interface TenantLifecycleConfig<S extends string = string, Tx = unknown> {
  /** Days a closing tenant may reopen before its purge. Integer > 0. */
  graceDays: number;
  /** Days before the purge each reminder goes out. Integers, 0 < day < week < graceDays. */
  reminderDays: { week: number; day: number };
  /** The reason's floor, in characters after trimming. Integer > 0. */
  minReasonLength: number;
  /** The locale the typed-name check folds case in (an Intl tag, `pt-BR`). */
  nameLocale: string;
  /** Closing rows a sweep reads per pass. Integer > 0. */
  sweepBatch: number;
  /** The platform close's sentences, per locale: every tag of `copy.locales`. */
  copy: { locales: Readonly<Record<string, TenantLifecycleCopyPack>> };
  /** The host's transactions, and the package's table on a transaction or on the client. */
  db: {
    transaction<T>(run: (tx: Tx) => Promise<T>): Promise<T>;
    table(tx?: Tx): TenantClosingTable | Promise<TenantClosingTable>;
  };
  /** The host's own blockers: their kinds, and one read that counts them (on `tx` inside the close). */
  blockers: {
    kinds: readonly TenantBlockerKind[];
    read(tenantId: string, at: { now: Date; tx?: Tx }): Promise<readonly TenantBlockerCount[]>;
  };
  /**
   * The blocker the package adds itself for open descendants (a tenant with
   * units not closing or closed cannot close). REQUIRED when the tenant was
   * built with a `tree`, refused without one; its kind is not among `blockers.kinds`.
   */
  openDescendants?: TenantBlockerKind;
  /** The host's dangerous-act check (a PIN, say). Throws to refuse; resolves to admit. */
  confirmDangerousAct(request: Request, at: { tenantId: string; by: TenantCloseEntry }): Promise<void>;
  /** After a close commits (a billing cancel, say). Throws = failed: stamped, audited, retried by the sweep. */
  afterClose(at: { tenant: TenantRecord<S>; node: TenantTreeNode | null; now: Date }): Promise<void>;
  /** Drop whatever the host caches about the tenant. */
  invalidate(tenantId: string): Promise<void>;
  /** Raise a notice; true when RECORDED (a reminder is stamped only then). */
  notify(typeId: string, payload: TenantNoticePayload): Promise<boolean>;
  /** The purge is due: run the host's. `skipped` stamps nothing; `purged` and `already` stamp `purgedAt`. */
  onPurgeDue(tenantId: string, at: { now: Date }): Promise<'purged' | 'already' | 'skipped'>;
  /** Write one audit line ON `tx`. `action` is `ids.audit[event.act]`. */
  audit(tx: Tx, action: string, event: TenantAuditEvent): Promise<void>;
  /** The current request's locale, for refusals (null: the default pack). */
  locale(): string | null;
  /** A hook failed after the act committed; the act stands. */
  onError(error: unknown, at: { act: string; tenantId: string }): void;
  /** The expand-and-contract mirror, when the host is moving an older table. */
  mirror?: TenantClosingMirror<Tx>;
}

/** A tenant's closing state, as an API answers it. */
export interface TenantClosingState<S extends string = string> {
  status: S;
  /** ISO, while closing or closed. */
  requestedAt: string | null;
  /** ISO, while closing or closed. */
  purgeAt: string | null;
}

export interface TenantSweepResult {
  reminded: { week: number; day: number };
  /** Tenants the host's purge ran for on this pass. */
  purged: number;
  /** After-close hooks retried and gone through on this pass. */
  afterCloseRetried: number;
}

export interface TenantLifecycle<S extends string = string> {
  /** Close the tenant: the dangerous act, its checks, one transaction, then the hooks. */
  close(input: {
    tenant: TenantRecord<S>;
    by: TenantCloseEntry;
    reason: string;
    /** The tenant's name as the member typed it; ignored for the platform. */
    typedName?: string;
    /** The member's user id; null for the platform (its audit line says who). */
    actorUserId: string | null;
    request: Request;
    now?: Date;
  }): Promise<TenantClosingState<S>>;
  /** Reopen a closing tenant, restoring the status its close started from. */
  reopen(input: { tenant: TenantRecord<S>; by: TenantCloseEntry }): Promise<TenantClosingState<S>>;
  /** The tenant's closing state: no read unless it is closing or closed. */
  state(tenant: { id: string; status: S }): Promise<TenantClosingState<S>>;
  /** What still blocks the close, each with its resolve path. */
  blockers(tenantId: string, now?: Date): Promise<TenantBlocker[]>;
  /** Remind, retry the after-close hook, and purge what is due, at `now`. */
  sweep(now: Date): Promise<TenantSweepResult>;
  /** The title and body of a lifecycle notice, in `locale`, its day formatted in `timeZone`. */
  noticeWords(
    typeId: string,
    payload: TenantNoticePayload,
    at: { locale: string | null; timeZone: string },
  ): { title: string; body: string };
}
