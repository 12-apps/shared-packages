/**
 * Reading the window the SERVER resolved back into the tenant's own days.
 *
 * Every run echoes `{ from, toExclusive }` as instants, and two different
 * screens need them as calendar days: the period row prints "07/07 – 06/08",
 * and the custom-range picker opens on the window already on screen rather than
 * on an empty calendar. Both derivations turn on the same subtlety, so they
 * live together rather than being got right twice.
 *
 * Extracted from `report-screen.tsx` when the picker arrived (FUT-755) — that
 * file was 25 lines under the size gate's ceiling and this is the half of it
 * that is arithmetic rather than layout.
 */

const DAY_MS = 86_400_000;

/**
 * A resolved window as the run payload carries it: two ISO instants.
 *
 * Structural and unexported on purpose — every caller passes the `range` off a
 * run response, which carries a `preset` these two functions have no use for.
 */
interface ResolvedWindow {
  from: string;
  toExclusive: string;
}

/**
 * The tenant's UTC offset, inferred from a window boundary.
 *
 * The payload carries instants, not a zone — but `from` is by construction the
 * tenant's LOCAL MIDNIGHT, so how far it sits from a UTC midnight IS the
 * offset. Without this the days are read in whichever zone the reader's laptop
 * happens to be in, and a window ending at local midnight lands a day late (or
 * early) for everyone outside the store's own zone.
 *
 * Anything past twelve hours is the other side of the dateline: a boundary
 * 22 hours after UTC midnight is a zone 2 hours AHEAD, not 22 behind.
 */
function tenantOffsetMs(fromMs: number): number {
  const rem = ((fromMs % DAY_MS) + DAY_MS) % DAY_MS;
  return rem <= DAY_MS / 2 ? -rem : DAY_MS - rem;
}

/** Both bounds shifted onto the tenant's clock, or null if either is garbage. */
function tenantBounds(range: ResolvedWindow): { from: Date; to: Date } | null {
  const from = Date.parse(range.from);
  const toExclusive = Date.parse(range.toExclusive);
  if (Number.isNaN(from) || Number.isNaN(toExclusive)) return null;
  const offset = tenantOffsetMs(from);
  // `toExclusive` is the next midnight AFTER the window, so the last day it
  // includes is the one a millisecond earlier — otherwise a 30-day window
  // reads as ending on a day it does not contain.
  return { from: new Date(from + offset), to: new Date(toExclusive - 1 + offset) };
}

/**
 * The window the server actually resolved, as "07/07 – 06/08".
 *
 * The preset says "30 dias"; this says WHICH thirty, and that is the only
 * version of the period a number can be checked against.
 */
export function windowLabel(range: ResolvedWindow): string {
  const bounds = tenantBounds(range);
  if (!bounds) return "";
  const day = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  });
  return `${day.format(bounds.from)} – ${day.format(bounds.to)}`;
}

/**
 * The same window as the two INCLUSIVE `AAAA-MM-DD` days a custom range is.
 *
 * What the picker opens on: choosing "Personalizado…" while looking at 30 dias
 * should start from those thirty days, not from a blank calendar the reader has
 * to page back through. `toISOString()` is safe here only because the bounds
 * have already been shifted onto the tenant's clock — the civil date and the
 * UTC date are the same date once that is done.
 */
export function windowDays(range: ResolvedWindow): { from: string; to: string } | null {
  const bounds = tenantBounds(range);
  if (!bounds) return null;
  return {
    from: bounds.from.toISOString().slice(0, 10),
    to: bounds.to.toISOString().slice(0, 10),
  };
}
