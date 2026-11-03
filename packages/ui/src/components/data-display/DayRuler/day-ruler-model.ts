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

/** A bar along the track: where it starts and how long it is, both in % of the track. */
export interface TrackSpan {
  at: number;
  share: number;
}

/**
 * How far each bar's hit band may reach, in % of the track (FUT-3831): from
 * `lo` to `hi`, never past the track's ends and never past the MIDPOINT of
 * the gap to the bar beside it, so a band widened round a short bar cannot
 * take a tap meant for its neighbour. Two bars that touch or overlap give each
 * other nothing: the band stays on the bar's own edge on that side.
 *
 * The band itself is drawn in CSS — at least the hit area wide, centred on the
 * bar, then cut to `lo…hi` — because the bar's width in px is the layout's.
 */
export function hitBoundsOf(spans: readonly TrackSpan[]): { lo: number; hi: number }[] {
  const order = spans.map((_, index) => index).sort((a, b) => spans[a]!.at - spans[b]!.at);
  const out = spans.map(() => ({ lo: 0, hi: 100 }));
  for (let k = 1; k < order.length; k += 1) {
    const left = spans[order[k - 1]!]!;
    const right = spans[order[k]!]!;
    const leftEnd = left.at + left.share;
    const mid = leftEnd <= right.at ? (leftEnd + right.at) / 2 : null;
    out[order[k - 1]!]!.hi = Math.min(out[order[k - 1]!]!.hi, mid ?? leftEnd);
    out[order[k]!]!.lo = Math.max(out[order[k]!]!.lo, mid ?? right.at);
  }
  return out;
}

/** What a block can say in its bar: its full text, its start, or nothing. */
export type BlockTextFit = 'full' | 'short' | 'none';

/**
 * Which of a block's texts fits the room it leaves inside the bar, by pixels
 * (FUT-3831): the full one, else the short one, else NOTHING — a cut "12:"
 * says less than an empty bar whose title and accessible name carry the text.
 */
export function textFitOf(fullWidth: number, shortWidth: number, room: number): BlockTextFit {
  const slack = 0.5;
  if (fullWidth <= room + slack) return 'full';
  if (shortWidth <= room + slack) return 'short';
  return 'none';
}
