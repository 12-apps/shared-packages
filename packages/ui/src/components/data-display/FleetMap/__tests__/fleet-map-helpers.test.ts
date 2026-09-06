import { describe, expect, it } from 'vitest';

import {
  freshnessOf,
  mapCentre,
  nextSelection,
  rosterOrder,
} from '../FleetMap.helpers';
import type { FleetUnit } from '../FleetMap.types';

/**
 * The four pure decisions behind the board.
 *
 * They have a fast unit suite as well as the Storybook interaction tests
 * because the BOUNDARIES are where these are wrong, and a boundary is cheap to
 * state here and expensive to stage in a story: an off-by-one on the stale
 * threshold reads identically on screen and means the opposite to a dispatcher.
 */

function unit(over: Partial<FleetUnit> & Pick<FleetUnit, 'id'>): FleetUnit {
  return {
    label: over.id,
    latitude: 0,
    longitude: 0,
    staleSeconds: 0,
    ...over,
  };
}

describe('freshnessOf', () => {
  it('reads a fresh fix as live', () => {
    expect(freshnessOf(0, 90, 300)).toBe('live');
    expect(freshnessOf(89, 90, 300)).toBe('live');
  });

  it('is inclusive at the lagging threshold', () => {
    // A boundary falls somewhere, and this is the side that does not tell a
    // dispatcher somebody is live while they are on the edge of not being.
    expect(freshnessOf(90, 90, 300)).toBe('lagging');
  });

  it('is inclusive at the stale threshold', () => {
    expect(freshnessOf(299, 90, 300)).toBe('lagging');
    expect(freshnessOf(300, 90, 300)).toBe('stale');
  });

  it('collapses cleanly when both thresholds are the same', () => {
    expect(freshnessOf(9, 10, 10)).toBe('live');
    expect(freshnessOf(10, 10, 10)).toBe('stale');
  });
});

describe('mapCentre', () => {
  it('answers null for an empty fleet rather than a coordinate', () => {
    // (0, 0) is a real place in the Atlantic, and a map that quietly sails
    // there is worse than one that says it has nothing to show.
    expect(mapCentre([])).toBeNull();
  });

  it('centres on the selected unit', () => {
    const units = [
      unit({ id: 'a', latitude: 10, longitude: 20 }),
      unit({ id: 'b', latitude: -30, longitude: -40 }),
    ];

    expect(mapCentre(units, 'b')).toEqual({ lat: -30, lng: -40 });
  });

  it('falls back to the centroid when nothing is selected', () => {
    const units = [
      unit({ id: 'a', latitude: 10, longitude: 20 }),
      unit({ id: 'b', latitude: 30, longitude: 40 }),
    ];

    expect(mapCentre(units, null)).toEqual({ lat: 20, lng: 30 });
  });

  it('falls back to the centroid when the selection names nobody in the fleet', () => {
    // A unit can leave the freshness window between a render and a click.
    const units = [unit({ id: 'a', latitude: 10, longitude: 20 })];

    expect(mapCentre(units, 'gone')).toEqual({ lat: 10, lng: 20 });
  });
});

describe('rosterOrder', () => {
  it('sorts freshest first, whatever order the caller passed', () => {
    const units = [
      unit({ id: 'stale', staleSeconds: 400 }),
      unit({ id: 'live', staleSeconds: 5 }),
      unit({ id: 'lagging', staleSeconds: 120 }),
    ];

    expect(rosterOrder(units).map((u) => u.id)).toEqual(['live', 'lagging', 'stale']);
  });

  it('breaks ties on the label, so a poll does not reshuffle the list', () => {
    const units = [
      unit({ id: 'b', label: 'Bruno', staleSeconds: 10 }),
      unit({ id: 'a', label: 'Ana', staleSeconds: 10 }),
    ];

    expect(rosterOrder(units).map((u) => u.label)).toEqual(['Ana', 'Bruno']);
  });

  it('does not mutate the array it was given', () => {
    const units = [unit({ id: 'b', staleSeconds: 20 }), unit({ id: 'a', staleSeconds: 10 })];

    rosterOrder(units);

    expect(units.map((u) => u.id)).toEqual(['b', 'a']);
  });
});

describe('nextSelection', () => {
  const units = [unit({ id: 'a' }), unit({ id: 'b' }), unit({ id: 'c' })];

  it('moves down and up through the list', () => {
    expect(nextSelection(units, 'a', 1)).toBe('b');
    expect(nextSelection(units, 'b', -1)).toBe('a');
  });

  it('wraps at both ends', () => {
    // A selection that sticks at the last row makes the keyboard path feel
    // broken beside the mouse one.
    expect(nextSelection(units, 'c', 1)).toBe('a');
    expect(nextSelection(units, 'a', -1)).toBe('c');
  });

  it('opens at the top on Down and the bottom on Up when nothing is selected', () => {
    expect(nextSelection(units, null, 1)).toBe('a');
    expect(nextSelection(units, null, -1)).toBe('c');
  });

  it('treats a selection that has left the fleet as no selection', () => {
    expect(nextSelection(units, 'gone', 1)).toBe('a');
  });

  it('answers null for an empty fleet, so the page keeps its arrow keys', () => {
    expect(nextSelection([], null, 1)).toBeNull();
    expect(nextSelection([], 'a', -1)).toBeNull();
  });
});
