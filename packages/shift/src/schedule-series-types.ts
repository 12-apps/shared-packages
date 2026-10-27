import type { LocalDate } from './schedule-time';
import type { ShiftSlot, ShiftSlotCoverage } from './schedule-types';

/**
 * A repeating plan: the RULE a series of slots is built from, one row per
 * series. Its days are materialised as ordinary slots up to a rolling horizon
 * (`horizonWeeks` ahead), so a rule with no end never means unbounded rows.
 *
 * Exactly one repeat: `everyWeeks` (1 or 2, counted from the ISO week of
 * `startsOn`) on each of `weekdays`, or `monthlyNth` — the Nth of the ONE
 * weekday in `weekdays` in each month (a month with no 5th has no day).
 *
 * Hours are wall-clock minutes from local midnight in `timeZone`; an end at or
 * before the start is on the next day. A rule whose `endsOn` is before its
 * `startsOn` is closed and builds nothing — which is how an undo retires one,
 * so the table holds no `endsOn >= startsOn` CHECK on purpose.
 */
export interface ShiftSlotSeries {
  id: string;
  clientId: string;
  userId: string;
  kind: string;
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  weekdays: number[];
  everyWeeks: 1 | 2 | null;
  monthlyNth: number | null;
  startMinutes: number;
  endMinutes: number;
  breakOffsetMinutes: number | null;
  breakMinutes: number | null;
  timeZone: string;
  startsOn: LocalDate;
  /** The last day; null for no end. */
  endsOn: LocalDate | null;
  /** Days the rule left unbuilt because the person was taken: recorded so each is audited once. */
  skippedDates: LocalDate[];
  /** The rule an edit replaced, so a slot's history can follow the chain. */
  previousSeriesId: string | null;
  /** The day a `following` cancel ended the rule from, and the end it had before — what a restore reopens. */
  canceledFrom: LocalDate | null;
  endsOnBeforeCancel: LocalDate | null;
  resourceType: string | null;
  resourceId: string | null;
  coverage: ShiftSlotCoverage[] | null;
  createdByUserId: string;
  createdAt: Date;
}

export type ShiftSlotSeriesPatch = Partial<
  Pick<ShiftSlotSeries, 'endsOn' | 'skippedDates' | 'canceledFrom' | 'endsOnBeforeCancel'>
>;

/** A slot's fields before an in-place edit — JSON-safe, so a host can hold it for an undo. */
export interface ShiftSlotPrior {
  startsAt: string;
  endsAt: string;
  userId: string;
  seriesId: string | null;
  originSeriesId: string | null;
  detached: boolean;
  breakOffsetMinutes: number | null;
  breakMinutes: number | null;
}

/**
 * What one schedule write did, enough for `revertScheduleChange` to undo it.
 * Plain strings and numbers only: a host may send it to a client and back.
 */
export interface ScheduleChange {
  createdSlotIds: string[];
  canceledSlotIds: string[];
  createdSeriesIds: string[];
  closedSeries: { id: string; priorEndsOn: LocalDate | null }[];
  editedSlots: { id: string; prior: ShiftSlotPrior }[];
  /**
   * How each row and rule named above looked right after the write. The undo
   * refuses (`SCHEDULE_CHANGED`) when one of them has moved since.
   */
  stamps: { slots: Record<string, string>; series: Record<string, string> };
}

/** The repeat of a rule: exactly one of the two. */
export interface ShiftSeriesRepeat {
  everyWeeks?: 1 | 2 | null;
  monthlyNth?: number | null;
}

export interface ScheduleSeriesInput<Kind extends string = string> extends ShiftSeriesRepeat {
  clientId: string;
  userId: string;
  kind: Kind;
  weekdays: readonly number[];
  startMinutes: number;
  endMinutes: number;
  breakOffsetMinutes?: number | null;
  breakMinutes?: number | null;
  timeZone: string;
  startsOn: LocalDate;
  endsOn?: LocalDate | null;
  resource?: { type: string; id: string } | null;
  coverage?: readonly ShiftSlotCoverage[] | null;
  actorUserId: string;
}

