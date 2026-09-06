import { EN_US_MAP_PREVIEW_COPY } from '../../../en-US.data-display';

import type { FleetMapCopy, FleetUnit } from './FleetMap.types';

/**
 * The copy and the fleet every story and test story shares.
 *
 * A module rather than a per-story literal, so a change to the shape breaks in
 * ONE place rather than in fourteen — and so the test stories assert against
 * the same words the visual ones render.
 */

/** English, because stories are developer-facing. A consumer passes its own. */
export const FLEET_COPY: FleetMapCopy = {
  title: 'Couriers on the road',
  emptyTitle: 'Nobody is reporting',
  emptyDescription: 'A courier appears here once their phone sends its first position.',
  rosterLabel: 'Couriers, freshest first',
  mapLabel: 'Map of where the couriers are',
  freshness: { live: 'Live', lagging: 'Lagging', stale: 'Stale' },
  lastSeen: (seconds) =>
    seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)} min ago`,
  // A NON-BREAKING space between the number and its unit. The meta line is
  // the narrowest text in the component and it wraps at spaces, so a plain
  // space orphans the `m` onto a line of its own — measured at 900px and
  // 1920px, where the roster column is at its tightest relative to the map.
  // Consumers writing their own `accuracy` want the same character.
  accuracy: (metres) => `±${Math.round(metres)}\u00A0m`,
  map: EN_US_MAP_PREVIEW_COPY,
};

/**
 * Three riders around São Paulo, one in each freshness state.
 *
 * Deliberately NOT in staleness order, and the labels deliberately do not agree
 * with it either. `rosterOrder` sorts on staleness and breaks ties on the
 * label, so a fixture whose two orders coincide lets the roster's ordering
 * assertion pass against a LABEL-only sort as readily as the real one — a test
 * reporting coverage it does not have. Here the three orders are all different:
 * declared is [ale, ana, bruno], alphabetical is the same, and the correct
 * answer is [ana, bruno, ale].
 */
export const FLEET: FleetUnit[] = [
  {
    id: 'ale',
    label: 'Alessandra Nunes',
    latitude: -23.5405,
    longitude: -46.6133,
    accuracyM: null,
    staleSeconds: 640,
  },
  {
    id: 'ana',
    label: 'Ana Ribeiro',
    latitude: -23.5505,
    longitude: -46.6333,
    accuracyM: 12,
    staleSeconds: 8,
    badge: '2 deliveries',
  },
  {
    id: 'bruno',
    label: 'Bruno Alves',
    latitude: -23.5605,
    longitude: -46.6533,
    accuracyM: 180,
    staleSeconds: 140,
    badge: '1 delivery',
  },
];
