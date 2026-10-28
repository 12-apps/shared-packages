/**
 * The contract of `RegionMap` — a hand-drawn map of named areas (polygons with
 * holes) around a centre, where a tap toggles an area's `excluded` state.
 *
 * Product-free: an area is a bairro, a delivery zone, a sales territory or a
 * parking sector alike. Coordinates are plain WGS 84 latitude/longitude, and
 * every word arrives through `copy`.
 */

/** A latitude/longitude pair, in that order. */
export type RegionMapPoint = readonly [latitude: number, longitude: number];

/** One closed ring: the first point repeated last is allowed, not required. */
export type RegionMapRing = readonly RegionMapPoint[];

/** One named area. */
export interface RegionMapRegion {
  /** Stable id — what `onToggle` reports. */
  id: string;
  /** The area's name: its label on the map and its row in the list. */
  name: string;
  /**
   * Every ring of every polygon of the area, holes included. Inside is decided
   * by the EVEN-ODD rule over all of them, so a hole is just a ring inside its
   * polygon, and a multi-part area is several outer rings.
   */
  rings: readonly RegionMapRing[];
  /** Drawn hatched, labelled, and pressed in the list. */
  excluded?: boolean;
  /**
   * Drawn faded, for an area shown for context beyond the circles (a ring may
   * grow). Still tappable on the map; left off the list unless `listed`.
   */
  outside?: boolean;
  /**
   * Whether the area has a row in the list. Defaults to `!outside`, so the
   * list — and its count — covers the areas inside the circles while the map
   * still draws the faded context around them.
   */
  listed?: boolean;
  /**
   * Pre-formatted secondary text on the list row, e.g. "2.7 km away", or a
   * size tag such as "tiny" for an area too small to tap.
   */
  detail?: string;
}

/** A circle drawn around the centre, e.g. a delivery ring. */
export interface RegionMapCircle {
  radiusMetres: number;
}

/** Every word the map prints or announces. */
export interface RegionMapCopy {
  /** The drawing's accessible name (`role="img"`). */
  mapLabel: string;
  /** The legend entry for a hatched (excluded) area. */
  legendExcluded: string;
  /** The legend entry for the outermost circle, given its radius in metres. */
  legendCircle: (radiusMetres: number) => string;
  /** The legend entry for the centre's dot. */
  legendCenter: string;
  /** The list's accessible name and its heading when shown. */
  listLabel: string;
  /** The button that reveals the list, given how many areas it holds. */
  showList: (count: number) => string;
  /** The button that hides it again. */
  hideList: string;
  /**
   * A list row's state, read after its name by a screen reader: "excluded"
   * for an excluded area (pressed, filled, checked), "outside" for a listed
   * `outside` one (faded). Neither is shown; the row's look carries it.
   */
  rowState: { excluded: string; outside: string };
}

/** The order of the list: as given (e.g. nearest first), or by name. */
export type RegionMapListSort = 'given' | 'name';

/**
 * How the accessible list of areas — one toggle button each — is offered.
 *
 * - `shown`: always under the map (a computer, where there is room);
 * - `collapsed`: behind one button (a phone) — still a keyboard's way in;
 * - `none`: not rendered. Only for a host that offers its own list.
 */
export type RegionMapListMode = 'shown' | 'collapsed' | 'none';

export interface RegionMapProps {
  regions: readonly RegionMapRegion[];
  /**
   * Where the map is centred, and where the dot and the circles are drawn.
   * `null` with no regions renders NOTHING rather than a map of `0, 0`.
   */
  center: { latitude: number; longitude: number } | null;
  /** Circles around the centre; the view fits the largest. */
  circles?: readonly RegionMapCircle[];
  /**
   * A tap on an area, or a press of its list button. Omit it and the map is
   * read-only: nothing is tappable and the list rows are not buttons.
   */
  onToggle?: (id: string) => void;
  /**
   * Areas to point at — e.g. a search's results — outlined and labelled. More
   * than one at once: a search lists several hits.
   */
  highlightedIds?: readonly string[];
  copy: RegionMapCopy;
  listMode?: RegionMapListMode;
  /** The list's order; `'given'` keeps the order of `regions`. */
  listSort?: RegionMapListSort;
  /** The drawing's largest height, any CSS length; it stays square inside it. */
  maxHeight?: string;
  className?: string;
  /** Every child TEST id derives from it. */
  dataTestId?: string;
}
