import type { JSX } from 'react';

import { routingManifest } from '@12-apps/routing/manifest';
import { routingWebManifest } from '@12-apps/routing/manifest/web';
import { EN_US_ROUTE_MAP_COPY, type RouteMapProps, type RouteMapTheme } from '@12-apps/routing/react';
// The worker MapLibre 6 spawns, emitted as an asset of THIS bundle. The host
// has to hand its URL over: the library cannot find its own worker once a
// bundler has moved it, and that is the one piece of build knowledge the
// package asks for rather than guessing.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

import { webWiringHost } from '../wiring-web';

/**
 * `@12-apps/routing` — the route map, adopted through the wiring consumer's
 * WEB half.
 *
 * What the host supplies is its words (the package's en-US pack, passed by
 * hand), its colours, and the worker URL above. Where the map sits and what
 * it shows are the host's too: the manifest declares no `areas`, because a
 * map belongs inside whatever screen shows the trip. Here that is one demo
 * run — a store, a rider, three stops, the planned line and the part already
 * ridden.
 *
 * The basemap is OpenFreeMap's public style. When it cannot be reached (an
 * offline runner), the package's own error state with its Retry is what
 * renders, which is a state worth seeing too.
 */

const THEME: RouteMapTheme = {
  planned: '#94A3B8',
  travelled: '#2563EB',
  done: '#16A34A',
  next: '#111827',
  pending: '#FFFFFF',
  ink: '#111827',
  paper: '#FFFFFF',
  place: '#111827',
  control: '#FFFFFF',
  controlBorder: '#E5E7EB',
};

const { surface } = webWiringHost.adoptWeb({
  manifest: routingManifest,
  web: routingWebManifest,
  bindings: { surface: { config: { copy: EN_US_ROUTE_MAP_COPY, theme: THEME, workerUrl } } },
});

const { RouteMap } = surface as { RouteMap: (props: RouteMapProps) => JSX.Element };

const STORE = { lng: -46.6333, lat: -23.5505 };
const STOPS: RouteMapProps['stops'] = [
  { id: 'a', position: { lng: -46.6395, lat: -23.5552 }, mark: '1', title: 'Stop 1, delivered', variant: 'done' },
  { id: 'b', position: { lng: -46.6452, lat: -23.5611 }, mark: '2', title: 'Stop 2, next', variant: 'next' },
  { id: 'c', position: { lng: -46.6371, lat: -23.5668 }, mark: '3', title: 'Stop 3', variant: 'pending' },
];

const PLANNED: [number, number][] = [
  [STORE.lng, STORE.lat],
  [-46.6395, -23.5552],
  [-46.6452, -23.5611],
  [-46.6371, -23.5668],
  [STORE.lng, STORE.lat],
];

export function RouteMapPage(): JSX.Element {
  return (
    <div data-testid="page-route-map" style={{ maxWidth: 960 }}>
      <RouteMap
        testId="route-map"
        height={420}
        fitKey="demo-run"
        places={[{ id: 'store', position: STORE, label: 'Store', icon: 'store' }]}
        stops={STOPS}
        planned={PLANNED}
        travelled={[
          [STORE.lng, STORE.lat],
          [-46.6395, -23.5552],
          [-46.6421, -23.5583],
        ]}
        markers={[
          {
            id: 'rider',
            position: { lng: -46.6421, lat: -23.5583 },
            text: 'Alex',
            ariaLabel: 'Alex, on the way',
            color: '#2563EB',
            icon: 'motorbike',
          },
        ]}
      />
    </div>
  );
}
