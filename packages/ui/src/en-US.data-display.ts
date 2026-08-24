/**
 * The en-US pack for the data-display family. Split the same way
 * `pt-BR.data-display.ts` is — see `en-US.ts` for why.
 */
import type { DataViewsCopy } from "./components/data-display/DataViews/data-views-copy";
import type {
  CarouselCopy,
  DataStateCopy,
  LightboxCopy,
  MapPreviewCopy,
  TimingDiagramCopy,
} from './copy';
import { EN_US_TABLE_FILTER_COPY } from './en-US.layout';
import {
  EN_US_CATEGORY_SELECT_COPY,
  EN_US_CONFIRM_ACTION_COPY,
  EN_US_SAVED_VIEWS_LABELS,
} from './en-US.shared';

export const EN_US_LIGHTBOX_COPY: LightboxCopy = {
  close: "Close",
  previous: "Previous",
  next: "Next",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  resetZoom: "Reset zoom",
  play: "Start the slideshow",
  pause: "Pause the slideshow",
};

export const EN_US_MAP_PREVIEW_COPY: MapPreviewCopy = {
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  center: "Centre the map",
  mapType: "Change the map type",
  fullscreen: "Full screen",
  search: "Search for an address",
};

export const EN_US_CAROUSEL_COPY: CarouselCopy = {
  previous: "Previous",
  next: "Next",
};

export const EN_US_TIMING_DIAGRAM_COPY: TimingDiagramCopy = {
  regionLabel: "Timing diagram",
  heading: "Request timing",
};

export const EN_US_DATA_STATE_COPY: DataStateCopy = {
  empty: "Nothing here",
  loading: "Loading…",
  endOfList: "No more items to load",
  dismissAlert: "Dismiss",
  dismissBanner: "Dismiss this banner",
};

