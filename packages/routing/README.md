# @12-apps/routing

Road routes through an ordered list of stops, and a map that draws them.

- **The routing service is configuration.** A host lists the providers it
  wants, in order: openrouteservice, OSRM, Google Routes, or its own adapter.
  The planner keeps the first one that answers.
- **There is always a route.** When every provider fails, times out or is not
  configured, the answer is straight segments between the points, flagged
  `fallback: true`. It has distances and no durations, because a time computed
  from a straight line would be an invention.
- **The map draws what it is given.** `RouteMap` (MapLibre GL, OpenFreeMap by
  default) renders markers, places, numbered stops, a dashed planned line and
  a solid travelled line. It fetches nothing, and every word and colour comes
  from the host.

## Server

```ts
import { createApiRouting, openRouteServiceProvider, osrmProvider } from "@12-apps/routing/server";

const routing = createApiRouting({
  providers: [
    openRouteServiceProvider({ apiKey: secrets.ROUTING_ORS_API_KEY }),
    osrmProvider({ baseUrl: secrets.ROUTING_OSRM_URL }),
  ],
  timeoutMs: 6_000,
  authorize: (actor) => actor.canPlanRoutes,
});

// In-process (a job that saves a trip's route):
const route = await routing.planRoute({ origin: shop, stops: [a, b], returnTo: shop });
// route.geometry, route.legs[i].durationS (null on fallback), route.provider, route.fallback

// Or mount `routing.routes` (one POST /route) behind your own router.
```

The planner keeps the stop order it is given; sequencing stops is the host's
job. It never throws for provider trouble. It throws `RouteRequestError` only
for a request that cannot be routed (fewer than two points, or an invalid
point or 0,0) and for a provider listed twice.

### Adding a provider

Implement `RoutingProvider`:

```ts
const myProvider: RoutingProvider = {
  name: "my-service",
  async route(request, { fetch, signal }) {
    // …call the service with `fetch` and `signal`…
    return { ok: true, geometry, legs }; // or { ok: false, kind: "http", status }
  },
};
```

Add it to the host's list. Nothing else changes.

### Google Routes

Google's Maps Platform terms do not allow its route content to be displayed on
a non-Google map. Do not list `googleRoutesProvider` if you draw with
`RouteMap` over OpenFreeMap or any other non-Google basemap.

## Web

```tsx
import { createWebRouting, ROUTE_MAP_COPY } from "@12-apps/routing/react";

const { RouteMap } = createWebRouting({
  copy: ROUTE_MAP_COPY["pt-BR"],
  theme: { planned, travelled, done, next, pending, ink, paper, place, control, controlBorder },
});

<RouteMap
  height={480}
  markers={couriers.map((c) => ({ id: c.id, position: c.point, text: c.initials, ariaLabel: c.label, color: c.color, onSelect: () => select(c.id) }))}
  places={[{ id: "shop", position: shop, label: "Loja" }]}
  stops={stops}
  planned={route?.geometry}
  travelled={fixes}
  fitKey={tenantSlug}
/>;
```

- `travelledParts` draws the solid line as separate strokes (a track with a
  gap that must not be bridged by a straight line); it wins over `travelled`.
- `maplibre-gl` is an optional peer dependency: install it in the web host.
  It is imported the first time a map mounts, so a page without a map never
  downloads it.
- The map fits its content once, and again only when `fitKey` changes or the
  fit control is pressed. A data refresh never moves a map someone panned.
- Markers that overlap on screen fold into one group button. `onGroupSelect`
  receives their ids; without that callback, the map zooms in on them.
- `focus={{ key, points }}` fits to just those points (a selected trip)
  whenever `key` changes — a viewer's selection, never a refresh.
  `focus={{ key, points, zoom: 16 }}` centres on their bounds at exactly that
  zoom instead, inside the same padding and `insets` a fit keeps clear (far-apart
  points may fall outside the frame; a new `zoom` under the same `key` does
  nothing): a fit pads a lone point to a few hundred metres and keeps the
  controls clear, which on a small map stops short of the street.
- `insets={{ bottom: legendHeight }}` tells the fit what the host's own
  overlays cover, so fitted pins never land under a legend or a sheet.
