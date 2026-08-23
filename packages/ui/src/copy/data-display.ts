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

/** The request-timing diagram's own two strings. */
export interface TimingDiagramCopy {
  regionLabel: string;
  heading: string;
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