export const EN_US_DATA_VIEWS_COPY: DataViewsCopy = {
  savedViewsMenu: EN_US_SAVED_VIEWS_LABELS,
  confirmAction: EN_US_CONFIRM_ACTION_COPY,
  categorySelect: EN_US_CATEGORY_SELECT_COPY,
  board: {
    countOnPage: (label, count) => `${label}: ${count} on this page`,
    onThisPage: (count) => `${count} on this page`,
    pageSum: (sum) => `This page totals ${sum}`,
    emptyColumn: "Nothing at this stage",
    pageScopeNote: "The counts and totals below cover only the items on this page.",
  },
  deleteView: {
    title: "Delete view",
    target: (viewName) => `Delete "${viewName}"?`,
    sharedWarning: "This view is shared — the team will lose access to it.",
    // `entityLabel` is the HOST's word for what the rows are, so the sentence is
    // built around it rather than naming a noun of its own.
    rowsUnaffected: (entityLabel) =>
      `${entityLabel} are not affected; only the saved slice is removed.`,
    confirm: "Delete view",
    cancel: "Cancel",
  },
  manageViews: {
    title: "Manage views",
    empty: "No saved views.",
    edit: "Edit",
    defaultTag: "Default",
    otherUserTag: "Another user's",
    deleteTitle: "Delete this saved view?",
    deleteBody: "The filters and columns it holds are lost. This cannot be undone.",
    deleteConfirm: "Delete",
  },
  saveView: {
    sharedDescription: "Anyone in the store will be able to open and use this view.",
    setDefaultTitle: "Set as default",
    setDefaultDescription: "This screen opens on this view instead of the Main view.",
    previewHeading: "What this view holds",
    previewUnchanged: "Nothing has changed — this view will match the Main view.",
    sortRowLabel: "Sorting",
    saveFailed: "Could not save the view.",
    titleEditing: "Edit view",
    titleCreating: "Save view",
    descriptionLabel: "Description — optional",
    descriptionPlaceholder: "What this view is for",
    submitEditing: "Save changes",
    submitCreating: "Save view",
    nameLabel: "Name",
    cancel: "Cancel",
    pinnedTitle: "Pin to the sidebar",
    pinnedDescription: "Appears as a shortcut in the menu, under this screen.",
    sharedTitle: "Share with the team",
    namePlaceholder: "e.g. Declined card payments this week",
    previewFilters: "Filters",
    previewHiddenColumns: "Hidden columns",
  },
  columns: {
    visibleCount: (visible, total) => `${visible} of ${total} visible`,
    reset: "Default",
    showAll: "Show all",
    dragHint: "Drag to reorder the columns.",
    moveUp: (columnLabel) => `Move ${columnLabel} up`,
    moveDown: (columnLabel) => `Move ${columnLabel} down`,
  },
  display: {
    sortTab: "Sort",
    columnsTab: "Columns",
    panelTab: "Display",
    direction: "Direction",
    layoutHints: {
      table: "Comparable columns, good for scanning numbers.",
      list: "One row per item, with the key fields.",
      cards: "Larger blocks, good for a handful of items.",
      board: "A column per stage, for tracking what is where.",
    },
    densityHeadings: {
      table: "Row height",
      list: "Row height",
      cards: "Cards per row",
      board: "Column width",
    },
    densityLabels: {
      table: { compact: "Low", cozy: "Medium", comfortable: "High" },
      list: { compact: "Low", cozy: "Medium", comfortable: "High" },
      cards: { compact: "Many", cozy: "Some", comfortable: "Few" },
      board: { compact: "Narrow", cozy: "Medium", comfortable: "Wide" },
    },
    boardUnavailable: "This screen declares no stages, so it offers no board.",
    densityUnavailableNarrow:
      "One card per row at this width — density returns on larger screens.",
    trigger: "Display",
    fieldHeading: "Field",
    formatHeading: "Format",
    cardZoom: "Card size",
  },
  export: {
    formats: {
      // The extension is the file's, not a word: it stays as it is written on
      // disk in every language.
      json: { label: "JSON (.json)", hint: "For integrations" },
    },
    visibleColumns: (columnCount) => `${columnCount} visible columns, in their current order`,
    trigger: "Export",
    triggerLabel: "Export",
  },
  tableFilter: EN_US_TABLE_FILTER_COPY,
  grid: {
    rowActions: "Actions",
    bulkActions: (selectedCount) => `Actions (${selectedCount}) ▾`,
    emptyFilteredTitle: "No results for these filters",
    emptyFilteredHint: "Adjust or remove the filters.",
    emptyFilteredAction: "Clear filters",
  },
  filters: {
    moreFilters: (count) => `More filters: ${count} did not fit in the bar`,
    moreFiltersApplied: (count, appliedCount) =>
      `More filters: ${count} did not fit in the bar, ${appliedCount} applied`,
    moreTriggerLabel: "More",
    moreHeading: "More filters",
    overflowNote: "did not fit in the bar",
    rangeEnd: "To",
    rangeInvalid: "The start must be earlier than the end.",
    rangeInclusiveNote: "Both dates are included in the result.",
    rangeStart: "From",
    // The mask is what the reader TYPES, so it follows their own date order
    // rather than being carried over. A translated label above an unchanged
    // mask is the shape that gets a date entered backwards.
    dayMask: "mm/dd/yyyy",
    clearAllFilters: "Clear all filters",
    // The KEYS are the package's own preset ids and stay as they are — the
    // surface matches on them. Only the labels beside them are words.
    rangePresets: {
      hoje: "Today",
      ontem: "Yesterday",
      semana: "This week",
      mes: "This month",
      ano: "This year",
    },
    scopesLabel: "Status",
    panelTitle: "Filters",
    clear: "Clear",
    clearAll: "Clear filters",
    clearRange: (label) => `Clear ${label}`,
    allOption: "All",
    optionSearchPlaceholder: "Search…",
    optionsEmpty: "No results",
    optionsHeading: "Options",
  },
  selection: {
    selectAllOnPage: "Select all on this page",
    clearSelection: "Clear selection",
    selectAll: "Select all",
    onThisPage: (count) => `${count} on this page`,
    selectRow: "Select",
    expandRow: "Expand details",
    collapseRow: "Collapse details",
  },
  nav: {
    mainView: "Main view",
    defaultTag: "Default",
    viewOptions: (viewName) => `${viewName} options`,
    emptyHint: "No saved views. Adjust filters, columns or sorting and save below.",
    setDefault: "Set as default",
    deleteView: "Delete view",
    unsavedChanges: "Unsaved changes",
    label: "View",
    update: "Update view",
    save: "Save view",
    saveAs: "Save as new",
    reset: "Reset",
    updateFailed: "Could not update the view",
    dismissError: "Dismiss",
    goBack: "Back",
    pageSize: "Show:",
    saveFailed: "Could not save the change to the view.",
    editView: "Rename and edit",
    pinToSidebar: "Pin to the sidebar",
    shareWithTeam: "Share with the team",
  },
  search: {
    placeholder: "Search…",
    allColumnsLabel: "Search every column",
    keywordPlaceholder: "Press Enter to filter",
    open: "Search",
    close: "Close search",
    clear: "Clear search",
  },
};
