import { defineFeatures } from '../core/registry';
import { definePlans } from '../core/plans';

/**
 * The catalog the unit suites resolve against.
 *
 * It used to be a Future-Pay-shaped one — its feature keys, its tier names,
 * its descriptions — which made every assertion in this package read as a
 * statement about one application's product. The SHAPE is what these suites
 * are actually about, so it is kept exactly (a `hide` boolean, a `disable`
 * boolean, a `readonly` quota, an opt-in write gate, a read path that survives
 * dunning) and dressed in a domain this package has no relationship with.
 *
 * The portability suites use a THIRD, unrelated vocabulary again, on purpose:
 * two catalogs that shared words would let a leak hide in the overlap.
 */
export const FEATURES = defineFeatures({
  // Boolean capability, surface disappears when revoked.
  'forecast.history': { onRevoke: 'hide', description: 'Histórico de previsões' },
  // Boolean capability, existing hooks deactivate but are retained.
  'alerts.webhook': { onRevoke: 'disable', description: 'Alertas por webhook' },
  // Numeric quota, existing rows stay usable when the plan shrinks.
  'stations.online': { kind: 'quota', onRevoke: 'readonly' },
  // Gates writes, so an entitled tenant opts in deliberately.
  'calibration.review': { onRevoke: 'disable', defaultWhenEntitled: false },
  // A delinquent tenant must keep reading their own measurements.
  'readings.read': { onRevoke: 'hide', retainWhenRestricted: true },
} as const);

export type AppFeature = (typeof FEATURES.list)[number];

export const PLANS = definePlans(FEATURES, {
  hobby: {
    entitlements: { 'readings.read': true, 'stations.online': 1 },
    description: 'Hobby',
  },
  station: {
    extends: 'hobby',
    entitlements: { 'alerts.webhook': true, 'stations.online': 5 },
    description: 'Station',
  },
  network: {
    extends: 'station',
    entitlements: {
      'forecast.history': true,
      'calibration.review': true,
      'stations.online': 'unlimited',
    },
    description: 'Network',
  },
} as const);