- For a small map (a card): `placeLabels="at-point"` draws a place's label on
  its point instead of lifted above a pin, and `attribution="compact"` folds
  the basemap credit into an "i" that opens it.
- A stop with `emphasized: true` (the one the screen is about) is drawn above
  the pins; other stops sit beneath them.
- A marker's (or group's) tag — its pill and tail — steps aside from stop
  badges and place labels (`tagPlacement="avoid"`, the default). After every
  draw, fit, pan and zoom it keeps its current side while that is clear;
  otherwise it takes the first clear side of its pin in the order above,
  below, right, left (a side other than the current one must be clear by a
  few pixels, so a jittering GPS fix never flips it), and when every side is
  blocked, the least-covering one. A stop or place under the pin's own point
  (a courier arriving) does not count. Stops, places and the pin's point never
  move; the tail follows the side, and the element is restyled in place, so
  keyboard focus survives. `tagPlacement="fixed"` keeps every tag above, as
  before this release.
- **DOM change:** every marker and group element now carries
  `data-tag-side="above|below|right|left"` (in both modes), so a host's DOM
  snapshot of the map gains that attribute. A host's own `loadMapLibre` fake
  needs `Marker#setOffset` for a tag to move.
- `controls={{ placement: "top-left" }}` moves the zoom and fit column to the
  other top corner when the host's floating chrome covers the top-right.
- **A draggable place:** `places={[{ id, position, label, draggable: { ariaLabel, onMove, onDrop } }]}`
  turns the place into a pin the viewer drags (mouse or one finger; MapLibre's
  own marker drag) or focuses and nudges with the arrow keys (5 m from zoom 15,
  50 m below it; `stepMetres(zoom)` overrides). The host owns the position:
  `onMove` reports every move, `onDrop` where it came to rest, and the host
  passes the position back. The element is kept across moves, so focus stays.
  `disabled: true` holds it (a save in flight).
- **Circles and dots:** `circles={[{ id, center, radiusMetres, dashed? }]}`
  draws rings on the ground (solid and faintly filled in `theme.travelled`, or
  dashed in `theme.ink`), redrawn whenever the array changes, so a host that
  moves a centre with a dragged pin redraws its rings live; "fit all" includes
  them. `dots={[{ id, position, filled }]}` draws small points under the pins,
  filled with `theme.ink` or hollow. A map with neither adds no layer for them.
- **A place's colour, ghost places and tethers:** `color` on a place fills its
  draggable pin (over `theme.travelled`), its label (over `theme.place`) or a
  ghost's ring and label (over `theme.ink`), e.g. with the host's brand colour. `ghost: true` draws a reference position (where
  a pin was, or would be) as a dashed hollow ring with a quiet label, never a
  pin. `tethers={[{ id, from, to, color? }]}` draws thin dashed segments in
  `theme.ink` with the circles; "fit all" leaves them out.
- `copy={{ fitAll: "…" }}` overrides the surface's words for one mount;
  `controls={{ zoomWhenNarrow: true }}` keeps the zoom buttons under 600 px,
  where they are hidden by default; `onZoomChange(zoom)` reports the zoom once
  ready and after every zoom.
- `controls={{ fitAsText: true }}` draws the fit control as its word
  (`copy.fitAll`) instead of the corners glyph.
- `controls={{ onZoomOut }}` replaces what the zoom-out control does (a host
  leaving a street view for its own wider map); wheel and pinch still zoom.
- `scaleBar={(metres) => "100 m"}` draws a scale bar bottom-left: the longest
  nice distance (50 m … 50 km) within a quarter of the map's width, re-measured
  after every pan and zoom. A host fake needs `getZoom` and `getCenter`.
- No WebGL, a library or style that does not arrive within `readyTimeoutMs`
  (default 15 s), shows `copy.mapError` with a retry. The region's
  `data-state` reads `loading`, `ready` or `error`. The host's `overlay` is
  hidden while the error shows — the error panel carries its own retry.

## Wiring

`./manifest` declares `server: ["http"]` and `web: ["surface"]`. `http.create`
is `createApiRouting` and `surface.create` is `createWebRouting`.