/** What a write that touches rules returns: the slots it left live, the rule it made, and its undo. */
export interface ScheduleWriteResult {
  slots: ShiftSlot[];
  series: ShiftSlotSeries | null;
  change: ScheduleChange;
}

export interface ExtendSeriesResult {
  /** The rows each tenant got, for the host's own reconcile. */
  built: { clientId: string; seriesId: string; slotIds: string[] }[];
  skipped: { clientId: string; seriesId: string; date: LocalDate }[];
  failures: { clientId: string; seriesId: string; message: string }[];
}

export interface MaterialiseSeriesInput {
  clientId: string;
  seriesId: string;
  /** Build the rule's days up to and including this one, past the horizon too. */
  until: LocalDate;
  /** Return the days it would build, writing nothing. */
  preview?: boolean;
}

export interface MaterialiseSeriesResult {
  dates: LocalDate[];
  slotIds: string[];
  skippedDates: LocalDate[];
}

export interface EditSlotInput {
  clientId: string;
  slotId: string;
  actorUserId: string;
  patch: {
    startMinutes?: number;
    endMinutes?: number;
    date?: LocalDate;
    userId?: string;
    breakOffsetMinutes?: number | null;
    breakMinutes?: number | null;
  };
  /** The zone hours and dates are read in. Defaults to the slot's rule's; required for any other slot moved. */
  timeZone?: string;
  /** Put a handed-out row back into the series it came from — only to that rule's own person. */
  rejoinSeries?: boolean;
  allowRunning?: boolean;
}

export interface EditSeriesInput {
  clientId: string;
  seriesId: string;
  actorUserId: string;
  /** The first day the new rule applies to. */
  from: LocalDate;
  patch: ShiftSeriesRepeat & {
    startMinutes?: number;
    endMinutes?: number;
    weekdays?: readonly number[];
    endsOn?: LocalDate | null;
    userId?: string;
    breakOffsetMinutes?: number | null;
    breakMinutes?: number | null;
  };
  /** Required only for a series written before rules, which carries no zone. */
  timeZone?: string;
}

export interface PromoteToSeriesInput {
  clientId: string;
  slotIds: readonly string[];
  actorUserId: string;
  rule: ShiftSeriesRepeat & { timeZone: string; endsOn?: LocalDate | null };
}

export interface DemoteToSlotInput {
  clientId: string;
  seriesId: string;
  keepDate: LocalDate;
  actorUserId: string;
  /** Required only for a series written before rules. */
  timeZone?: string;
}

export interface RestoreSlotInput {
  clientId: string;
  slotIds: readonly string[];
  actorUserId: string;
  /** The cancel reasons the host lets an undo clear; the package names none. */
  restorableReasons: readonly string[];
}

export interface RevertScheduleChangeInput {
  clientId: string;
  change: ScheduleChange;
  actorUserId: string;
}

export interface ShiftSlotSeriesService<Kind extends string = string> {
  scheduleSeries(input: ScheduleSeriesInput<Kind>): Promise<ScheduleWriteResult>;
  /** Build the next days of every open rule in every tenant, up to the horizon. Idempotent. */
  extendSeries(now?: Date): Promise<ExtendSeriesResult>;
  materialiseSeries(input: MaterialiseSeriesInput): Promise<MaterialiseSeriesResult>;
  editSlot(input: EditSlotInput): Promise<ScheduleWriteResult>;
  editSeries(input: EditSeriesInput): Promise<ScheduleWriteResult>;
  promoteToSeries(input: PromoteToSeriesInput): Promise<ScheduleWriteResult>;
  demoteToSlot(input: DemoteToSlotInput): Promise<ScheduleWriteResult>;
  restoreSlot(input: RestoreSlotInput): Promise<ScheduleWriteResult>;
  revertScheduleChange(input: RevertScheduleChangeInput): Promise<ScheduleWriteResult>;
}
