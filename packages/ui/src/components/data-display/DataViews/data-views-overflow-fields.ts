/**
 * WHICH CONTROLS THE BAR DECLARES — split from `data-views-overflow` at the
 * file-size gate. That module decides where each control goes; this one only
 * lists them, in the order the bar renders them.
 */
import type { OverflowField } from "./data-views-overflow";
import { isRangeSet } from "./data-views-overflow-costs";
import type { FilterFieldConfig, QuickFilterConfig, RangeFieldConfig, RangeValue } from "./data-views-types";

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

/**
 * Is this quick chip pressed — its one value the field's WHOLE selection?
 *
 * Exactly, not "includes": a field holding two values (from a saved view, the
 * URL or the side panel) is not what either chip applies, and reading both as
 * pressed made pressing one clear the other.
 */
export function isQuickActive(quick: QuickFilterConfig, pills: Record<string, string[]>): boolean {
  const selected = pills[quick.fieldId] ?? [];
  return selected.length === 1 && selected[0] === quick.value;
}

/**
 * Is any DECLARED filter applied — a pill value or a bounded range, wherever it
 * is drawn (on the bar, in "Mais", or as a chip)? Only declared ids count: the
 * bar draws "Limpar" on the active count, which ignores a stale key a saved view
 * still carries for a field since removed.
 */
export function anyApplied<T extends Record<string, unknown>>(
  all: OverflowField<T>[],
  pills: Record<string, string[]>,
  ranges: Record<string, RangeValue>,
): boolean {
  return all.some((field) => {
    if (field.group === "range") return isRangeSet(ranges[field.id]);
    const id = field.quick?.fieldId ?? field.id;
    return (pills[id]?.length ?? 0) > 0;
  });
}

/**
 * Quick chips stay a PREFIX of their declared order on the bar.
 *
 * The keep-what-fits loop skips a control that does not fit and tries the next,
 * which for pills is right (any narrower one is worth the room) and for chips
 * is not: "Zerado" alone on the bar, with "Estoque baixo" in "Mais", reads as a
 * different bar from the one declared. So the first chip that went to "Mais"
 * takes every later chip with it. Their room is NOT re-spent here — `used`
 * drops, and the ladder's later passes can hand it to the furniture.
 */
export function keepChipsInOrder<T extends Record<string, unknown>>(
  split: { inline: OverflowField<T>[]; overflow: OverflowField<T>[]; used: number },
  chips: OverflowField<T>[],
  cost: (field: OverflowField<T>) => number,
): { inline: OverflowField<T>[]; overflow: OverflowField<T>[]; used: number } {
  const firstOut = chips.findIndex((chip) => split.overflow.includes(chip));
  if (firstOut < 0) return split;
  const evicted = chips.slice(firstOut).filter((chip) => split.inline.includes(chip));
  if (evicted.length === 0) return split;
  return {
    inline: split.inline.filter((field) => !evicted.includes(field)),
    overflow: [...chips.slice(firstOut), ...split.overflow.filter((field) => !chips.includes(field))],
    used: split.used - evicted.reduce((sum, chip) => sum + cost(chip), 0),
  };
}



/**
 * A quick chip's press, as a pill write. Exclusive within the field: the chip's
 * value REPLACES the selection, and pressing the pressed chip empties it.
 */
export function toggleQuick(pills: Record<string, string[]>, quick: QuickFilterConfig): Record<string, string[]> {
  const pressed = isQuickActive(quick, pills);
  return { ...pills, [quick.fieldId]: pressed ? [] : [quick.value] };
}

