import React from 'react';

import { mapCentre, nextSelection, rosterOrder, type LatLng } from './FleetMap.helpers';
import type { FleetUnit } from './FleetMap.types';

/**
 * Everything the board derives from its props, in one hook.
 *
 * Split out of the component so the component is layout and nothing else — and
 * because these four are the parts worth memoising: `units` arrives as a fresh
 * array on every poll, so re-sorting and re-projecting it on each render would
 * hand the map a new `markers` identity every few seconds and make it redraw
 * for no change.
 */

/** One pin, in the shape `MapPreview` takes. */
export interface FleetMarker {
  position: LatLng;
  title: string;
  onClick: () => void;
}

export interface FleetMapState {
  /** The units, freshest first — see {@link rosterOrder}. */
  ordered: FleetUnit[];
  /** Where the map points, or `null` when there is nothing to show. */
  centre: LatLng | null;
  select: (id: string) => void;
  markers: FleetMarker[];
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
}

export function useFleetMap(
  units: readonly FleetUnit[],
  selectedId: string | null | undefined,
  onSelect: ((id: string) => void) | undefined,
): FleetMapState {
  const ordered = React.useMemo(() => rosterOrder(units), [units]);
  const centre = React.useMemo(() => mapCentre(ordered, selectedId), [ordered, selectedId]);
  const select = React.useCallback((id: string) => onSelect?.(id), [onSelect]);

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
      if (step === 0) return;
      const next = nextSelection(ordered, selectedId, step);
      // `preventDefault` only once a move is certain, so the page still scrolls
      // with the arrow keys when the list is empty and there is nothing to move.
      if (next === null) return;
      event.preventDefault();
      select(next);
    },
    [ordered, selectedId, select],
  );

  const markers = React.useMemo(
    () =>
      ordered.map((unit) => ({
        position: { lat: unit.latitude, lng: unit.longitude },
        title: unit.label,
        onClick: () => select(unit.id),
      })),
    [ordered, select],
  );

  return { ordered, centre, select, markers, onKeyDown };
}
