import { addDays, addMonths, startOfWeek } from './Calendar.dates';

const DAYS_PER_WEEK = 7;
const MONTHS_PER_YEAR = 12;

interface NavigationContext {
  firstDayOfWeek: number;
  shiftKey: boolean;
}

// A lookup rather than a switch: each entry is one move, and adding a key does
// not add a branch to the handler.
const NAVIGATION: Record<string, (date: Date, context: NavigationContext) => Date> = {
  ArrowLeft: (date) => addDays(date, -1),
  ArrowRight: (date) => addDays(date, 1),
  ArrowUp: (date) => addDays(date, -DAYS_PER_WEEK),
  ArrowDown: (date) => addDays(date, DAYS_PER_WEEK),
  Home: (date, { firstDayOfWeek }) => startOfWeek(date, firstDayOfWeek),
  End: (date, { firstDayOfWeek }) => addDays(startOfWeek(date, firstDayOfWeek), DAYS_PER_WEEK - 1),
  // Shift jumps a year rather than a month.
  PageUp: (date, { shiftKey }) => addMonths(date, shiftKey ? -MONTHS_PER_YEAR : -1),
  PageDown: (date, { shiftKey }) => addMonths(date, shiftKey ? MONTHS_PER_YEAR : 1),
};

export const ACTIVATION_KEYS = ['Enter', ' '];

// Returns where focus moves for a navigation key, or null if the key is not one.
export const navigateFocus = (
  key: string,
  date: Date,
  context: NavigationContext,
): Date | null => NAVIGATION[key]?.(date, context) ?? null;
