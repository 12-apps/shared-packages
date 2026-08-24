/**
 * The en-US pack for the report SCREENS — a NAMED constant a host passes by
 * hand, never a default.
 *
 * `builder.breadcrumb` composes `@12-apps/ui`'s own English pack rather than
 * restating it, exactly as the pt-BR side composes the Portuguese one.
 *
 * The KEYS of `ranges`, `quickRanges`, `charts`, `aggregations`, `operators`
 * and `heights` are the package's own ids — the surface matches on them — so
 * they stay exactly as they are. Only the labels beside them are words.
 */
import type { ReportScreensCopy } from "./screens-copy";
import { EN_US_BREADCRUMB_COPY } from "@12-apps/ui/en-US";

export const EN_US_REPORT_SCREENS_COPY: ReportScreensCopy = {
  list: {
    title: "Reports",
    subtitle: "Your dashboards: open one to read it, or build another from the blocks you want.",
    loadFailedTitle: "Could not load the reports",
    loadFailedBody: "Try again in a moment.",
    retry: "Try again",
    scopes: {
      active: "All",
      mine: "Mine",
      archived: "Archived",
    },
    search: "Search reports",
    create: "New report",
    emptyTitle: "No reports here.",
    emptyBody: "Build the first one with revenue by day, top products and average order value.",
    emptySearchBody: "Try another term.",
    chipDraft: "Draft",
    chipArchived: "Archived",
    chipUnpublished: "Unpublished changes",
    noDescription: "No description.",
    blockCount: (count) => `${count} ${count === 1 ? "block" : "blocks"}`,
    visibility: {
      private: "Only you",
      roles: "Named roles",
      tenant: "The whole team",
    },
    // Each locale owns its own plural rule — the reason these are functions.
    relativeTime: {
      now: "just now",
      minutes: (count) => `${count} min ago`,
      hours: (count) => `${count} ${count === 1 ? "hour" : "hours"} ago`,
      yesterday: "yesterday",
      days: (count) => `${count} days ago`,
      weeks: (count) => `${count} ${count === 1 ? "week" : "weeks"} ago`,
    },
    edit: "Edit",
    archive: "Archive",
    restore: "Restore",
    cardMenu: (reportName) => `More actions for ${reportName}`,
    newCardTitle: "New report",
    newCardHint: "Start from a template",
  },
  view: {
    noDescription: "No description.",
    // Lower-cased because it lands mid-sentence, and with the pack's OWN locale
    // rather than the runtime's: `toLocaleLowerCase` is locale-sensitive
    // (Turkish dotless i is the classic case), so the tag has to travel with
    // the words it is lower-casing.
    visibleTo: (audience) => `visible to ${audience.toLocaleLowerCase("en-US")}`,
    editedAt: (relativeTime) => `edited ${relativeTime}`,
    breadcrumbList: "Reports",
    export: "Export",
    edit: "Edit",
    retry: "Try again",
    loadFailedTitle: "Could not load the report",
    loadFailedBody: "It may have been deleted, or you may not have permission.",
  },
  editor: {
    nameLabel: "Report name",
    namePlaceholder: "Untitled report",
    subtitle: (blocks, audience) => `${blocks} · ${audience}`,
    visibilityWords: {
      private: "only you",
      tenant: "the whole team",
      roles: "named roles",
    },
    autosaving: "Saving automatically…",
    autosaveFailed: "Could not save automatically. Your changes are still here.",
    saving: "Saving…",
    // The shortcut is what the reader presses, not something they read.
    save: "Save ⌘S",
    breadcrumbList: "Reports",
    breadcrumbEditing: "Editing",
    unsavedChanges: "Unsaved changes",
    settings: "⚙ Settings",
    previewBanner: "Preview with real data",
    openFailedTitle: "Could not open the editor",
    openFailedBody: "Check your permission, or try again.",
    retry: "Try again",
    exitTitle: "Leave without publishing?",
    // The two exit bodies say different things on purpose: a PUBLISHED report
    // still shows its published version to everyone else, while a draft shows
    // nothing at all. Collapsing them into one sentence would tell half the
    // readers something untrue about who can see their work.
    exitPublishedBody:
      "Your changes are saved, but they have not been published. Anyone opening the report keeps seeing the published version until you save.",
    exitDraftBody:
      "Your changes are saved, but the report has not been published. Nobody else sees these changes until you save.",
    exitConfirm: "Leave without publishing",
    unpublishedTitle: "Unpublished changes",
    unpublishedBody:
      "Anyone opening the report keeps seeing the published version. Save to publish these changes.",
    discard: "Discard changes",
    discarding: "Discarding…",
    discardTitle: "Discard the unpublished changes?",
    discardBody:
      "The changes you have not published will be lost and the report returns to its published version. This cannot be undone.",
    discardConfirm: "Discard changes",
    needsName: "Give the report a name before saving.",
    needsBlock: "Add at least one block to the report.",
    addBlock: "Add a block — chart, table or number",
    addBlockLimit: (max) => `Limit of ${max} blocks per report.`,
    removeBlockTitle: "Remove this block?",
    removeBlockBody:
      "The block leaves the report. You can still cancel the edit to undo everything.",
    removeBlockConfirm: "Remove",
    blockRunFailed: "Could not run this block.",
    blockDragHint: "Drag, or Alt+↑/↓",
    editBlock: "Edit block",
    removeBlock: "Remove block",
    rangeApply: "Apply",
    rangeCancel: "Cancel",
    confirmCancel: "Cancel",
    blockTitleLabel: "Block title",
    moveUp: "Move up",
    moveDown: "Move down",
    blockMenu: "More actions for this block",
  },
  archive: {
    restoreAction: "Restore",
    restoreTitle: "Restore this report?",
    restoreBody: "It returns to the store's report list.",
    archiveAction: "Archive",
    archiveTitle: "Archive this report?",
    // The two bodies name the DIFFERENT control each caller has to reach for.
    archiveBodyFromList:
      "It leaves the report list, but nothing is lost — you can restore it later under “Archived”.",
    archiveBodyFromViewer:
      "It leaves the report list, but nothing is lost — you can restore it later under “Show archived”.",
    busy: "Please wait…",
    reportMenu: "Report actions",
  },
  ranges: {
    ranges: {
      today: "Today",
      "7d": "7 days",
      "30d": "30 days",
      month: "This month",
      custom: "Custom…",
    },
    grains: {
      day: "Day",
      week: "Week",
      month: "Month",
    },
    emptyTitle: "No data in this period",
    emptyBody: "No records found for the period selected.",
    widen: (rangeLabel) => `Show ${rangeLabel}`,
  },
  system: {
    blockFailed: "Could not load this report.",
    dashboardMissingTitle: "Dashboard not found",
    dashboardMissingBody:
      "This dashboard no longer exists. Use the side menu to choose another.",
    reportFailedTitle: "Could not load the report",
    reportFailedBody: "Check your permission, or try again in a moment.",
    retry: "Try again",
  },
  builder: {
    emptySelection: "Select a block to edit",
    duplicateBlocked: (max) => `Limit of ${max} blocks per report.`,
    blockTitleLabel: "Title",
    blockTitleHelper: (autoTitle) => `Empty = use the automatic description: “${autoTitle}”.`,
    untitledBlock: "Untitled block",
    copyOf: (title) => `${title} (copy)`,
    viewAsChart: "Show as a chart",
    viewAsTable: "Show as a table",
    blockMenu: "More actions for this block",
    closePanel: "Close panel",
    panelIdle: "Block",
    panelEditing: "Editing block",
    templateTitle: "Add block",
    removeFilter: (position) => `Remove filter ${position}`,
    removeMeasure: (position) => `Remove measure ${position}`,
    remove: "Remove",
    templateOption: (title, description) => `${title} — ${description}`,
    templateHint: "Start from a ready-made template — you adjust everything afterwards.",
    cancel: "Cancel",
    heights: {
      auto: "Auto",
      "1": "Short",
      "2": "Medium",
      "3": "Tall",
    },
    collection: "Collection",
    height: "Height",
    valuesPlaceholder: "Comma-separated values",
    filterValues: (position) => `Filter ${position} — values`,
    filterFrom: (position) => `Filter ${position} — from`,
    filterTo: (position) => `Filter ${position} — to`,
    filterField: (position) => `Filter ${position} — field`,
    filterCondition: (position) => `Filter ${position} — condition`,
    filterValue: (position) => `Filter ${position} — value`,
    rangeEnd: "To",
    condition: "Condition",
    // The control's own words, borrowed by the engine pack's sentence clause
    // ("…, split by …"), so the sentence under a chart and the field that
    // produced it agree.
    splitSeries: "Split into series",
    seriesBy: "One series per",
    groupBy: "Group by",
    aggregation: "Aggregation",
    visualization: "Visualisation",
    widthHeading: "Width",
    filtersHeading: "Filters",
    measuresHeading: "Measures",
    rangeStartPlaceholder: "From",
    fieldLabel: "Field",
    axisLabel: "X axis",
    grainLabel: "By",
    stacked: "Stacked",
    duplicate: "Duplicate",
    exportCsv: "Export CSV",
    grouping: "Grouping",
    discard: "Discard",
    statusLabel: "Status",
    nameLabel: "Name",
    done: "Done",
    operators: {
      eq: "equal to",
      neq: "not equal to",
      in: "is one of",
      gte: "from",
      lte: "up to",
      between: "between",
    },
    charts: {
      table: "Table",
      kpi: "Number",
      line: "Line",
      bar: "Bars",
      area: "Area",
      pie: "Pie",
      donut: "Doughnut",
    },
    aggregations: {
      sum: "Sum",
      avg: "Average",
      count: "Count",
      count_distinct: "Distinct count",
      min: "Minimum",
      max: "Maximum",
      p50: "Median (p50)",
      p90: "90th percentile (p90)",
      p95: "95th percentile (p95)",
      ratio: "Ratio (sum ÷ sum)",
    },
    needsRole:
      "Choose at least one role to share with — or change the visibility to 'Author and admins only'.",
    rolesLoading: "Loading roles…",
    rolesFailed:
      "Could not load the roles. Reload the page and try again before saving.",
    rolesHeading: "Roles with access (the author and admins always see it):",
    rolesEmpty: "No roles available in this store.",
    moved: (label, position, total) => `${label} moved to position ${position} of ${total}`,
    period: "Period",
    breadcrumbAria: "Breadcrumb",
    breadcrumb: EN_US_BREADCRUMB_COPY,
    defaultRange: "Default period on opening",
    defaultRanges: {
      today: "Today",
      "7d": "Last 7 days",
      "30d": "Last 30 days",
      month: "This month",
    },
    customRange: "Custom period",
    quickRangesHeading: "Quick periods",
    quickRanges: {
      today: "Today",
      yesterday: "Yesterday",
      "this-week": "This week",
      "last-7-days": "7 days",
      "this-month": "This month",
      "last-30-days": "30 days",
      "this-quarter": "This quarter",
      "this-year": "This year",
      "last-365-days": "365 days",
    },
    dateFrom: "Start date",
    dateTo: "End date",
    rangeIncomplete: "Give the start and end dates of the period.",
    rangeReversed: "The end date must be the same as or later than the start date.",
    rangeOverMax: (maxRangeDays) => `The period cannot exceed ${maxRangeDays} days.`,
    backToList: "Reports",
  },
  settings: {
    title: "Report settings",
    descriptionLabel: "Description",
    descriptionPlaceholder: "What is this report for?",
    descriptionHelper: "Shown on the list card — it helps the team find the right one.",
    statusCards: {
      published: {
        title: "Published",
        description: "Appears in the list for anyone with access.",
      },
      draft: {
        title: "Draft",
        description: "Only you see it, even when shared.",
      },
    },
    visibilityCards: {
      private: { title: "Only you", description: "Nobody else in the store sees it." },
      tenant: {
        title: "The whole team",
        description: "Anyone with access to the store's backoffice.",
      },
      roles: {
        // The caveat is the point of this card, not decoration: cost fields
        // stay hidden from anyone without the permission, whatever role they
        // hold. Dropping it would read as "these roles see everything".
        title: "Named roles",
        description:
          "Cost fields stay hidden from anyone without the permission, whatever role they hold.",
      },
    },
    scheduleLabel: "Automatic delivery",
    scheduleValue: "E-mail it every Monday at 8am",
    scheduleReason: "Coming soon (FUT-776) — delivery cannot be scheduled yet.",
    visibilityLabel: "Who can see it",
    close: "Close",
  },
};
