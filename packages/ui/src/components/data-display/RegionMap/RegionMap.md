# RegionMap

A hand-drawn map of named **areas** around a centre — polygons with holes,
drawn as inline SVG — where a tap toggles an area's `excluded` state.

Product-free. An area is a bairro, a delivery zone, a sales territory or a
parking sector alike; coordinates are plain latitude/longitude, and every word
arrives through `copy`. Built for a delivery host's "which neighbourhoods does this store not
deliver to", and deliberately not named after it.

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
beneath (`aria-pressed`, plus its state in words from `copy.rowState`), which
is what a keyboard and a screen reader use, and what reaches a sliver no finger
can. `listMode` decides how it is offered:
`shown` (a computer), `collapsed` behind one button that names the count (a
phone), or `none` for a host that renders its own.

The list holds only the areas in reach: an `outside` area is drawn faded on the
map for context but has no row unless `listed: true`, and the count matches the
rows. `listSort: 'name'` orders it by name; `detail` carries a distance or a
size tag ("tiny") for an area too small to tap.

### Excluded is hatched AND named, never only coloured

An excluded area gets a hatch, a darker edge and its name on the map, and a
pressed, filled row with a check in the list, whose inverted colours hold under
hover and keyboard focus, with a focus ring. Colour is never the only signal,
and the error colour is never used: leaving an area out is a choice, not a
failure. The highlighted areas (`highlightedIds`, e.g. a search's hits — several
at once) use the primary colour and are named too.

### Our hit test, not only the browser's

A MOUSE click on an area's path is that area: the browser hit-tests the
even-odd fill, and areas are drawn largest first, so an area in another's hole
is on top. A finger's (or pen's) tap goes to `hitRegion`: the SMALLEST area
within ~2% of the view (about 8 px on a phone), the ones holding the tap
included — so a strip a few metres wide beside a big area can be hit from the
map, and the big one stays easy to hit everywhere else. A tap on empty map
toggles nothing. An area too thin even for that is on the list.

### A toggle is cheap

Geometry is projected once per `rings` array identity and centre, so a host
that rebuilds its region objects on every toggle (`{ ...area, excluded }`) but
keeps their `rings` re-projects nothing. The base areas are a memoised layer: a
toggle re-renders only the hatch, highlight and label layers. Measured on 102
areas of 300 vertices each at 4× CPU throttle: 18–46 ms from tap to commit.

### Strokes and type stay their size at every width

Strokes use `vector-effect: non-scaling-stroke`, and labels are HTML laid over
the drawing at theme sizes, moved in by their measured width so none is
clipped at an edge — the map reads the same at 320 px and at 1600 px. The
drawing is square; `maxHeight` caps it on a wide screen, and where it sits in a
wider box is the host's call.

### A host can draw inside it, at its scale

A host often has something of its own to show over the areas — a band served
past the largest circle, a route, a marker — and laying a second SVG over the
drawing means copying its view math and losing its frame. So:

- `reach` (`{ radiusMetres }` or `{ bounds }`) is an extent the view must ALSO
  fit, before the 12% margin. With circles the view stays centred on the centre
  and grows to the reach's farthest edge, so a ring stays a circle in the
  middle; without circles the view fits the areas and the reach together. A
  reach no radius describes — the outlines of some areas — is a box:
  `boundsOfRings(rings)`. Omit it and the view is exactly what it was.
- `overlay(layer)` draws inside the SVG with `layer.view` and
  `layer.projection` (`projectionAt(center)`), over the excluded hatch and
  under the circles, highlights and centre. It sits in a `pointer-events: none`
  group, so a tap still reaches the area beneath.
- `regionMapView(props)` returns the same view for HTML laid over the drawing
  (a pill on a circle, a note): a point `p` sits at `(p.x - view.minX) /
  view.spanX` across; with circles the view is centred and its half-side is
  `view.spanX / 2`.

## Props

| prop | type | default | what it does |
|---|---|---|---|
| `regions` | `readonly RegionMapRegion[]` | — | the areas; drawn when any part is in view |
| `center` | `{ latitude, longitude } \| null` | — | centre, dot and circles; `null` centres on the areas, no dot |
| `circles` | `readonly { radiusMetres }[]` | `[]` | dashed circles; the view fits the largest |
| `reach` | `{ radiusMetres } \| { bounds: { south, west, north, east } }` | — | an extent the view must also fit (margin on top) |
| `overlay` | `(layer: { view, projection }) => ReactNode` | — | a host layer inside the SVG, under the circles, tap-transparent |
| `onToggle` | `(id: string) => void` | — | a tap or a list press; omit for read-only |
| `highlightedIds` | `readonly string[]` | `[]` | areas to point at (a search's hits), outlined and named |
| `copy` | `RegionMapCopy` | — | every word |
| `listMode` | `'shown' \| 'collapsed' \| 'none'` | `'collapsed'` | how the list is offered |
| `listSort` | `'given' \| 'name'` | `'given'` | the list's order |
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
  listed?: boolean;   // has a list row; defaults to !outside
  detail?: string;    // pre-formatted, on the list row: "2.7 km away", "tiny"
}
```

### `RegionMapCopy`

`mapLabel`, `legendExcluded`, `legendCircle(radiusMetres)`, `legendCenter`,
`listLabel`, `showList(count)` (the count of LISTED areas), `hideList`, and
`rowState: { excluded, outside }` — a row's state in words, for a screen reader.

## Helpers

- `decodePolyline(encoded, precision = 1e5)` — Google's encoded polyline into
  `[latitude, longitude]` points; outlines usually travel this way.
- `hitRegion(regions, point, tolerance)` and `projectionAt(center)` — the hit
  test and projection the component uses, for a host that draws its own layer.
- `regionMapView({ regions, center, circles, reach })` — the view the
  component shows for those props, in projected metres, for HTML laid over it.
- `boundsOfRings(rings)` — the latitude/longitude box around some outlines,
  for a `reach` no radius describes.

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
  highlightedIds={searchHits}
  copy={copy}
  listMode={isPhone ? 'collapsed' : 'shown'}
/>
```

## Not here (yet)

- Zoom and pan. The list covers the areas too small to tap.
- A React Native build.
