/**
 * The en-US labels pack — and, unlike the other en-US packs, the components'
 * own fallback: each `labels` prop is optional, and this is what a host that
 * passes nothing has always rendered, kept word for word (including the
 * lower-case `close`/`loading` names tests already query by).
 */
import type { UiLabels } from './copy/labels';

export const EN_US_UI_LABELS: UiLabels = {
  common: {
    loading: "loading",
    close: "close",
    delete: "delete",
  },
  stepper: {
    step: (position, label) => `Step ${position}: ${label}`,
    optional: "optional",
    completed: "completed",
    current: "current",
  },
  timeline: {
    expandDetails: "Expand item details",
    collapseDetails: "Collapse item details",
    item: (title) => `Timeline item: ${title}`,
  },
  lazyImage: {
    loadingAlt: (alt) => `${alt} (loading)`,
    fallbackAlt: (alt) => `${alt} (fallback)`,
  },
  sonner: {
    hiddenCount: (count) => `+${count} more`,
  },
  richTextEditor: {
    placeholder: "Start typing...",
    ariaLabel: "Rich text editor",
    listItem: "List item",
    bold: "Bold",
    italic: "Italic",
    underline: "Underline",
    strikethrough: "Strikethrough",
    numberedList: "Numbered List",
    bulletedList: "Bulleted List",
    insertLink: "Insert Link",
    insertImage: "Insert Image",
    codeBlock: "Code Block",
    quote: "Quote",
    linkPrompt: "Enter URL:",
    imagePrompt: "Enter image URL:",
  },
  table: {
    sortBy: (header) => `Sort by ${header}`,
    selectRow: (rowNumber) => `select row ${rowNumber}`,
    selectAllRows: "select all",
  },
  code: {
    copy: "Copy code",
    copied: "Copied!",
  },
  contentToolbar: {
    gridView: "Grid View",
    listView: "List View",
    openFilters: "Open filters",
    closeFilters: "Close filters",
    filters: "Filters",
    all: "All",
    search: "Search…",
    noResults: "No results",
  },
  dashboard: {
    breadcrumb: "breadcrumb",
    moreFilters: "More filters",
  },
  navigationMenu: {
    collapse: "Collapse",
    expand: "Expand",
  },
  workflowStep: {
    step: (position, title) => `Step ${position}: ${title}`,
    progress: (position, total) => `Step ${position} of ${total}`,
  },
  alertDialog: {
    cancel: "Cancel",
    confirm: "Confirm",
  },
  avatar: {
    name: "Avatar",
  },
  emptyState: {
    refresh: "Refresh",
    create: "Create New",
  },
  errorState: {
    retry: "Retry",
  },
  loadingState: {
    skeleton: "Loading content",
    spinner: "Loading",
  },
  stackedModal: {
    loading: "Loading...",
  },
  command: {
    placeholder: "Type a command or search...",
    empty: "No results found",
    loading: "Loading...",
  },
  formErrorSnackbar: {
    message: "Please fix the highlighted fields and try again.",
  },
  columnsMenu: {
    title: "Columns",
    toggle: "Toggle columns",
  },
  drawer: {
    close: "Close drawer",
  },
  settingsLayout: {
    navigation: "Settings",
    searchPlaceholder: "Search settings",
    emptySearch: "No settings match your search.",
    back: "Back",
  },
  tableFilter: {
    filters: "Filters",
    keywordPlaceholder: "Press Enter to filter",
    keywordLabel: "Filter by keyword",
  },
  appHeader: {
    disclose: (title) => `${title} details`,
  },
  breadcrumbs: {
    navigation: "breadcrumb navigation",
  },
  animatedIcon: {
    name: (variant) => `Animated ${variant} icon`,
  },
  infiniteScroll: {
    loadFailed: "An error occurred while loading more items",
  },
  socialLogin: {
    title: "Sign in to continue",
    divider: "or",
  },
  dateRangePicker: {
    calendar: "Calendar",
  },
  scheduleGrid: {
    createCell: (row, column) => `Schedule ${row}, ${column}`,
    blockedCell: (row, column) => `${row}, ${column}: closed`,
    copied: (block, column) => `${block} copied to ${column}`,
    moved: (block, row, column) => `${block} moved to ${row}, ${column}`,
    refused: "Not there: that day is taken or closed",
    loading: "Loading the schedule",
  },
  dayRuler: {
    createTrack: (row) => `Schedule ${row}`,
    moved: (block, range) => `${block} now ${range}`,
    resized: (block, range) => `${block} now ${range}`,
    refused: "It cannot go further",
    loading: "Loading the day",
  },
};
