/**
 * The display family's words — the lightbox and map viewers, the carousel,
 * the timing diagram, and the shared empty/error states.
 *
 * Split out of `copy.ts`, which is a barrel over this folder: one file
 * listing every family is the file that grows on every port, and it stopped
 * fitting the 400-line budget the rest of this package holds itself to.
 */

/**
 * The lightbox's controls, every one of them a glyph with no text.
 *
 * So this object IS what a screen-reader user hears for the whole viewer —
 * which is why it shipped as English literals for so long without anyone
 * noticing: the sighted path renders identically either way.
 */
export interface LightboxCopy {
  close: string;
  previous: string;
  next: string;
  zoomIn: string;
  zoomOut: string;
  resetZoom: string;
  /** The slideshow toggle, in its two states. */
  play: string;
  pause: string;
  /** The dialog's own accessible name, read out before its hidden title. */
  dialogLabel: string;
  /** The hidden title's item count, when the current item has no `alt`. */
  itemPosition: (index: number, total: number) => string;
  /** A `<video>`'s accessible name, when the item has no `alt`. */
  videoFallback: (index: number, total: number) => string;
  /** An `<img>`'s `alt`, when the item has no `alt`. */
  imageFallback: (index: number, total: number) => string;
  /** A filmstrip thumbnail's `alt`, when the item has no `alt`. */
  thumbnailFallback: (index: number) => string;
}

/** The map preview's control bar — same shape, same reason, as the lightbox. */
export interface MapPreviewCopy {
  zoomIn: string;
  zoomOut: string;
  center: string;
  mapType: string;
  fullscreen: string;
  search: string;
}

/** The carousel's two arrows, which carry a glyph and nothing else. */
export interface CarouselCopy {
  previous: string;
  next: string;
}

/** The request-timing diagram's own words: its region, its phases, its totals. */
export interface TimingDiagramCopy {
  regionLabel: string;
  heading: string;
  /** The five phases a waterfall/stacked/horizontal bar can show. */
  dns: string;
  connect: string;
  ssl: string;
  request: string;
  response: string;
  /** The stacked view's own total sentence, e.g. "Total: 1.20s". */
  total: (formatted: string) => string;
  /** The horizontal view's own total sentence, e.g. "Total Time: 1.20s". */
  totalTime: (formatted: string) => string;
}

/**
 * The DataGrid's own words — every one a fallback the caller can still
 * override: `column.ariaLabel`, `expansion.expandLabel`/`collapseLabel` and
 * the grid's own `ariaLabel` all win when given. REQUIRED: the fallbacks were
 * English literals with no way to localise them at all.
 */
export interface DataGridCopy {
  /** A sortable header button's accessible name, unless the column's own `ariaLabel` wins. */
  sortBy: (header: string) => string;
  /** A row's selection checkbox, unless `selection` is off. */
  selectRow: (rowNumber: number) => string;
  /** The header's select-all checkbox. */
  selectAllRows: string;
  /** The expand chevron's two states, unless `expansion.expandLabel`/`collapseLabel` win. */
  expandRow: string;
  collapseRow: string;
  /** The grid's own accessible name, unless the caller's `ariaLabel` wins. */
  gridLabel: string;
}

export interface DataStateCopy {
  /** No rows at all — distinct from "no rows for these filters". */
  empty: string;
  loading: string;
  /** The infinite scroller reached the end. */
  endOfList: string;
  /** An alert's and a banner's dismiss, neither of which has a visible label. */
  dismissAlert: string;
  dismissBanner: string;
}
