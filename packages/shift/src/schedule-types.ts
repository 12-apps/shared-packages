import type {
  ShiftSlotSeries,
  ShiftSlotSeriesPatch,
  ShiftSlotSeriesService,
  ScheduleChange,
} from './schedule-series-types';
import type { LocalDate } from './schedule-time';
import type { Shift } from './types';
import type { ShiftKindTuple } from './vocabulary';

/**
 * A PLANNED work period: who should work, of which kind, from when to when.
 *
 * Kept apart from {@link Shift} on purpose. A shift is a fact that happened —
 * opened, closed, immutable once ended — and its rules make a planned one
 * impossible to express as an unopened shift: a start more than a couple of
 * minutes ahead is refused, and one open shift per worker per tenant is a
 * unique index. A slot is a plan: it is edited IN PLACE (`editSlot`), so it
 * keeps its id and its history stays together, and cancelled with a reason.
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
  /**
   * The series the slot belongs to: a {@link ShiftSlotSeries} rule, or — for a
   * slot written before rules existed — the id a weekly repeat shared. Null for
   * a single slot, including one handed to another person out of a series.
   */
  seriesId: string | null;
  /**
   * The series a slot was handed OUT of (its person changed): kept for the
   * history, for the rule's "this day exists" check and for `rejoinSeries`.
   */
  originSeriesId: string | null;
  /** The rule's day this row was built for; kept when the row is moved. Null when no rule built it. */
  seriesDate: LocalDate | null;
  /** True once its hours or its date were edited on their own: a later rule change leaves it. */
  detached: boolean;
  /**
   * The break, as minutes from the slot's START and its length — offsets, so it
   * survives a slot that crosses midnight or a daylight-saving change. Both
   * null or both set, and strictly inside the slot.
   */
  breakOffsetMinutes: number | null;
  breakMinutes: number | null;
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
  /** The break, as offsets from the start — both or neither. */
  breakOffsetMinutes?: number | null;
  breakMinutes?: number | null;
  /** Admit a slot already under way (its start past, its end ahead). */
  allowRunning?: boolean;
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

export type ShiftScheduleAuditAction =
  | 'shift.schedule'
  | 'shift.schedule.cancel'
  | 'shift.schedule.edit'
  | 'shift.schedule.series'
  | 'shift.schedule.promote'
  | 'shift.schedule.demote'
  | 'shift.schedule.restore';

/** The fields of a slot an edit, a hand-over or an undo may change in place. */
export type ShiftSlotPatch = Partial<
  Pick<
    ShiftSlot,
    | 'startsAt'
    | 'endsAt'
    | 'userId'
    | 'seriesId'
    | 'originSeriesId'
    | 'detached'
    | 'breakOffsetMinutes'
    | 'breakMinutes'
  >
>;

export interface ShiftScheduleAuditInput {
  clientId: string;
  actorUserId: string | null;
  action: ShiftScheduleAuditAction;
  resourceType: 'shift_slot' | 'shift_slot_series';
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
  /** Live slots of the series starting at or after `from` — by `seriesId` alone. */
  listSeriesFrom(clientId: string, seriesId: string, from: Date): Promise<ShiftSlot[]>;
  /**
   * EVERY row of a series, canceled included, whose `seriesId` OR
   * `originSeriesId` is `seriesId`, starting in `[from, to)` — what "the rule
   * already has this day" is read from, and what an undo of the rule cancels.
   */
  listSeriesRows(clientId: string, seriesId: string, from: Date, to: Date): Promise<ShiftSlot[]>;
  /** Change one slot in place; returns it as stored. */
  updateSlot(clientId: string, slotId: string, patch: ShiftSlotPatch): Promise<ShiftSlot>;
  /** Clear the cancel of each canceled slot named; returns those actually restored. */
  restoreSlots(clientId: string, slotIds: readonly string[]): Promise<ShiftSlot[]>;
  getSeries(clientId: string, seriesId: string): Promise<ShiftSlotSeries | null>;
  createSeries(series: ShiftSlotSeries): Promise<void>;
  updateSeries(clientId: string, seriesId: string, patch: ShiftSlotSeriesPatch): Promise<ShiftSlotSeries>;
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
  /**
   * Every rule, in every tenant, that may still have days to build: no end,
   * or an end on or after `onOrAfter`. Read outside a transaction by the
   * daily extension, which then locks each person in turn.
   */
  listOpenSeries(onOrAfter: LocalDate): Promise<ShiftSlotSeries[]>;
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
  /** How many weeks ahead a series rule keeps its days built (default 12). */
  horizonWeeks?: number;
}

/** What `cancelSlot` returns: the canceled slots, as before, carrying the change that undoes it. */
export type CancelSlotResult = ShiftSlot[] & { change: ScheduleChange };

export interface ShiftScheduleService<Kind extends string = string> extends ShiftSlotSeriesService<Kind> {
  scheduleSlot(input: ScheduleSlotInput<Kind>): Promise<ShiftSlot[]>;
  /** `following` on a rule's row also ends the rule the day before; `restoreSlot` reopens it. */
  cancelSlot(input: CancelSlotInput): Promise<CancelSlotResult>;
  listSlots(input: ListSlotsInput): Promise<ShiftSlot[]>;
  nextSlots(input: NextSlotsInput): Promise<ShiftSlot[]>;
  slotStanding(input: SlotStandingInput): ShiftSlotStandingResult;
}
