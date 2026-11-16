import { z } from 'zod';

import {
  SCHEDULE_CADENCES,
  SCHEDULE_DATE_PATTERN,
  SCHEDULE_MAX_RECIPIENTS,
  SCHEDULE_TIME_PATTERN,
  civilDateOf,
  isRunnable,
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

/**
 * The schedule a write lands on.
 *
 * `undefined` keeps what is stored and an explicit `null` removes it — the
 * omitted-keeps rule every other saved field follows, so an MCP author
 * patching a spec never switches off a delivery.
 *
 * The fortnight anchor survives an edit that does not move the fortnight (the
 * same cadence on the same weekday) and restarts today when it does; saving
 * the dialog twice must not shuffle which weeks a report goes out.
 */
export function resolveSchedule(
  input: ReportScheduleInput | null | undefined,
  current: ReportSchedule | null,
  clock: { timeZone: string; now: Date },
): ReportSchedule | null {
  if (input === undefined) return current;
  if (input === null) return null;
  const sameFortnight =
    current !== null &&
    current.cadence === input.cadence &&
    current.weekday === input.weekday &&
    isRunnable(current);
  return {
    enabled: input.enabled,
    cadence: input.cadence,
    ...dayFields(input),
    time: input.time,
    timeZone: clock.timeZone,
    recipients: [...new Set(input.recipients)],
    startsOn:
      sameFortnight && current ? current.startsOn : civilDateOf(clock.now, clock.timeZone),
  };
}
