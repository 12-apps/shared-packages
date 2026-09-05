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
  accuracy: (metres) => `±${Math.round(metres)} m`,
  map: EN_US_MAP_PREVIEW_COPY,
};

/** Three riders around São Paulo, one in each freshness state. */
export const FLEET: FleetUnit[] = [
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
  {
    id: 'caio',
    label: 'Caio Souza',
    latitude: -23.5405,
    longitude: -46.6133,
    accuracyM: null,
    staleSeconds: 640,
  },
];
