# RegionMap

A hand-drawn map of named **areas** around a centre — polygons with holes,
drawn as inline SVG — where a tap toggles an area's `excluded` state.

Product-free. An area is a bairro, a delivery zone, a sales territory or a
parking sector alike; coordinates are plain latitude/longitude, and every word
arrives through `copy`. Built for "which bairros does this store not deliver
to" (Future Pay, FUT-2729) and deliberately not named after it.

## Use cases

- Picking which neighbourhoods inside a delivery radius are left out.
- Marking territories, zones or sectors on/off around a point.
- Showing a read-only picture of which areas are in and out (omit `onToggle`).

## Decisions that shape the API

### No tiles, no key, nothing fetched

The question is "which of THESE areas", not "what is this street called", so
the drawing is the areas themselves over a plain background. That keeps it
free of a tile provider, an API key and a network request, and it renders the
same in a test as on a phone. `MapPreview` is the component for a real map.

### The list is the accessible way in

The drawing is ONE `role="img"` with `copy.mapLabel`; its areas are not tab
stops. Real areas are many and some are far too small to tap on a phone (IBGE
outlines 11 of the 48 bairros inside a 3 km ring in one Belo Horizonte
neighbourhood at under 0.1 km²). Every area is also a toggle button in the list
beneath (`aria-pressed`), which is what a keyboard and a screen reader use, and
what reaches a sliver no finger can. `listMode` decides how it is offered:
`shown` (a computer), `collapsed` behind one button that names the count (a
phone), or `none` for a host that renders its own.

### Excluded is hatched AND named, never only coloured

An excluded area gets a hatch, a darker edge and its name on the map, and a
pressed, filled row with a check in the list. Colour is never the only signal,
and the error colour is never used: leaving an area out is a choice, not a
failure. The highlighted area (`highlightedId`, e.g. a search result) uses the
primary colour and is named too.

### Our hit test, not only the browser's

A tap on an area's path is that area: the browser hit-tests the even-odd fill,
and areas are drawn largest first, so an area sitting in another's hole is on
top. A tap that lands on no fill — a border line, beside a sliver — takes the
nearest area within ~2% of the view (`hitRegion`), so a sliver can still be
reached from the map. A tap on empty map toggles nothing.

### Strokes and type stay their size at every width

Strokes use `vector-effect: non-scaling-stroke`, and labels are HTML laid over
the drawing at theme sizes, so the map reads the same at 320 px and at 1600 px.
The drawing is square; `maxHeight` caps it on a wide screen and centres it.

## Props

| prop | type | default | what it does |
|---|---|---|---|
| `regions` | `readonly RegionMapRegion[]` | — | the areas; drawn when any part is in view |
| `center` | `{ latitude, longitude } \| null` | — | centre, dot and circles; `null` centres on the areas, no dot |
| `circles` | `readonly { radiusMetres }[]` | `[]` | dashed circles; the view fits the largest |
| `onToggle` | `(id: string) => void` | — | a tap or a list press; omit for read-only |
| `highlightedId` | `string \| null` | `null` | an area to point at, outlined and named |
| `copy` | `RegionMapCopy` | — | every word |
| `listMode` | `'shown' \| 'collapsed' \| 'none'` | `'collapsed'` | how the list is offered |
| `maxHeight` | `string` | — | the drawing's largest height, any CSS length |
| `className` | `string` | — | on the root |
| `dataTestId` | `string` | `'region-map'` | every child test id derives from it |

### `RegionMapRegion`

```ts
{
  id: string;
  name: string;
  rings: readonly (readonly [latitude, longitude])[][]; // even-odd: holes are rings
  excluded?: boolean;
  outside?: boolean;  // drawn faded (context beyond the circles); still tappable
  detail?: string;    // pre-formatted, on the list row: "2.7 km away"
}
```

### `RegionMapCopy`

`mapLabel`, `legendExcluded`, `legendCircle(radiusMetres)`, `legendCenter`,
`listLabel`, `showList(count)`, `hideList`.

## Helpers

- `decodePolyline(encoded, precision = 1e5)` — Google's encoded polyline into
  `[latitude, longitude]` points; outlines usually travel this way.
- `hitRegion(regions, point, tolerance)` and `projectionAt(center)` — the hit
  test and projection the component uses, for a host that draws its own layer.

## Example

```tsx
<RegionMap
  regions={bairros.map((b) => ({
    id: b.code,
    name: b.name,
    rings: b.outline.split(';').flatMap((p) => p.split(',')).map((r) => decodePolyline(r)),
    excluded: excluded.has(b.code),
    detail: b.distanceLabel,
  }))}
  center={store}
  circles={rings.map((r) => ({ radiusMetres: r.maxDistanceMetres }))}
  onToggle={toggle}
  highlightedId={searchHit}
  copy={copy}
  listMode={isPhone ? 'collapsed' : 'shown'}
/>
```

## Not here (yet)

- Zoom and pan. The list covers the areas too small to tap.
- A React Native build.
