import type { RangeFieldConfig, RangeValue } from "./data-views-types";

/**
 * What a range VALUE means, separate from the controls that edit one.
 *
 * Pure and component-free: whether a window is set, whether it is inverted, how
 * it reads as a label, and its numeric form. The pill, the overflow panel and
 * the filter panel all ask these questions, and none of them should have to
 * import a component to do it.
 */

/** Is either bound set? Drives the pill's active styling and the chip. */
export function isRangeSet(range: RangeValue | undefined): boolean {
  return Boolean(range && (range.min != null || range.max != null));
}
/** `AAAA-MM-DD` → `DD/MM` — the compact form a chip shows. */
function shortDay(day: string): string {
  const [, month, date] = day.split('-');
  return month && date ? `${date}/${month}` : day;
}
/** One bound, rendered for the chip: money in reais, a day as `DD/MM`. */
function boundLabel<T extends Record<string, unknown>>(
  field: RangeFieldConfig<T>,
  bound: number | string,
): string {
  if (field.kind === 'day') return shortDay(String(bound));
  return field.unit ? `${field.unit} ${bound}` : String(bound);
}
/**
 * The chip text for an applied range: "Data: 01/07–31/07" when both ends are
 * set, and a one-sided window as the inequality it actually is ("Valor: ≥ R$ 20")
 * rather than an en-dash with a blank side.
 */
export function rangeChipLabel<T extends Record<string, unknown>>(
  field: RangeFieldConfig<T>,
  range: RangeValue,
): string {
  const { min, max } = range;
  if (min != null && max != null) {
    return `${field.label}: ${boundLabel(field, min)}–${boundLabel(field, max)}`;
  }
  if (min != null) return `${field.label}: ≥ ${boundLabel(field, min)}`;
  return `${field.label}: ≤ ${boundLabel(field, max as number | string)}`;
}
/**
 * Is the window INVERTED — a `de` after its `até`?
 *
 * Not an error the merchant must clear before the list responds: it simply
 * matches nothing. But an empty grid with no explanation reads as "there is no
 * data", so the control says which of the two it is.
 */
export function isRangeInverted(value: RangeValue): boolean {
  return value.min != null && value.max != null && value.min > value.max;
}
/**
 * A stored range narrowed to NUMBERS, for the slide-in panel's numeric control.
 * A bound that doesn't parse is dropped rather than passed on as `NaN`, which
 * the control would render as an empty box that still filtered.
 */
export function numericRange(range: RangeValue): { min?: number; max?: number } {
  const parse = (bound: number | string | undefined): number | undefined => {
    if (bound == null || bound === "") return undefined;
    const value = Number(bound);
    return Number.isNaN(value) ? undefined : value;
  };
  const min = parse(range.min);
  const max = parse(range.max);
  return { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
}
