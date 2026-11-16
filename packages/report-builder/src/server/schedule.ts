import { z } from 'zod';

import {
  SCHEDULE_CADENCES,
  SCHEDULE_DATE_PATTERN,
  SCHEDULE_MAX_RECIPIENTS,
  SCHEDULE_TIME_PATTERN,
  civilDateOf,
  isRunnable,
  nextOccurrences,
  type ReportSchedule,
} from '../schedule';

/**
 * The schedule a client may WRITE (FUT-776). The zone and the fortnight anchor
 * are not here on purpose: the zone is the store's, the anchor is the day the
 * schedule was set, and a client that could name either could move a delivery
 * off the clock its recipients read.
 */
function baseFields() {
  return {
    enabled: z.boolean(),
    cadence: z.enum(SCHEDULE_CADENCES),
    weekday: z.number().int().min(0).max(6).optional(),
    dayOfMonth: z.number().int().min(1).max(31).optional(),
    time: z.string().regex(SCHEDULE_TIME_PATTERN),
    recipients: z.array(z.string().min(1).max(64)).max(SCHEDULE_MAX_RECIPIENTS),
  };
}

/** The fields the chosen cadence reads must be present. */
function cadenceFieldsPresent(value: {
  cadence: string;
  weekday?: number;
  dayOfMonth?: number;
}): boolean {
  if (value.cadence === 'daily') return true;
  if (value.cadence === 'monthly') return value.dayOfMonth !== undefined;
  return value.weekday !== undefined;
}

/** A schedule that will run: it names the day it needs and, when on, someone to send it to. */
export const reportScheduleInput = z
  .strictObject(baseFields())
  .refine(cadenceFieldsPresent, { message: 'schedule is missing the day its cadence needs' })
  .refine((value) => !value.enabled || value.recipients.length > 0, {
    message: 'an enabled schedule needs at least one recipient',
  });

/**
 * The same shape for a PARKED edit, which is written mid-edit: the switch can
 * be on a moment before anyone is ticked, and rejecting that would drop the
 * keystrokes parking exists to keep. Publishing re-checks with the strict one.
 */
export const reportScheduleDraftInput = z
  .strictObject(baseFields())
  .refine(cadenceFieldsPresent, { message: 'schedule is missing the day its cadence needs' });

export type ReportScheduleInput = z.infer<typeof reportScheduleInput>;

/** What is stored: the input plus the two fields the server owns. */
const storedSchedule = z.strictObject({
  ...baseFields(),
  timeZone: z.string().min(1),
  startsOn: z.string().regex(SCHEDULE_DATE_PATTERN),
});

/** The wire shape echoed to an author — the stored one. */
export const reportScheduleView = storedSchedule;

/** Spread into the save body: omitted keeps the stored schedule, `null` removes it. */
export const scheduleBodyFields = { schedule: reportScheduleInput.nullish() } as const;

/** Spread into a saved view: echoed ONLY to a caller who may author, since it names people. */
export const scheduleViewFields = { schedule: reportScheduleView.nullish() } as const;

/**
 * The stored JSON column, read back. Unreadable or unrunnable JSON is `null`:
 * a delivery job must never fire from a value it could not fully understand.
 */
export function readSchedule(value: unknown): ReportSchedule | null {
  const parsed = storedSchedule.safeParse(value);
  if (!parsed.success) return null;
  const schedule = parsed.data as ReportSchedule;
  return isRunnable(schedule) ? schedule : null;
}

/** Only the day the cadence reads is kept, so a stored row never holds a stale one. */
function dayFields(input: ReportScheduleInput): { weekday?: number; dayOfMonth?: number } {
  if (input.cadence === 'monthly') return { dayOfMonth: input.dayOfMonth };
  return input.cadence === 'daily' ? {} : { weekday: input.weekday };
}

/** Whether the stored schedule is the same fortnight this write continues. */
function continuesFortnight(input: ReportScheduleInput, current: ReportSchedule | null): boolean {
  return (
    current !== null &&
    current.enabled &&
    input.enabled &&
    current.cadence === input.cadence &&
    current.weekday === input.weekday &&
    isRunnable(current)
  );
}

/**
 * The date the first send lands on: the next time the chosen weekday and time
 * come round, so a Monday-08:00 schedule saved on Monday at 15:00 starts next
 * Monday, and one saved at 06:00 starts today.
 */
function firstSendDate(input: ReportScheduleInput, clock: { timeZone: string; now: Date }): string {
  const probe: ReportSchedule = {
    enabled: true,
    cadence: 'weekly',
    weekday: input.weekday ?? 0,
    time: input.time,
    timeZone: clock.timeZone,
    recipients: [],
    startsOn: civilDateOf(clock.now, clock.timeZone),
  };
  const first = nextOccurrences(probe, clock.now, 1)[0];
  return civilDateOf(first ?? clock.now, clock.timeZone);
}

/**
 * The schedule a write lands on.
 *
 * `undefined` means "the body did not mention it": nothing is written, so a
 * stored schedule this release cannot read is never erased by an unrelated
 * save. An explicit `null` removes it. That is the omitted-keeps rule every
 * other saved field follows, so an MCP author patching a spec never switches
 * off a delivery.
 *
 * The fortnight anchor (`startsOn`) is the date of the first send. It survives
 * an edit that continues the same fortnight (still on, same cadence, same
 * weekday) and restarts at the next matching weekday when the schedule is
 * switched back on or the weekday moves, so a report re-enabled after a long
 * pause does not inherit a parity from months ago.
 */
export function resolveSchedule(
  input: ReportScheduleInput | null | undefined,
  current: ReportSchedule | null,
  clock: { timeZone: string; now: Date },
): ReportSchedule | null | undefined {
  if (input === undefined || input === null) return input;
  const startsOn =
    continuesFortnight(input, current) && current
      ? current.startsOn
      : input.cadence === 'biweekly'
        ? firstSendDate(input, clock)
        : civilDateOf(clock.now, clock.timeZone);
  return {
    enabled: input.enabled,
    cadence: input.cadence,
    ...dayFields(input),
    time: input.time,
    timeZone: clock.timeZone,
    recipients: [...new Set(input.recipients)],
    startsOn,
  };
}
