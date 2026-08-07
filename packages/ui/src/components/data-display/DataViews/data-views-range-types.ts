/**
 * RANGE FILTERS — the value types, apart from the rest of the DataViews model.
 *
 * Split out because `data-views-types` had grown past the file-size gate, and
 * this is the seam that actually exists: a range is a self-contained little
 * language (a window, its two kinds, its one-click presets) that the pill, the
 * overflow panel, the slide-in panel and the fake backend all speak.
 *
 * Every one of them still imports from `data-views-types`, which re-exports
 * these — there is one public name for the model, and moving a type between
 * files is not a reason to touch a dozen import lines.
 */

/**
 * A selected range for a range filter (either bound optional). Numbers for a
 * `number` field; `AAAA-MM-DD` day strings for a `day` one — which compare
 * correctly with `<`/`>` precisely because ISO days sort lexicographically.
 */
export interface RangeValue {
  min?: number | string;
  max?: number | string;
}

/** What a range field measures — the input it renders and the bound it stores. */
export type RangeFieldKind = "number" | "day";

/**
 * A one-click window for a range filter: "Hoje", "Acima de R$ 500".
 *
 * `range` is a FUNCTION when the answer depends on when it is clicked and a
 * literal when it does not. "Hoje" must mean today at the moment of the click,
 * not at the moment the config object was built — a long-lived admin tab
 * evaluating it once would go on filtering by the day it was opened.
 *
 * What lands in `DataViewState.ranges` is always the RESOLVED window, so a
 * saved view captures the days "Hoje" meant when it was saved. That is the
 * honest behaviour for a saved view: it is a stored filter, not a stored
 * intent, and re-running it later must not silently answer a different
 * question.
 */
export interface RangePreset {
  /** Stable id, used as the React key and in the preset's test id. */
  id: string;
  label: string;
  range: RangeValue | (() => RangeValue);
}

interface RangeFieldBase {
  /** Stable id; the key under `DataViewState.ranges`. */
  id: string;
  label: string;
  /**
   * One-click windows offered above the `De`/`Até` inputs.
   *
   * A `day` field falls back to the calendar defaults (Hoje / Ontem / Esta
   * semana / Este mês / Este ano) when this is omitted, because those windows
   * are the same for every date filter that has ever existed. A `number` field
   * has no such universal set — what counts as a big order is the host's
   * business — so it shows presets only when given them. Pass `[]` to a day
   * field to suppress the defaults.
   */
  presets?: RangePreset[];
}

/** "Filter by amount": price, stock, margin, order total. */
export interface NumberRangeFieldConfig<T extends Record<string, unknown>> extends RangeFieldBase {
  kind?: "number";
  /** Reads the row's numeric value for this range. */
  accessor: (row: T) => number | null | undefined;
  /** Optional unit suffix shown next to the inputs (e.g. "R$", "un"). */
  unit?: string;
  /** Numeric input step. Defaults to 1. */
  step?: number;
}

/**
 * "Filter by period": a pair of INCLUSIVE calendar days, rendered as two native
 * date inputs. Inclusive is the reason a day range is its own kind rather than a
 * number over timestamps — coercing an `até` of `2026-07-15` to a instant lands
 * on that day's midnight and drops the whole final day (FUT-668).
 */
export interface DayRangeFieldConfig<T extends Record<string, unknown>> extends RangeFieldBase {
  kind: "day";
  /** Reads the row's `AAAA-MM-DD` day for this range. */
  accessor: (row: T) => string | null | undefined;
}

/**
 * A min/max range filter's configuration. Complements the multi-select pills.
 * A row with a null/undefined value never matches a bounded range.
 */
export type RangeFieldConfig<T extends Record<string, unknown>> =
  | NumberRangeFieldConfig<T>
  | DayRangeFieldConfig<T>;
