/**
 * WHICH CONTROLS THE BAR DECLARES — split from `data-views-overflow` at the
 * file-size gate. That module decides where each control goes; this one only
 * lists them, in the order the bar renders them.
 */
import type { OverflowField } from "./data-views-overflow";
import type { FilterFieldConfig, QuickFilterConfig, RangeFieldConfig } from "./data-views-types";

/**
 * Every declared control in the order the bar renders them: quick chips first,
 * then pills, then ranges.
 *
 * A pill field a quick chip writes to is NOT a control of its own — the chips
 * stand in for it (see `QuickFilterConfig`) — so it is left out here, and only
 * here: it stays in `fields`, where the active count and saved views read it.
 */
export function toOverflowFields<T extends Record<string, unknown>>(
  fields: FilterFieldConfig<T>[],
  rangeFields: RangeFieldConfig<T>[],
  quickFilters: QuickFilterConfig[] = [],
): OverflowField<T>[] {
  const chipFields = new Set(quickFilters.map((quick) => quick.fieldId));
  return [
    ...quickFilters.map((quick) => ({
      id: `quick:${quick.id}`,
      label: quick.label,
      group: "quick" as const,
      quick,
    })),
    ...fields
      .filter((pill) => !chipFields.has(pill.id))
      .map((pill) => ({ id: pill.id, label: pill.label, group: "pill" as const, pill, pinned: pill.inMore === true })),
    ...rangeFields.map((range) => ({
      id: range.id,
      label: range.label,
      group: "range" as const,
      range,
      pinned: range.inMore === true,
    })),
  ];
}

/** Is this quick chip pressed — its one value the field's whole selection? */
export function isQuickActive(quick: QuickFilterConfig, pills: Record<string, string[]>): boolean {
  return (pills[quick.fieldId] ?? []).includes(quick.value);
}



/**
 * A quick chip's press, as a pill write. Exclusive within the field: the chip's
 * value REPLACES the selection, and pressing the pressed chip empties it.
 */
export function toggleQuick(pills: Record<string, string[]>, quick: QuickFilterConfig): Record<string, string[]> {
  const pressed = (pills[quick.fieldId] ?? []).includes(quick.value);
  return { ...pills, [quick.fieldId]: pressed ? [] : [quick.value] };
}

