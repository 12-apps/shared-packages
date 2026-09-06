import type { FleetFreshness, FleetUnit } from './FleetMap.types';

/**
 * How current a fix is, on the two thresholds the caller supplied.
 *
 * Inclusive at both boundaries in the direction that reads better on a screen:
 * a unit exactly at the lagging threshold is already lagging. A boundary has to
 * fall somewhere, and the conservative side is the one that does not tell a
 * dispatcher somebody is live when they are on the edge of not being.
 */
export function freshnessOf(
  staleSeconds: number,
  laggingAfterSeconds: number,
  staleAfterSeconds: number,
): FleetFreshness {
  if (staleSeconds >= staleAfterSeconds) return 'stale';
  if (staleSeconds >= laggingAfterSeconds) return 'lagging';
  return 'live';
}

/** A latitude/longitude pair, as the map wants its centre. */
export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Where the map should point.
 *
 * The selected unit when there is one — a dispatcher who clicked a name is
 * asking to look at them. Otherwise the fleet's own centroid, which keeps
 * everybody in frame without the caller having to compute a bounding box.
 *
 * `null` for an empty fleet rather than a coordinate: (0, 0) is a real place in
 * the Atlantic, and a map that quietly sails there is worse than one that says
 * it has nothing to show.
 */
export function mapCentre(
  units: readonly FleetUnit[],
  selectedId?: string | null,
): LatLng | null {
  if (units.length === 0) return null;
  const selected = selectedId ? units.find((unit) => unit.id === selectedId) : undefined;
  if (selected) return { lat: selected.latitude, lng: selected.longitude };
  const sum = units.reduce(
    (acc, unit) => ({ lat: acc.lat + unit.latitude, lng: acc.lng + unit.longitude }),
    { lat: 0, lng: 0 },
  );
  return { lat: sum.lat / units.length, lng: sum.lng / units.length };
}

/**
 * The roster's order: freshest first, then alphabetically.
 *
 * Not the caller's order, deliberately. The one question this panel answers is
 * *who is moving right now*, and a list sorted by anything else buries the
 * answer under whoever happens to sort first. Ties break on the label so the
 * list does not reshuffle between polls when two units share a staleness.
 */
export function rosterOrder(units: readonly FleetUnit[]): FleetUnit[] {
  return [...units].sort(
    (a, b) => a.staleSeconds - b.staleSeconds || a.label.localeCompare(b.label),
  );
}

/**
 * Move the selection by one row, wrapping at both ends.
 *
 * Wrapping rather than stopping: this is a short list a dispatcher arrows
 * through repeatedly, and a selection that sticks at the last row makes the
 * keyboard path feel broken next to the mouse one.
 */
export function nextSelection(
  units: readonly FleetUnit[],
  currentId: string | null | undefined,
  step: 1 | -1,
): string | null {
  if (units.length === 0) return null;
  const index = units.findIndex((unit) => unit.id === currentId);
  // Nothing selected: Down opens at the top and Up opens at the bottom, which
  // is what every listbox in the house does.
  if (index === -1) return (step === 1 ? units[0] : units[units.length - 1])?.id ?? null;
  const next = (index + step + units.length) % units.length;
  return units[next]?.id ?? null;
}
