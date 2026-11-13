# DataViews — a saved view's stored shape

A saved view captures a `DataViewState`. In memory its two filter maps are keyed by
field id, and that is the shape every control reads and writes:

```ts
pills: Record<string, string[]>          // fieldId → ticked option values
ranges?: Record<string, RangeValue>      // fieldId → { min?, max? }
```

Stored as it is, each map is a record keyed by ANY string. A host whose rule is that
every request input is closed at every depth (no non-strict object, no `z.unknown()`,
no record keyed by any string) cannot accept that: nothing says which keys exist. The
**wire shape** (FUT-4867) carries the same facts as keyed lists, with every key declared:

```ts
pills: { field: string; values: string[] }[]
ranges?: { field: string; min?: number | string; max?: number | string }[]
```

Every other key of the state (`search`, `sortBy`, `visibleColumns`, `order`, `scope`,
`layout`) is the same in both shapes.

## The API

From `@12-apps/ui/data-display/DataViews` (no `zod` needed):

| Export | What |
|---|---|
| `toDataViewStateWire(state)` | in-memory → wire; lists keep the map's order, empty selections are kept, `undefined` keys dropped |
| `fromDataViewStateWire(wire)` | wire → in-memory; a field listed twice keeps its last entry |
| `readStoredViewState(raw)` | a stored state in EITHER shape → in-memory; converts `pills`/`ranges` only when they are lists, carries everything else as stored and fills no defaults |
| `DataViewStateWire`, `DataViewPillWire`, `DataViewRangeWire` | the types |

From `@12-apps/ui/data-display/DataViews/wire` (needs `zod`, an optional peer):

| Export | What |
|---|---|
| `dataViewStateWireSchema` | the wire shape as a zod schema, strict at every depth — no open place; refuses the legacy maps |
| the converters and types above | re-exported, so one import serves a host's route |

## What the component does — and does not — change

**The component still emits the in-memory shape.** `DataViewSaveInput.state` handed to
the host's `persistence.create/update` is a `DataViewState`, exactly as before. Changing
it would be a breaking change for every consumer: hosts read that state as maps (a server
query built from `state.pills`, a key built from `state.ranges`), and a host's backend
that stores and validates the old shape would start receiving a shape it does not know.
So the switch is the host's, at its persistence seam:

```ts
import { toDataViewStateWire } from '@12-apps/ui/data-display/DataViews';

const body = { scope, name, …, state: toDataViewStateWire(input.state) };
```

and on its route:

```ts
import { dataViewStateWireSchema } from '@12-apps/ui/data-display/DataViews/wire';

const createSavedViewBody = z.strictObject({ scope, name, …, state: dataViewStateWireSchema });
```

**Reading takes both shapes, everywhere.** `toSavedViewSummary` returns the in-memory
shape for a legacy row and for a wire row alike, and applying a view (`coerceViewState`,
used by the saved-views controller) does the same — so every view stored before the
switch keeps applying, and a host can rewrite its rows (or not) on its own schedule.

A host moving its stored rows is an expand-and-contract: first read both shapes (this
release does) and write the wire shape; only once no client can still send the legacy
maps does the route refuse them with `dataViewStateWireSchema`.
