/**
 * A saved view's STORED shape (FUT-4867): {@link DataViewState} with its two
 * open maps written as keyed lists.
 *
 * In memory, `pills` and `ranges` are maps keyed by field id — the shape every
 * control reads and writes, and the one that stays. On the wire and in a host's
 * database that map is a record keyed by ANY string, which a host whose rule is
 * "every request input is closed at every depth" cannot accept: nothing says
 * which keys exist. A list of `{ field, … }` entries carries the same facts with
 * every key declared.
 *
 * Nothing here changes what the component emits. `DataViewSaveInput.state` is
 * still the in-memory shape, because hosts read it as such (a server query
 * built from `state.pills`), and a host's stored rows hold the legacy shape
 * until it rewrites them. A host opts in by converting at its persistence seam
 * with {@link toDataViewStateWire}; reading accepts BOTH shapes everywhere
 * ({@link readStoredViewState}, `toSavedViewSummary`, applying a view), so
 * views stored before the switch keep applying.
 *
 * The zod schema for this shape lives in the `./wire` entry, so a consumer that
 * never validates does not load `zod`.
 */
import type { DataViewState } from "./data-views-types";
import type { RangeValue } from "./data-views-range-types";

/** One pill's selection: the field it filters and the option values ticked. */
export interface DataViewPillWire {
  field: string;
  values: string[];
}

/** One range filter's window: the field it bounds and either bound. */
export interface DataViewRangeWire {
  field: string;
  min?: number | string;
  max?: number | string;
}

/** {@link DataViewState} as stored: identical but for `pills` and `ranges`, which are keyed lists. */
export interface DataViewStateWire extends Omit<DataViewState, "pills" | "ranges"> {
  pills: DataViewPillWire[];
  ranges?: DataViewRangeWire[];
}

/** The keys of `value` whose value is not `undefined` — what JSON would keep. */
function definedOnly<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

/** A range window without the bounds it does not set. */
function boundsOf(range: RangeValue | undefined): RangeValue {
  return definedOnly({ min: range?.min, max: range?.max });
}

/**
 * The in-memory state as it is stored: each map becomes a list of keyed
 * entries, in the map's own order, empty selections included (an emptied pill
 * is still the user's choice to save). Keys whose value is `undefined` are
 * dropped, as JSON would drop them.
 */
export function toDataViewStateWire(state: DataViewState): DataViewStateWire {
  const { pills, ranges, ...rest } = state;
  return definedOnly({
    ...rest,
    pills: Object.entries(pills).map(([field, values]) => ({ field, values: [...values] })),
    ranges: ranges
      ? Object.entries(ranges).map(([field, range]) => ({ field, ...boundsOf(range) }))
      : undefined,
  });
}

/** The keyed list as a map; a field listed twice keeps its LAST entry, as an object literal would. */
function mapOf<E extends { field: string }, V>(entries: readonly E[], valueOf: (entry: E) => V): Record<string, V> {
  return Object.fromEntries(entries.map((entry) => [entry.field, valueOf(entry)]));
}

/** The stored shape back in memory — the inverse of {@link toDataViewStateWire}. */
export function fromDataViewStateWire(wire: DataViewStateWire): DataViewState {
  const { pills, ranges, ...rest } = wire;
  return definedOnly({
    ...rest,
    pills: mapOf(pills, (entry) => [...entry.values]),
    ranges: ranges ? mapOf(ranges, (entry) => boundsOf(entry)) : undefined,
  });
}

/** A JSON object, or `null` for anything else. */
function objectOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A stored keyed list's entries that name a field; anything else in it is dropped. */
function keyedEntries(list: readonly unknown[]): Array<Record<string, unknown> & { field: string }> {
  return list.flatMap((item) => {
    const entry = objectOf(item);
    return entry && typeof entry.field === "string" ? [entry as Record<string, unknown> & { field: string }] : [];
  });
}

/** Stored pills in either shape, as the in-memory map (the legacy map passes through as it was). */
export function storedPillsOf(value: unknown): Record<string, string[]> {
  if (Array.isArray(value)) {
    return mapOf(keyedEntries(value), (entry) =>
      Array.isArray(entry.values) ? entry.values.filter((item): item is string => typeof item === "string") : [],
    );
  }
  return (objectOf(value) ?? {}) as Record<string, string[]>;
}

/** Stored ranges in either shape, as the in-memory map (the legacy map passes through as it was). */
export function storedRangesOf(value: unknown): Record<string, RangeValue> {
  if (Array.isArray(value)) {
    return mapOf(keyedEntries(value), (entry) => boundsOf(entry as RangeValue));
  }
  return (objectOf(value) ?? {}) as Record<string, RangeValue>;
}

/**
 * A stored view state in EITHER shape — the legacy maps or the keyed lists —
 * as the in-memory {@link DataViewState}.
 *
 * Converts only `pills` and `ranges`, and only when they are lists; every
 * other key is carried as stored, absent keys stay absent. That is the
 * contract `toSavedViewSummary` always had (it never filled defaults: an
 * absent `visibleColumns` must stay absent so applying the view shows every
 * column), so a legacy view reads back byte-identical.
 */
export function readStoredViewState(raw: unknown): DataViewState {
  const value = objectOf(raw) ?? {};
  const read: Record<string, unknown> = { ...value };
  if (Array.isArray(value.pills)) read.pills = storedPillsOf(value.pills);
  if (Array.isArray(value.ranges)) read.ranges = storedRangesOf(value.ranges);
  return read as unknown as DataViewState;
}
