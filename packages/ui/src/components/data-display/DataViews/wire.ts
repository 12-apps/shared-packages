/**
 * `@12-apps/ui/data-display/DataViews/wire` — a saved view's stored shape as a
 * zod schema with no open place (FUT-4867), beside the converters.
 *
 * Its own entry because it is the only part of DataViews that needs `zod`, an
 * OPTIONAL peer of this package: the component and the converters load
 * without it.
 *
 * ```ts
 * import { dataViewStateWireSchema, toDataViewStateWire } from '@12-apps/ui/data-display/DataViews/wire';
 *
 * // the host's persistence seam writes the keyed lists…
 * const body = { …, state: toDataViewStateWire(input.state) };
 * // …and its route validates them, closed at every depth
 * const createSavedViewBody = z.strictObject({ …, state: dataViewStateWireSchema });
 * ```
 *
 * Reading never needs this schema: `toSavedViewSummary` and applying a view
 * take the legacy maps AND these lists, so rows stored before the switch keep
 * working while the host rewrites them.
 */
import { z } from "zod";

import type { DataViewsLayout } from "./data-views-types";
import type { DataViewStateWire } from "./data-views-wire";

export {
  toDataViewStateWire,
  fromDataViewStateWire,
  readStoredViewState,
  type DataViewStateWire,
  type DataViewPillWire,
  type DataViewRangeWire,
} from "./data-views-wire";

/** A range bound: a number for a `number` field, an `AAAA-MM-DD` day for a `day` one. */
const rangeBound = z.union([z.number(), z.string()]);

/** Every layout this build renders, as a closed enum (`DATA_VIEWS_LAYOUTS`'s values). */
const layoutSchema = z.enum(["cards", "list", "board", "table"]) satisfies z.ZodType<DataViewsLayout>;

/**
 * A saved view's state as stored: strict at every depth, every key declared.
 * `pills` and `ranges` are keyed lists (`{ field, … }`), never records keyed by
 * any string — the shape {@link toDataViewStateWire} writes.
 *
 * @request-input — a host validates a saved view's create/update body with it.
 */
export const dataViewStateWireSchema = z.strictObject({
  search: z.string(),
  pills: z.array(z.strictObject({ field: z.string().min(1), values: z.array(z.string()) })),
  ranges: z
    .array(
      z.strictObject({
        field: z.string().min(1),
        min: rangeBound.optional(),
        max: rangeBound.optional(),
      }),
    )
    .optional(),
  sortBy: z.array(z.strictObject({ id: z.string(), dir: z.enum(["asc", "desc"]).nullable() })),
  visibleColumns: z.array(z.string()),
  order: z.array(z.string()).optional(),
  scope: z.string().optional(),
  layout: layoutSchema.optional(),
}) satisfies z.ZodType<DataViewStateWire>;
