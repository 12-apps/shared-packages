import type { DataViewsCopy } from "./data-views-copy";
import type { RangeFieldConfig, RangePreset, RangeValue } from "./data-views-types";

/**
 * THE CALENDAR WINDOWS BEHIND A DATE FILTER'S ONE-CLICK PRESETS.
 *
 * Pure and component-free, for the same reason `data-views-range-values` is:
 * the pill's popover, the slide-in panel and the "Mais" overflow all offer the
 * same presets, and none of them should have to import a component to know what
 * "Esta semana" resolves to.
 *
 * Every window is computed in the LOCAL calendar and emitted as `AAAA-MM-DD`.
 * Going through `toISOString()` would answer in UTC, which for every Brazilian
 * timezone is a day ahead after 21:00 — "Hoje" would quietly become tomorrow
 * every evening.
 */

/** `AAAA-MM-DD` for a date, read in the local calendar (never UTC). */
function isoDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** The same date shifted by whole days, without mutating the original. */
function shiftDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * The five windows every date filter wants, resolved when CLICKED.
 *
 * Each is a whole calendar unit rather than a unit-to-date: "Este mês" is the
 * whole month, not the 1st through today. It is what the words say, it matches
 * the label a merchant reads back on the pill, and it changes nothing for a
 * dataset with no future rows — while a page that does have them (scheduled
 * orders) would otherwise hide them under a preset that claims to show the
 * month.
 *
 * The week starts on SUNDAY, following the Brazilian calendar these grids are
 * read against rather than ISO-8601's Monday.
 */
export function dayRangePresets(copy: DataViewsCopy): RangePreset[] {
  return [
  {
    id: "hoje",
    range: () => {
      const today = isoDay(new Date());
      return { min: today, max: today };
    },
  },
  {
    id: "ontem",
    range: () => {
      const yesterday = isoDay(shiftDays(new Date(), -1));
      return { min: yesterday, max: yesterday };
    },
  },
  {
    id: "semana",
    range: () => {
      const now = new Date();
      const sunday = shiftDays(now, -now.getDay());
      return { min: isoDay(sunday), max: isoDay(shiftDays(sunday, 6)) };
    },
  },
  {
    id: "mes",
    range: () => {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();
      // Day 0 of the NEXT month is the last day of this one — the only spelling
      // that needs no month-length table and no leap-year branch.
      return { min: isoDay(new Date(year, month, 1)), max: isoDay(new Date(year, month + 1, 0)) };
    },
  },
  {
    id: "ano",
    range: () => {
      const year = new Date().getFullYear();
      return { min: `${year}-01-01`, max: `${year}-12-31` };
    },
  },
  ].map((preset) => ({ ...preset, label: copy.filters.rangePresets[preset.id] ?? preset.id }));
}

/**
 * The presets a field offers: its own, or the calendar defaults for a day field
 * that declared none. An explicit `[]` means none — a host suppressing them is
 * saying something, and must not be overridden by the fallback.
 */
export function presetsFor<T extends Record<string, unknown>>(
  field: RangeFieldConfig<T>,
  copy: DataViewsCopy,
): RangePreset[] {
  if (field.presets) return field.presets;
  return field.kind === "day" ? dayRangePresets(copy) : [];
}

/** A preset's window, evaluating it if it is time-dependent. */
export function resolvePreset(preset: RangePreset): RangeValue {
  return typeof preset.range === "function" ? preset.range() : preset.range;
}

/**
 * Is this preset the window currently applied?
 *
 * Bounds compare as STRINGS because a `number` field's stored bound may have
 * arrived from an input as `100` while the preset declares `100` — same window,
 * and `undefined` vs a missing key must read as equal too.
 */
export function isPresetActive(preset: RangePreset, value: RangeValue): boolean {
  const resolved = resolvePreset(preset);
  const same = (a: number | string | undefined, b: number | string | undefined): boolean =>
    String(a ?? "") === String(b ?? "");
  return same(resolved.min, value.min) && same(resolved.max, value.max);
}
