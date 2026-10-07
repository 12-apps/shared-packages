import type { Shift } from './types';
import type { ShiftKindTuple } from './vocabulary';

/**
 * A PLANNED work period: who should work, of which kind, from when to when.
 *
 * Kept apart from {@link Shift} on purpose. A shift is a fact that happened —
 * opened, closed, immutable once ended — and its rules make a planned one
 * impossible to express as an unopened shift: a start more than a couple of
 * minutes ahead is refused, and one open shift per worker per tenant is a
 * unique index. A slot is a plan, and plans are edited by cancelling them.
 *
 * Tenant, user, kind and resource are stored by value, exactly as on a shift:
 * the host owns what the values mean.
 */
export interface ShiftSlot {
  id: string;
  clientId: string;
  userId: string;
  kind: string;
  startsAt: Date;
  endsAt: Date;
  resourceType: string | null;
  resourceId: string | null;
  /** The host's own coverage, as `{ type, id }` pairs; null when none. */
  coverage: ShiftSlotCoverage[] | null;
  /** Shared by the slots one weekly repeat created; null for a single slot. */
  seriesId: string | null;
  createdByUserId: string;
  createdAt: Date;
  canceledAt: Date | null;
  canceledByUserId: string | null;
  cancelReason: string | null;
}

export interface ShiftSlotCoverage {
  type: string;
  id: string;
}

/** Where a slot stands at an instant — see `slotStanding`. */
export type ShiftSlotStanding = 'canceled' | 'over' | 'on_shift' | 'late' | 'due' | 'later';

export interface ShiftSlotStandingResult {
  standing: ShiftSlotStanding;
  /** Whole minutes past the start while `late`; 0 for every other standing. */
  lateMinutes: number;
}

export interface ScheduleSlotInput<Kind extends string = string> {
  clientId: string;
  userId: string;
  kind: Kind;
  startsAt: Date;
  endsAt: Date;
  resource?: { type: string; id: string } | null;
  coverage?: readonly ShiftSlotCoverage[] | null;
  /** How many FOLLOWING weeks to repeat the slot in; 0 or absent for one slot. */
  repeatWeeks?: number;
  /**
   * The IANA time zone the repeats keep their wall-clock time in — required
   * when `repeatWeeks > 0`, because "the same time next week" is a local-time
   * statement: across a daylight-saving change the UTC instant moves.
   */
  timeZone?: string;
  actorUserId: string;
}

export interface CancelSlotInput {
  clientId: string;
  slotId: string;
  actorUserId: string | null;
  reason?: string | null;
  /** `following` also cancels the later live slots of the same series. */
  scope?: 'one' | 'following';
}

export interface ListSlotsInput {
  clientId: string;
  from: Date;
  to: Date;
  userId?: string;
  /** Include canceled slots (with their cancel fields) — e.g. to say why a slot was freed. */
  includeCanceled?: boolean;
}

export interface NextSlotsInput {
  /** The tenants the host allows (where the person still works); non-empty. */
  clientIds: readonly string[];
  userId: string;
  limit: number;
}

export interface SlotStandingInput {
  slot: ShiftSlot;
  /**
   * The one open shift that COUNTS for this slot, as the host decides (for
   * example, of the slot's kind) — or null when none does.
   */
  openShift: Shift | null;
  now?: Date;
}

export interface ShiftScheduleAuditInput {
  clientId: string;
  actorUserId: string | null;
  action: 'shift.schedule' | 'shift.schedule.cancel';
  resourceType: 'shift_slot';
  resourceId: string;
  before: Record<string, string | null>;
  after: Record<string, string | null>;
}

/** The writes and locked reads one schedule transaction may make. */
export interface ShiftScheduleTransaction {
  /**
   * Serialize schedule writes for `(clientId, userId)` for the rest of this
   * transaction. Postgres hosts use `pg_advisory_xact_lock`; in-memory hosts
   * may no-op under single-threaded tests.
   */
  lockUserSchedule(clientId: string, userId: string): Promise<void>;
  /** Live slots of the user in the tenant overlapping `[from, to)`. */
  listLiveOverlapping(clientId: string, userId: string, from: Date, to: Date): Promise<ShiftSlot[]>;
  getSlot(clientId: string, slotId: string): Promise<ShiftSlot | null>;
  createSlots(slots: readonly ShiftSlot[]): Promise<void>;
  /** Cancel each live slot named; returns those actually canceled. */
  cancelSlots(input: {
    clientId: string;
    slotIds: readonly string[];
    canceledAt: Date;
    canceledByUserId: string | null;
    cancelReason: string | null;
  }): Promise<ShiftSlot[]>;
  /** Live slots of the series starting at or after `from`. */
  listSeriesFrom(clientId: string, seriesId: string, from: Date): Promise<ShiftSlot[]>;
  writeAudit(input: ShiftScheduleAuditInput): Promise<void>;
}

/**
 * What the schedule service needs from its host. Separate from `ShiftDb` so a
 * host that only works shifts implements nothing new.
 */
export interface ShiftScheduleDb {
  transaction<T>(work: (tx: ShiftScheduleTransaction) => Promise<T>): Promise<T>;
  listSlots(input: ListSlotsInput): Promise<ShiftSlot[]>;
  /** Live slots of the user ending after `after`, in the given tenants, by start, at most `limit`. */
  listUpcoming(input: {
    clientIds: readonly string[];
    userId: string;
    after: Date;
    limit: number;
  }): Promise<ShiftSlot[]>;
}

export interface ShiftScheduleServiceOptions<Kinds extends ShiftKindTuple = ShiftKindTuple> {
  /** The same vocabulary the host gives `createShiftService`. */
  kinds: Kinds;
  now?: () => Date;
  createId?: () => string;
  /** The most following weeks one call may repeat a slot in (default 12). */
  maxRepeatWeeks?: number;
  /** How long before its start a slot counts as due (default 15 minutes). */
  dueWindowMinutes?: number;
}

export interface ShiftScheduleService<Kind extends string = string> {
  scheduleSlot(input: ScheduleSlotInput<Kind>): Promise<ShiftSlot[]>;
  cancelSlot(input: CancelSlotInput): Promise<ShiftSlot[]>;
  listSlots(input: ListSlotsInput): Promise<ShiftSlot[]>;
  nextSlots(input: NextSlotsInput): Promise<ShiftSlot[]>;
  slotStanding(input: SlotStandingInput): ShiftSlotStandingResult;
}
