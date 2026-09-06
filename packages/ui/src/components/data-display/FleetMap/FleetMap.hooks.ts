import React from 'react';

import { mapCentre, nextSelection, rosterOrder, type LatLng } from './FleetMap.helpers';
import type { FleetUnit } from './FleetMap.types';

/**
 * Everything the board derives from its props, in one hook.
 *
 * Split out of the component so the component is layout and nothing else.
 *
 * The memos are honest about what they buy, which is less than it looks. `units`
 * arrives as a fresh array on every poll, so `ordered` and `markers` are
 * recomputed on every poll whatever these do — a new array is a new identity.
 * What they buy is stability across the renders a poll does NOT cause: a parent
 * re-render, a selection change (which re-runs `centre` but not `ordered`), a
 * theme flip. Sorting a fleet is cheap either way; this is tidiness, not a
 * measured win, and it should not be read as one.
 *
 * `centre` is the exception, and there it is load-bearing rather than tidy —
 * see {@link useFleetMap}.
 *
 * ## Selection works with, without, or half-way through a handler
 *
 * `selectedId` and `onSelect` are both optional, so all four combinations
 * arrive. Left purely controlled, the two useful ones broke: with neither prop
 * the roster was a listbox that answered nothing, and arrowing it called
 * `preventDefault` before a no-op `select`, so the keys did not move a
 * selection AND did not scroll the page either.
 *
 * So the hook keeps its own selection and defers to `selectedId` only when the
 * caller passes one — the ordinary controlled/uncontrolled split, the same one
 * an `<input>` makes. `onSelect` still fires either way, so a consumer can
 * observe the selection without owning it.
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
  /**
   * The selection in force — the caller's when they own it, this hook's when
   * they do not. Everything downstream reads THIS and never the raw prop.
   */
  active: string | null;
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

  // `undefined` means "you own this"; `null` is a caller explicitly selecting
  // nobody, and is controlled like any other value.
  const controlled = selectedId !== undefined;
  const [own, setOwn] = React.useState<string | null>(null);
  const active = controlled ? selectedId : own;

  const select = React.useCallback(
    (id: string) => {
      if (!controlled) setOwn(id);
      onSelect?.(id);
    },
    [controlled, onSelect],
  );

  // Memoised on the COORDINATES and not the object, because `mapCentre` builds
  // a fresh literal every call and `MapPreview` re-centres from an effect keyed
  // on `center`'s identity. A poll that changes nothing would otherwise hand it
  // a new object, and the map would jump back to the centroid — throwing away a
  // pan the dispatcher had just made, on a timer, for as long as they watch it.
  const raw = mapCentre(ordered, active);
  const lat = raw?.lat ?? null;
  const lng = raw?.lng ?? null;
  const centre = React.useMemo(
    () => (lat === null || lng === null ? null : { lat, lng }),
    [lat, lng],
  );

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
      if (step === 0) return;
      // Nothing can move a CONTROLLED selection without a handler, so the keys
      // belong to the page. Swallowing them there left a keyboard user unable to
      // move the selection and unable to scroll past the roster.
      if (controlled && !onSelect) return;
      const next = nextSelection(ordered, active, step);
      // `preventDefault` only once a move is certain, so the page still scrolls
      // with the arrow keys when the list is empty and there is nothing to move.
      if (next === null) return;
      event.preventDefault();
      select(next);
    },
    [ordered, active, select, controlled, onSelect],
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

  return { ordered, active, centre, select, markers, onKeyDown };
}
