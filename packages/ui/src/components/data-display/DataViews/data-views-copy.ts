import type { CategorySelectCopy, ConfirmActionCopy } from "../../../copy";
import type { SavedViewsLabels } from "../../layout/ContentToolbar/ContentToolbar.types";
/**
 * Every word the DataViews family renders, as REQUIRED host config (FUT-760).
 *
 * Nineteen files in this one component tree carried pt-BR — the saved-view
 * dialogs, the display tabs, the column and filter panels, the selection strip,
 * the nav. A design system shipping product copy is the leak at its most
 * expensive: `@12-apps/ui` is the package every host renders, so its Portuguese
 * reached every adopter of every OTHER package too.
 *
 * ONE object threaded through a context rather than a prop per component,
 * because these nineteen files are a single surface a host mounts once, and
 * `data-views-layout-context.tsx` already establishes that shape here for
 * layout. A prop per leaf would make a host thread words through components it
 * never names.
 */

/** What the board's per-page footnote says about counts and sums. */
export interface DataViewsBoardCopy {
  countOnPage(label: string, count: number): string;
  /** A board column with no cards in it. */
  emptyColumn: string;
  onThisPage(count: number): string;
  pageSum(sum: string): string;
  /** Why the figures below are not the whole set. */
  pageScopeNote: string;
}

export interface DeleteViewCopy {
  title: string;
  /**
   * WHICH view is about to go, named. The name is quoted rather than
   * emphasised with markup: a quote delimits it unambiguously in any language
   * and needs no markup grammar in a design-system package.
   */
  target(viewName: string): string;
  /** Shown only when the view is shared with the team. */
  sharedWarning: string;
  /** `entityLabel` is the host's own noun for the rows — never this package's. */
  rowsUnaffected(entityLabel: string): string;
  confirm: string;
  /** The way out, beside the destructive button. */
  cancel: string;
}

export interface ManageViewsCopy {
  title: string;
  empty: string;
  /** The per-row action that reopens a saved view for editing. */
  edit: string;
  defaultTag: string;
  otherUserTag: string;
  deleteTitle: string;
  deleteBody: string;
  deleteConfirm: string;
}

export interface SaveViewCopy {
  sharedDescription: string;
  setDefaultTitle: string;
  setDefaultDescription: string;
  previewHeading: string;
  /** The view would be identical to the unsaved default. */
  previewUnchanged: string;
  sortRowLabel: string;
  saveFailed: string;
  titleEditing: string;
  titleCreating: string;
  descriptionLabel: string;
  descriptionPlaceholder: string;
  submitEditing: string;
  submitCreating: string;
  nameLabel: string;
  /** The dialog's way out, beside the submit. */
  cancel: string;
  /** The pin toggle. Its share twin reuses `sharedDescription` below. */
  pinnedTitle: string;
  pinnedDescription: string;
  sharedTitle: string;
  /** An example of a view worth saving, in the host's own domain. */
  namePlaceholder: string;
  /** The two rows of the preview block. */
  previewFilters: string;
  previewHiddenColumns: string;
}

export interface DataViewsColumnsCopy {
  visibleCount(visible: number, total: number): string;
  reset: string;
  showAll: string;
  /** How the list is reordered, for anyone who cannot see the drag handles. */
  dragHint: string;
  /** The keyboard route to the same reordering, named per column. */
  moveUp(columnLabel: string): string;
  moveDown(columnLabel: string): string;
}

export interface DataViewsDisplayCopy {
  /** The three tabs of the display panel. */
  sortTab: string;
  columnsTab: string;
  panelTab: string;
  direction: string;
  /** What each layout is good for, keyed by layout id. */
  layoutHints: Readonly<Record<string, string>>;
  /**
   * What density MEANS in each layout — same three values, three different
   * questions. A table's is how tall its rows are, a card grid's is how many
   * fit on a line, a board's is how wide its columns are.
   */
  densityHeadings: Readonly<Record<string, string>>;
  /**
   * Density words per layout. They differ by layout on purpose: "Baixa" density
   * on a table and "Muitos" cards describe the same setting from the reader's
   * side, which is the register this surface is written in.
   */
  densityLabels: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** The board layout needs stages, and this screen declares none. */
  boardUnavailable: string;
  /** Density is unavailable because the viewport only fits one card per row. */
  densityUnavailableNarrow: string;
  /** The control that opens this panel. */
  trigger: string;
}

