import type { MapPreviewCopy } from '../../../copy';

/**
 * One tracked unit's newest position, as the caller resolved it.
 *
 * Deliberately says nothing about WHAT is being tracked. A courier, a service
 * van, a field engineer — the component draws a labelled dot with a freshness,
 * and every word that names the domain arrives through {@link FleetMapCopy}.
 */
export interface FleetUnit {
  id: string;
  /** The name a human reads, on the pin and in the roster. */
  label: string;
  latitude: number;
  longitude: number;
  /**
   * The fix's accuracy radius in metres, when the platform reported one.
   *
   * Kept because it is what separates a rooftop GPS fix from a cell-tower guess
   * three blocks wide, and a map that draws both identically tells its reader
   * something false.
   */
  accuracyM?: number | null;
  /**
   * Seconds since the fix was ACCEPTED, on the server's clock.
   *
   * The caller computes it, and the distinction matters: a device whose own
   * clock is an hour slow would otherwise report itself as an hour stale while
   * reporting perfectly.
   */
  staleSeconds: number;
  /** A short pre-formatted badge beside the name, e.g. `"2 entregas"`. */
  badge?: string;
}

/** How current a unit's newest fix is, derived from the thresholds below. */
export type FleetFreshness = 'live' | 'lagging' | 'stale';

/**
 * Every word the board prints, and the two it FORMATS.
 *
 * `lastSeen` and `accuracy` are functions rather than strings because a
 * duration and a distance are locale rules, and this package holds the same
 * line `StatCard` does: presentation only, the caller owns the formatting. A
 * `lastSeenMinutes: string` template would have made "há 2 min" the only
 * shape any consumer could ever render.
 */
export interface FleetMapCopy {
  /** The panel's heading. */
  title: string;
  /** What the roster says when nobody is reporting. */
  emptyTitle: string;
  emptyDescription?: string;
  /** The roster list's accessible name — it is the map's readable half. */
  rosterLabel: string;
  /**
   * The map region's accessible name.
   *
   * The map is NOT `aria-hidden`, and that is deliberate rather than an
   * oversight: it carries focusable controls (zoom, centre, map type), and
   * `aria-hidden` over a focusable subtree is the `aria-hidden-focus`
   * violation — a keyboard user tabs into a region a screen reader insists is
   * not there. So it is a NAMED region a reader can skip past instead, and the
   * roster beside it carries every fact a pin does.
   */
  mapLabel: string;
  /** The three freshness words, as a reader sees them on a row. */
  freshness: Record<FleetFreshness, string>;
  /** `(seconds) => "há 2 min"`. */
  lastSeen: (staleSeconds: number) => string;
  /** `(metres) => "±12 m"`. A unit with no accuracy renders none. */
  accuracy: (metres: number) => string;
  /** The map control bar's own six names. */
  map: MapPreviewCopy;
}

/** Props for the {@link FleetMap} live board. */
export interface FleetMapProps {
  /** Everyone currently reporting. An empty array renders the empty state. */
  units: readonly FleetUnit[];
  copy: FleetMapCopy;
  /**
   * Which unit is highlighted. Controlled: the map centres on it and the roster
   * marks it selected. `null` centres on the whole fleet.
   */
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /**
   * Seconds after which a unit stops reading as `live`, and then as `lagging`.
   *
   * Both are props with no domain default, because the answer is entirely a
   * property of the fleet's own ping cadence: a phone reporting every twenty
   * seconds is late at ninety, and a tracker reporting every five minutes is
   * not. A component that picked one would be picking it for every consumer.
   */
  laggingAfterSeconds?: number;
  staleAfterSeconds?: number;
  /** Map height, any CSS length. */
  height?: string;
  /** While true the roster renders skeletons and the panel announces busy. */
  loading?: boolean;
  /** Passed through to the map; without one it draws its tile fallback. */
  googleMapsApiKey?: string;
  className?: string;
  /** Test id for the panel root; every child id is derived from it. */
  dataTestId?: string;
}
