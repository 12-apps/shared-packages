/**
 * Words shared by more than one family: the guided-section chrome, the
 * confirm dialog behind a destructive action, the category picker and the CEP
 * lookup.
 *
 * Split out of `copy.ts`, which is a barrel over this folder: one file
 * listing every family is the file that grows on every port, and it stopped
 * fitting the 400-line budget the rest of this package holds itself to.
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
