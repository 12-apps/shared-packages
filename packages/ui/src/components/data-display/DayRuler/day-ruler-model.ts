import type { RulerHour } from './DayRuler.types';

/**
 * THE RULER'S ARITHMETIC, as pure functions (FUT-3825): snapping, clamping,
 * positions and the HH:MM the ruler writes. Hours are from the day's
 * midnight; past 24 is the next morning.
 */

/** `h` on the `snap`-hour grid (0.25 for 15 minutes). */
export function snapTo(h: RulerHour, snap: number): RulerHour {
  return snap > 0 ? Math.round(h / snap) * snap : h;
}

export function clamp(h: RulerHour, from: RulerHour, to: RulerHour): RulerHour {
  return Math.min(to, Math.max(from, h));
}

/** The hour under `x` on a track whose box starts at `left` and is `width` wide, snapped and clamped. */
export function hourAt(x: number, left: number, width: number, from: RulerHour, to: RulerHour, snap: number): RulerHour {
  const share = width > 0 ? (x - left) / width : 0;
  return clamp(snapTo(from + share * (to - from), snap), from, to);
}

/** Where `h` sits along the ruler, 0..100 (%), clamped to it. */
export function percentOf(h: RulerHour, from: RulerHour, to: RulerHour): number {
  return ((clamp(h, from, to) - from) / (to - from)) * 100;
}

/** "20:45"; 26 → "02:00", 24 → "00:00". */
export function formatHour(h: RulerHour): string {
  const minutes = Math.round(h * 60);
  const hh = Math.floor(minutes / 60) % 24;
  const mm = minutes % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** "20:45–00:45". */
export function formatRange(start: RulerHour, end: RulerHour): string {
  return `${formatHour(start)}–${formatHour(end)}`;
}

/** A block slid by `delta`, keeping its length and staying on the ruler. */
export function moved(start: RulerHour, end: RulerHour, delta: number, from: RulerHour, to: RulerHour): [RulerHour, RulerHour] {
  const length = end - start;
  const next = clamp(start + delta, from, to - length);
  return [next, next + length];
}

/** A block whose `side` was dragged to `h`, never shorter than `minHours`, never off the ruler. */
export function resized(
  start: RulerHour,
  end: RulerHour,
  side: 'start' | 'end',
  h: RulerHour,
  minHours: number,
  from: RulerHour,
  to: RulerHour,
): [RulerHour, RulerHour] {
  if (side === 'start') return [clamp(Math.min(h, end - minHours), from, to), end];
  return [start, clamp(Math.max(h, start + minHours), from, to)];
}

/** A click alone (shorter than `minHours`) becomes `createHours` from where it was pressed. */
export function createdSpan(
  a: RulerHour,
  b: RulerHour,
  minHours: number,
  createHours: number,
  to: RulerHour,
): [RulerHour, RulerHour] {
  const start = Math.min(a, b);
  const end = Math.max(a, b);
  if (end - start >= minHours) return [start, end];
  return [start, Math.min(to, start + createHours)];
}

/** The axis labels: every `step` hours from `from` to `to`, both ends included. */
export function ticksOf(from: RulerHour, to: RulerHour, step: number): RulerHour[] {
  const out: RulerHour[] = [];
  if (step <= 0) return [from, to];
  for (let h = from; h <= to + 1e-9; h += step) out.push(h);
  return out;
}
