"use client";

import { useEffect, useRef, useState } from "react";

import type { FilterFieldConfig, RangeFieldConfig, RangeValue } from "./data-views-types";

/**
 * PROGRESSIVE COLLAPSE — which filter controls fit on the toolbar, measured.
 *
 * Two rules, and both come from watching the all-or-nothing version fail:
 *
 * 1. Controls shed ONE AT A TIME into an overflow, never all at once. With four
 *    filters and room for three, hiding all four throws away the room that was
 *    there.
 * 2. An APPLIED filter never hides. Applied controls take the visible slots
 *    first, so the overflow badge counts hidden FIELDS and never active
 *    filters — a filter you cannot see is a filter you forget you set, and then
 *    the list is "wrong" for reasons nothing on screen explains.
 *
 * It MEASURES rather than picking a breakpoint, which is what
 * `FILTERS-CONTRACT.md` asks for: pages declare different numbers of filters
 * with different label lengths, and the same page collapses at a different
 * width in another language. A shared breakpoint is wrong for at least one
 * table by construction.
 *
 * Collapsing is presentation only — nothing here emits a query, drops a filter
 * or changes a rendered row.
 */

/** A filter control on the bar: a multi-select pill or a min/max range. */
export interface OverflowField<T extends Record<string, unknown>> {
  id: string;
  label: string;
  /** Which control it is — the caller renders the right one. */
  group: "pill" | "range";
  pill?: FilterFieldConfig<T>;
  range?: RangeFieldConfig<T>;
}

