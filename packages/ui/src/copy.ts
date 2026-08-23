/**
 * The words the standalone components render, as REQUIRED host config
 * (FUT-760).
 *
 * `@12-apps/ui` is the package EVERY host renders, so copy compiled in here
 * reached every adopter of every other package too — the same leak as anywhere
 * else, at the widest possible blast radius. Several of these components made
 * it worse by taking the words as OPTIONAL props with pt-BR defaults, which
 * reads as configurable right up until nobody configures it.
 *
 * The DataViews family has its own object (`DataViewsCopy`) threaded through a
 * context, because nineteen files are one mounted surface. These six are
 * mounted independently, so each takes what it renders.
 */

export interface SectionOnboardingCopy {
  /** The button that begins the guided section. */
  start: string;
  /** The reveal toggle in the configured state, and its collapsed twin. */
  edit: string;
  collapse: string;
}

export interface ConfirmActionCopy {
  /** The dismiss button every confirmation shares. */
  cancel: string;
  /** Shown when the action fails and the caller supplied no reason. */
  defaultError: string;
  /**
   * The fallback body when the caller names no entity.
   *
   * A caller that DOES name one gets the host's own sentence — this package
   * never guesses a noun for someone else's rows.
   */
  irreversible: string;
  /**
   * The typed-confirmation prompt, naming the exact word that unlocks the
   * button. A function because where that word sits in the sentence, and how
   * it is quoted, is the translator's call.
   */
  typeToConfirm(expected: string): string;
}

export interface CategorySelectCopy {
  /**
   * What categories are FOR, in the host's own terms.
   *
   * This used to read "Categorias organizam o cardápio e os filtros da loja" —
   * a restaurant's menu, hard-coded into a generic picker. A host selling
   * insurance policies got told about its cardápio.
   */
  purpose: string;
  clearSelection: string;
  /**
   * The quick actions above the tree. Each toggles as a PAIR, and each label
   * says what pressing it will do rather than what state the list is in — so a
   * translator needs both halves, not one plus a negation.
   */
  selectAll: string;
  deselectAll: string;
  expandAll: string;
  collapseAll: string;
  /**
   * ONE row's chevron, in its two states — a glyph button inside the row
   * button, so this pair is the whole of what a screen reader reads for it.
   * The category's own name is appended by the caller.
   */
  expandCategory(name: string): string;
  collapseCategory(name: string): string;
  /**
   * What the closed control invites, and it differs by mode: picking ONE
   * category is a move, picking several is a filter. Both were pt-BR defaults
   * behind an optional prop, which is the arrangement this port removes.
   */
  placeholderSingle: string;
  placeholderMulti: string;
  /** The empty state, when the host has no categories at all. */
  emptyTitle: string;
  createCategory: string;
  /**
   * The search found nothing.
   *
   * Two of the four interpolate the term typed, so they are functions rather
   * than strings with a placeholder to substitute: where the term sits in the
   * sentence is the translator's call, not ours.
   */
  noResults: {
    title: (query: string) => string;
    hint: string;
    clearSearch: string;
    create: (query: string) => string;
  };
  /**
   * The panel's two footers.
   *
   * `selectedCount` is a function because Portuguese agrees the participle with
   * the count and English does not — the shape has to let a translator decide
   * the whole sentence, not fill a slot in ours.
   */
  /** The search box above the list, and the chips beneath it. */
  search: {
    /** Two placeholders: a single-select picker offers no subcategories. */
    placeholderSingle: string;
    placeholderMulti: string;
    clear: string;
    removeChip(label: string): string;
    /** The tray above the list, counting what is already picked. */
    pinnedLabel(count: number): string;
  };
  footer: {
    selectedCount(count: number): string;
    clear: string;
    /** The primary button, which reads `close` while the draft is unchanged. */
    apply: string;
    close: string;
    /** The single-select footer: what to do, and the way out. */
    singleHint: string;
    cancel: string;
  };
}

export interface CepFieldCopy {
  loading: string;
  found: string;
  /** Keyed to match `CepLookupStatus` exactly, so the lookup can index it. */
  notfound: string;
}

export interface TableFilterCopy {
  /** A numeric range whose maximum is below its minimum. */
  invalidRange: string;
  /** The two free-text bounds, which carry no visible label of their own. */
  rangeMin: string;
  rangeMax: string;
}

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

/**
 * The states a data surface can be in with nothing to draw, and the dismiss
 * every banner-like surface carries.
 *
 * One object rather than six, because these are the same four sentences the
 * table, the grid, the async container, the hover card and the infinite
 * scroller each rendered their own copy of.
 */
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
