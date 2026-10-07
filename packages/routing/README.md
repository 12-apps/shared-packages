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

- `maplibre-gl` is an optional peer dependency: install it in the web host.
  It is imported the first time a map mounts, so a page without a map never
  downloads it.
- The map fits its content once, and again only when `fitKey` changes or the
  fit control is pressed. A data refresh never moves a map someone panned.
- Markers that overlap on screen fold into one group button. `onGroupSelect`
  receives their ids; without that callback, the map zooms in on them.
- No WebGL, or a style that does not load, shows `copy.mapError` with a retry.

## Wiring

`./manifest` declares `server: ["http"]` and `web: ["surface"]`. `http.create`
is `createApiRouting` and `surface.create` is `createWebRouting`.
