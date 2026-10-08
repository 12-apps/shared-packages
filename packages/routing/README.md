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
- No WebGL, a library or style that does not arrive within `readyTimeoutMs`
  (default 15 s), shows `copy.mapError` with a retry. The region's
  `data-state` reads `loading`, `ready` or `error`. The host's `overlay` is
  hidden while the error shows — the error panel carries its own retry.

## Wiring

`./manifest` declares `server: ["http"]` and `web: ["surface"]`. `http.create`
is `createApiRouting` and `surface.create` is `createWebRouting`.