/** What the caller renders inline, and what goes behind "Mais". */
interface OverflowSplit<T extends Record<string, unknown>> {
  inline: OverflowField<T>[];
  overflow: OverflowField<T>[];
  /** Attach to the toolbar row being measured. */
  barRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Rough rendered width of a control, in px.
 *
 * An ESTIMATE from the label text rather than a real measurement, deliberately:
 * measuring the true width needs every control mounted first, and mounting them
 * to decide whether to mount them is the layout thrash this hook exists to
 * avoid. The estimate only has to rank controls and find the cut point — being
 * a few px out moves the cut by at most one control, and the overflow catches it.
 */
function estimateWidth(text: string, extra: number): number {
  /** ~7.2px per character at the toolbar's font size, plus the chrome. */
  return Math.round(text.length * 7.2) + 52 + extra;
}

/** Is a range bounded at either end? */
function isRangeSet(range: RangeValue | undefined): boolean {
  return Boolean(range && (range.min !== undefined || range.max !== undefined));
}

/** The label a pill actually renders, which is what decides its width. */
function pillText<T extends Record<string, unknown>>(field: OverflowField<T>, values: string[]): string {
  if (values.length === 0) return field.label;
  if (values.length === 1) {
    const option = field.pill?.options.find((entry) => entry.value === values[0]);
    return `${field.label}: ${option?.label ?? values[0]}`;
  }
  return `${field.label}: ${values.length}`;
}

/** Every declared control, pills first, in the order the bar renders them. */
export function toOverflowFields<T extends Record<string, unknown>>(
  fields: FilterFieldConfig<T>[],
  rangeFields: RangeFieldConfig<T>[],
): OverflowField<T>[] {
  return [
    ...fields.map((pill) => ({ id: pill.id, label: pill.label, group: "pill" as const, pill })),
    ...rangeFields.map((range) => ({ id: range.id, label: range.label, group: "range" as const, range })),
  ];
}

/** Fixed toolbar furniture the filters have to fit around, in px. */
const RESERVED = {
  /** The search box never shrinks below this. */
  search: 200,
  /** The "N de N" counter. */
  counter: 96,
  /** The right-hand controls (Exibir, Exportar). */
  right: 216,
  /** The "Mais" button, only charged when there IS an overflow. */
  overflowButton: 104,
  /** Gaps + the row's own padding. */
  chrome: 64,
} as const;

/** The gap between two controls. */
const GAP = 8;

/** Observe the bar's width. Returns 0 until the first measurement lands. */
function useBarWidth(): { barRef: React.RefObject<HTMLDivElement | null>; width: number } {
  const barRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = barRef.current;
    // jsdom has no ResizeObserver, and neither does an SSR pass — with no
    // measurement the hook keeps every control inline, which is the honest
    // fallback: nothing is hidden behind a menu nobody can see.
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { barRef, width };
}

/** Is this control carrying a value the operator set? */
function isActiveField<T extends Record<string, unknown>>(
  field: OverflowField<T>,
  pills: Record<string, string[]>,
  ranges: Record<string, RangeValue>,
): boolean {
  return field.group === "pill"
    ? (pills[field.id]?.length ?? 0) > 0
    : isRangeSet(ranges[field.id]);
}

/** Estimated rendered width of one control at its CURRENT value. */
function fieldWidth<T extends Record<string, unknown>>(
  field: OverflowField<T>,
  pills: Record<string, string[]>,
  ranges: Record<string, RangeValue>,
): number {
  if (field.group === "pill") return estimateWidth(pillText(field, pills[field.id] ?? []), 0);
  // A bounded range renders two number inputs beside its label.
  return estimateWidth(field.label, isRangeSet(ranges[field.id]) ? 100 : 0);
}

/** The measured split. Pure, so the hook below is only caching + measurement. */
function computeSplit<T extends Record<string, unknown>>(
  all: OverflowField<T>[],
  pills: Record<string, string[]>,
  ranges: Record<string, RangeValue>,
  width: number,
): { inline: OverflowField<T>[]; overflow: OverflowField<T>[] } {
  const none: OverflowField<T>[] = [];
  // Unmeasured (SSR, or jsdom without a ResizeObserver) ⇒ hide nothing.
  if (width === 0) return { inline: all, overflow: none };

  const widthOf = (field: OverflowField<T>): number => fieldWidth(field, pills, ranges);
  const active = all.filter((field) => isActiveField(field, pills, ranges));
  const idle = all.filter((field) => !isActiveField(field, pills, ranges));
  const cost = (fields: OverflowField<T>[]): number =>
    fields.reduce((sum, field) => sum + widthOf(field) + GAP, 0);

  // AN APPLIED FILTER NEVER HIDES — it is not merely ranked first, it is
  // exempt. Applying a value LENGTHENS a control ("Método: Pix"), so ranking
  // alone still loses the one filter the operator just set whenever it no
  // longer fits on its own. The bar wraps; a filter you cannot see does not
  // announce itself at all.
  let available =
    width - RESERVED.search - RESERVED.counter - RESERVED.right - RESERVED.chrome - cost(active);
  if (idle.length === 0 || cost(idle) <= available) return { inline: all, overflow: none };

  // There IS an overflow, so its button now costs room too.
  available -= RESERVED.overflowButton;
  const keep = new Set(active.map((field) => field.id));
  for (const field of idle) {
    const next = widthOf(field) + GAP;
    if (next > available) break;
    available -= next;
    keep.add(field.id);
  }
  return {
    // Rendered in the DECLARED order, not the applied-first one: which controls
    // are visible may change with the width, but the ones that stay must not
    // reshuffle under the operator's cursor.
    inline: all.filter((field) => keep.has(field.id)),
    overflow: all.filter((field) => !keep.has(field.id)),
  };
}

/**
 * Split the declared filter controls into what fits and what goes behind
 * "Mais", measured against the live toolbar width.
 *
 * Cached on a SIGNATURE rather than by `useMemo` over the inputs: hosts declare
 * their fields inline, so `all` is a fresh array on every render while the
 * configuration is unchanged, and a reference-keyed memo would never hit.
 */
export function useFilterOverflow<T extends Record<string, unknown>>(
  all: OverflowField<T>[],
  pills: Record<string, string[]>,
  ranges: Record<string, RangeValue>,
): OverflowSplit<T> {
  const { barRef, width } = useBarWidth();
  const signature = JSON.stringify({ ids: all.map((field) => field.id), pills, ranges, width });
  const cache = useRef<{ signature: string; split: ReturnType<typeof computeSplit<T>> } | null>(null);
  if (cache.current?.signature !== signature) {
    cache.current = { signature, split: computeSplit(all, pills, ranges, width) };
  }
  return { ...cache.current.split, barRef };
}