export interface DataViewsExportCopy {
  /** Format labels and hints, keyed by format id. */
  formats: Readonly<Record<string, { label: string; hint: string }>>;
  visibleColumns(columnCount: number): string;
  /** The control that opens the menu. */
  trigger: string;
}

export interface DataViewsGridCopy {
  /** The per-row kebab's accessible name. */
  rowActions: string;
  bulkActions(selectedCount: number): string;
  /**
   * The FILTERED empty state, which is a different claim from the host's own
   * "nothing here yet" and must never be worded as one.
   *
   * The grid renders this itself because it is the only party that knows a
   * filter is applied; the way out sits under it, which is the whole point.
   */
  emptyFilteredTitle: string;
  emptyFilteredHint: string;
  emptyFilteredAction: string;
}

export interface DataViewsFiltersCopy {
  moreFilters(count: number): string;
  moreFiltersApplied(count: number, appliedCount: number): string;
  overflowNote: string;
  rangeEnd: string;
  rangeInvalid: string;
  /** The day-range presets' labels, keyed by preset id. */
  rangePresets: Readonly<Record<string, string>>;
  scopesLabel: string;
  /** The slide-in panel, and the button that opens it. */
  panelTitle: string;
  /** Drop every applied filter. Two spellings: the bar has room for one word. */
  clear: string;
  clearAll: string;
  /**
   * Drop ONE named filter — a range pill or a multi-select chip alike.
   *
   * Named for the range because that is where it started; it is the same
   * sentence and the same job for every named filter control, and the
   * multi-select pills use it rather than spelling a second copy of it.
   */
  clearRange(label: string): string;
  /** The multi-select dropdowns this surface mounts. */
  allOption: string;
  optionSearchPlaceholder: string;
  optionsEmpty: string;
}

export interface DataViewsSelectionCopy {
  selectAllOnPage: string;
  clearSelection: string;
  selectAll: string;
  onThisPage(count: number): string;
  /** One row's checkbox, which carries no visible label of its own. */
  selectRow: string;
}

export interface DataViewsNavCopy {
  mainView: string;
  defaultTag: string;
  viewOptions(viewName: string): string;
  emptyHint: string;
  setDefault: string;
  deleteView: string;
  unsavedChanges: string;
  label: string;
  update: string;
  save: string;
  /** Store the current state as a NEW view rather than over the applied one. */
  saveAs: string;
  /** Drop the unsaved changes and return to the applied view. */
  reset: string;
  /** The inline error when a view could not be refreshed or saved. */
  updateFailed: string;
  saveFailed: string;
  /** Reopen the save dialog over an existing view. */
  editView: string;
  pinToSidebar: string;
  shareWithTeam: string;
}

/** The search box on the toolbar, and the one inside the filter panel. */
export interface DataViewsSearchCopy {
  placeholder: string;
  /** The input's accessible name — it says what the term is matched against. */
  allColumnsLabel: string;
  /** The panel's keyword box, which commits on Enter rather than as you type. */
  keywordPlaceholder: string;
  /** The icon button that reveals the input on a narrow bar. */
  open: string;
  close: string;
  clear: string;
}

/** Every word this component family renders, in one object a host passes once. */
export interface DataViewsCopy {
  /**
   * The words of the components this surface RENDERS but does not own — the
   * saved-views menu, the confirm dialog behind a delete, the category pill.
   *
   * Here rather than threaded as props because this surface already carries a
   * copy context: a host mounting DataViews should pass one object, not one per
   * leaf it never names. Each of those components still takes its own copy when
   * mounted standalone.
   */
  savedViewsMenu: SavedViewsLabels;
  confirmAction: ConfirmActionCopy;
  categorySelect: CategorySelectCopy;
  board: DataViewsBoardCopy;
  deleteView: DeleteViewCopy;
  manageViews: ManageViewsCopy;
  saveView: SaveViewCopy;
  columns: DataViewsColumnsCopy;
  display: DataViewsDisplayCopy;
  export: DataViewsExportCopy;
  grid: DataViewsGridCopy;
  filters: DataViewsFiltersCopy;
  selection: DataViewsSelectionCopy;
  nav: DataViewsNavCopy;
  search: DataViewsSearchCopy;
}
