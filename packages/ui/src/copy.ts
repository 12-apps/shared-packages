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
}
