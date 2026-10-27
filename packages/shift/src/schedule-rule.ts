/**
 * The series rule as pure functions: which local days it falls on, and the
 * slot it builds on one of them. No I/O — see `schedule-materialise.ts`.
 */
import { DAY_MINUTES, invalid, validateBreak } from './schedule-context';
import type { ShiftSeriesRepeat, ShiftSlotSeries } from './schedule-series-types';
import {
  addLocalDays,
  dayOfMonth,
  isKnownTimeZone,
  isLocalDate,
  isoWeekday,
  localDaysBetween,
  zonedInstant,
  type LocalDate,
} from './schedule-time';
import type { ShiftSlot } from './schedule-types';

const MAX_MONTHLY_NTH = 5;

/** The fields of a rule that decide its days and hours — what the validator checks. */
type RuleShape = Pick<
  ShiftSlotSeries,
  | 'weekdays'
  | 'everyWeeks'
  | 'monthlyNth'
  | 'startMinutes'
  | 'endMinutes'
  | 'breakOffsetMinutes'
  | 'breakMinutes'
  | 'timeZone'
  | 'startsOn'
  | 'endsOn'
>;

/** Minutes from start to end on the wall clock; an end at or before the start is the next day. */
function wallLengthMinutes(startMinutes: number, endMinutes: number): number {
  return endMinutes > startMinutes ? endMinutes - startMinutes : endMinutes - startMinutes + DAY_MINUTES;
}

function isWallMinute(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < DAY_MINUTES;
}

function isMonthlyNth(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_MONTHLY_NTH;
}

/** Normalise the repeat to exactly one of the two, or refuse. */
export function repeatOf(repeat: ShiftSeriesRepeat): Pick<ShiftSlotSeries, 'everyWeeks' | 'monthlyNth'> {
  const everyWeeks = repeat.everyWeeks ?? null;
  const monthlyNth = repeat.monthlyNth ?? null;
  if ((everyWeeks === null) === (monthlyNth === null)) {
    throw invalid('A series repeats either every N weeks or monthly — exactly one of the two.');
  }
  if (everyWeeks !== null && everyWeeks !== 1 && everyWeeks !== 2) throw invalid('everyWeeks must be 1 or 2.');
  if (monthlyNth !== null && !isMonthlyNth(monthlyNth)) {
    throw invalid(`monthlyNth must be a whole number from 1 to ${MAX_MONTHLY_NTH}.`);
  }
  return { everyWeeks, monthlyNth };
}

function validateWeekdays(rule: RuleShape): void {
  const { weekdays } = rule;
  const valid = weekdays.every((day) => Number.isInteger(day) && day >= 1 && day <= 7);
  if (weekdays.length === 0 || !valid || new Set(weekdays).size !== weekdays.length) {
    throw invalid('weekdays must name each ISO weekday (1–7) at most once, and at least one.');
  }
  if (rule.monthlyNth !== null && weekdays.length !== 1) {
    throw invalid('A monthly series falls on exactly one weekday.');
  }
}

/** Refuse a rule Postgres would refuse, and one whose days cannot be read in its zone. */
export function validateRule(rule: RuleShape): void {
  repeatOf(rule);
  validateWeekdays(rule);
  if (!isWallMinute(rule.startMinutes) || !isWallMinute(rule.endMinutes)) {
    throw invalid('startMinutes and endMinutes must be whole minutes from 0 to 1439.');
  }
  if (!isKnownTimeZone(rule.timeZone)) throw invalid('A series needs a known timeZone.');
  if (!isLocalDate(rule.startsOn)) throw invalid('startsOn must be a YYYY-MM-DD date.');
  if (rule.endsOn !== null && !isLocalDate(rule.endsOn)) throw invalid('endsOn must be a YYYY-MM-DD date.');
  validateBreak(rule.breakOffsetMinutes, rule.breakMinutes, wallLengthMinutes(rule.startMinutes, rule.endMinutes));
}

/** Monday of the ISO week `date` is in. */
function mondayOf(date: LocalDate): LocalDate {
  return addLocalDays(date, 1 - isoWeekday(date));
}

/** Whether the rule's repeat lands on `date` — bounds and skipped days aside. */
function repeatLandsOn(rule: Pick<ShiftSlotSeries, 'weekdays' | 'everyWeeks' | 'monthlyNth' | 'startsOn'>, date: LocalDate): boolean {
  if (!rule.weekdays.includes(isoWeekday(date))) return false;
  if (rule.monthlyNth !== null) return Math.ceil(dayOfMonth(date) / 7) === rule.monthlyNth;
  const weeks = localDaysBetween(mondayOf(rule.startsOn), mondayOf(date)) / 7;
  return weeks % (rule.everyWeeks ?? 1) === 0;
}

/** The rule's days in `[from, until]`, inside its own bounds, skipped days left out. */
export function occurrencesBetween(rule: ShiftSlotSeries, from: LocalDate, until: LocalDate): LocalDate[] {
  const first = from > rule.startsOn ? from : rule.startsOn;
  const last = rule.endsOn !== null && rule.endsOn < until ? rule.endsOn : until;
  const skipped = new Set(rule.skippedDates);
  const dates: LocalDate[] = [];
  for (let date = first; date <= last; date = addLocalDays(date, 1)) {
    if (!skipped.has(date) && repeatLandsOn(rule, date)) dates.push(date);
  }
  return dates;
}

/** The slot the rule plans on `date`, wall-clock hours resolved in its zone. */
export function buildRuleSlot(rule: ShiftSlotSeries, date: LocalDate, id: string, createdAt: Date): ShiftSlot {
  const endDate = rule.endMinutes > rule.startMinutes ? date : addLocalDays(date, 1);
  return {
    id,
    clientId: rule.clientId,
    userId: rule.userId,
    kind: rule.kind,
    startsAt: zonedInstant(date, rule.startMinutes, rule.timeZone),
    endsAt: zonedInstant(endDate, rule.endMinutes, rule.timeZone),
    resourceType: rule.resourceType,
    resourceId: rule.resourceId,
    coverage: rule.coverage ? rule.coverage.map((entry) => ({ ...entry })) : null,
    seriesId: rule.id,
    originSeriesId: null,
    seriesDate: date,
    detached: false,
    breakOffsetMinutes: rule.breakOffsetMinutes,
    breakMinutes: rule.breakMinutes,
    createdByUserId: rule.createdByUserId,
    createdAt,
    canceledAt: null,
    canceledByUserId: null,
    cancelReason: null,
  };
}

/** Audit fields of a rule, as strings. */
export function ruleAuditFields(rule: ShiftSlotSeries): Record<string, string | null> {
  const text = (value: number | null): string | null => (value === null ? null : String(value));
  return {
    userId: rule.userId,
    kind: rule.kind,
    weekdays: rule.weekdays.join(','),
    everyWeeks: text(rule.everyWeeks),
    monthlyNth: text(rule.monthlyNth),
    startMinutes: String(rule.startMinutes),
    endMinutes: String(rule.endMinutes),
    breakOffsetMinutes: text(rule.breakOffsetMinutes),
    breakMinutes: text(rule.breakMinutes),
    timeZone: rule.timeZone,
    startsOn: rule.startsOn,
    endsOn: rule.endsOn,
    previousSeriesId: rule.previousSeriesId,
  };
}
