import type { BuilderDraft } from "./builder-model";
import type { ReportGrain } from "./reports-api";

/**
 * The draft's two dimension slots, read by MEANING rather than by index
 * (FUT-391).
 *
 * The stored shape is an array — `dimensions[1]` IS splitBy — but the two slots
 * do different things: slot 0 buckets the rows, slot 1 divides each bucket into
 * a series. Presenting them as "Dimensão 1" and "Dimensão 2" said they were the
 * same kind of choice, which is why the form had three unlabelled selects in a
 * row.
 */

interface DimensionSlot {
  field: string;
  timeGrain: ReportGrain;
}

const EMPTY: DimensionSlot = { field: "", timeGrain: "day" };

/** Slot `index`, or an empty one — the form always renders both. */
export function dimensionAt(draft: BuilderDraft, index: number): DimensionSlot {
  return draft.dimensions[index] ?? EMPTY;
}

/**
 * Patch one slot and re-serialize both.
 *
 * Clearing the AXIS drops the split too, rather than letting `dimensions[1]`
 * slide into index 0. The author removed the grouping, not the series — and a
 * silent promotion would change what the block MEANS (a split with no axis is
 * a different question) without them touching that control.
 */
export function withDimension(
  draft: BuilderDraft,
  index: number,
  patch: Partial<DimensionSlot>,
): Pick<BuilderDraft, "dimensions"> {
  const slots: DimensionSlot[] = [dimensionAt(draft, 0), dimensionAt(draft, 1)];
  slots[index] = { ...slots[index]!, ...patch };

  const axis = slots[0]!;
  const split = slots[1]!;
  if (axis.field === "") return { dimensions: [] };
  return { dimensions: split.field === "" ? [axis] : [axis, split] };
}
