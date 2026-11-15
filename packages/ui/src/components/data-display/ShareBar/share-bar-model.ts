/**
 * The share bar's arithmetic (FUT-145), pure so it is asserted without a
 * browser: each part's share of the total, and WHOLE percents that add to
 * exactly 100 (largest remainder), so a list never reads 33% + 33% + 33%.
 */
import type { ShareBarSegment } from './ShareBar.types';

export interface ShareBarPart {
  key: string;
  label: string;
  value: number;
  /** 0–1; 0 for a part at or under zero, or when the total is zero. */
  share: number;
  /** Whole percent; the parts with a share add to 100. */
  percent: number;
}

export function shareBarParts(segments: readonly ShareBarSegment[]): ShareBarPart[] {
  const counted = segments.map((segment) => Math.max(0, Number.isFinite(segment.value) ? segment.value : 0));
  const total = counted.reduce((sum, value) => sum + value, 0);
  const exact = counted.map((value) => (total > 0 ? (value / total) * 100 : 0));
  const percents = exact.map(Math.floor);
  const missing = total > 0 ? 100 - percents.reduce((sum, value) => sum + value, 0) : 0;
  // Hand the leftover points to the largest remainders, earliest first on a tie.
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let given = 0; given < missing; given += 1) {
    const target = order[given % order.length];
    if (target) percents[target.index] = (percents[target.index] ?? 0) + 1;
  }
  return segments.map((segment, index) => ({
    key: segment.key,
    label: segment.label,
    value: segment.value,
    share: total > 0 ? (counted[index] ?? 0) / total : 0,
    percent: percents[index] ?? 0,
  }));
}

/**
 * Whether a segment of `segmentPx` holds its percent inside the bar: the text's
 * width at the bar's type (about 0.7em a glyph, generous for "%") plus padding either
 * side. Below it the percent is left to the list, never clipped.
 */
export function fitsInline(segmentPx: number, text: string, fontPx: number, paddingPx: number): boolean {
  return segmentPx >= text.length * fontPx * 0.7 + paddingPx * 2;
}
