/**
 * Every word the report SCREENS render, as REQUIRED host config (FUT-760).
 *
 * The engine half already travels this way (`ReportEngineCopy`, PR #371); this
 * is the other thirty-eight files — the list, the editor, the viewer, the
 * settings dialog and the built-in dashboards, which between them carried
 * around a hundred Portuguese sentences with no field a host could decline
 * them with.
 *
 * Split from `./copy` rather than added to it because that file is the
 * package's config CONTRACT, read by anyone wiring the surface, and this is a
 * hundred keys of prose. `ReportBuilderCopy.screens` is the seam between them.
 *
 * Several entries are FUNCTIONS rather than templates with a placeholder. That
 * is deliberate: Portuguese agrees the noun with the count (`1 bloco` /
 * `2 blocos`) and puts the number where the sentence wants it, so only the
 * translator can decide the whole string. A `{count}` slot would be us
 * deciding word order on their behalf.
 */

/** The relative age a card's footer opens with. */
export interface ReportRelativeTimeCopy {
  /** Under a minute old. */
  now: string;
  minutes(count: number): string;
  hours(count: number): string;
  /** Exactly one day — named rather than counted, the way a reader says it. */
  yesterday: string;
  days(count: number): string;
  weeks(count: number): string;
}

/** The list screen: its heading, its filters, and one card. */
export interface ReportListCopy {
  title: string;
  subtitle: string;
  loadFailedTitle: string;
  loadFailedBody: string;
  retry: string;
  /** The filter pills, keyed by scope id. */
  scopes: Readonly<Record<string, string>>;
  search: string;
  create: string;
  /** The grid with nothing in it, and the same grid under a search. */
  emptyTitle: string;
  emptyBody: string;
  emptySearchBody: string;
  /** A card: its chips, its fallback description, its footer. */
  chipDraft: string;
  chipArchived: string;
  chipUnpublished: string;
  noDescription: string;
  blockCount(count: number): string;
  /** Who can read it, keyed by the stored visibility. */
  visibility: Readonly<Record<string, string>>;
  relativeTime: ReportRelativeTimeCopy;
  /** The card's kebab. */
  edit: string;
  archive: string;
  restore: string;
  /** The kebab's accessible name, given the report it belongs to. */
  cardMenu(reportName: string): string;
  /** The dashed 'start one' tile beside the cards. */
  newCardTitle: string;
  newCardHint: string;
}

/** The viewer: one saved report, read rather than edited. */
export interface ReportViewCopy {
  /** The `·`-separated subtitle under the title. */
  noDescription: string;
  /** "visível para toda a equipe" — the whole clause, given the audience. */
  visibleTo(audience: string): string;
  /** "editado há 2 min" — the whole clause, given the relative age. */
  editedAt(relativeTime: string): string;
  /** The breadcrumb back to the list. */
  breadcrumbList: string;
  export: string;
  /** The viewer's kebab action that opens the editor. */
  edit: string;
  loadFailedTitle: string;
  loadFailedBody: string;
  /** The retry beside a load failure. */
  retry: string;
}

/** The editor: its header, its exit guards, its canvas and one block. */
export interface ReportEditorCopy {
  /** The name field, which doubles as the breadcrumb when it is empty. */
  nameLabel: string;
  namePlaceholder: string;
  /**
   * "0 blocos · só você" — both halves change while the editor is open, so it
   * is composed rather than written down. The block count comes from the
   * list's own plural, so the two screens cannot disagree.
   */
  subtitle(blocks: string, audience: string): string;
  /** Who can read the draft, keyed by the stored visibility. */
  visibilityWords: Readonly<Record<string, string>>;
  autosaving: string;
  autosaveFailed: string;
  saving: string;
  save: string;
  breadcrumbList: string;
  breadcrumbEditing: string;
  /** The header's dirty marker, and the button that opens the settings. */
  unsavedChanges: string;
  settings: string;
  /** The banner over a draft being previewed against real data. */
  previewBanner: string;
  openFailedTitle: string;
  openFailedBody: string;
  retry: string;
  /** Leaving with unpublished work: one title, two bodies. */
  exitTitle: string;
  exitPublishedBody: string;
  exitDraftBody: string;
  exitConfirm: string;
  /** The standing bar over a report whose draft is ahead of its publication. */
  unpublishedTitle: string;
  unpublishedBody: string;
  discard: string;
  discarding: string;
  discardTitle: string;
  discardBody: string;
  discardConfirm: string;
  /** Why a save is refused. */
  needsName: string;
  needsBlock: string;
  /** The canvas: adding a block, and removing one. */
  addBlock: string;
  addBlockLimit(max: number): string;
  removeBlockTitle: string;
  removeBlockBody: string;
  removeBlockConfirm: string;
  /** One block's own chrome. */
  blockRunFailed: string;
  blockDragHint: string;
  /** The block's own kebab actions. */
  editBlock: string;
  removeBlock: string;
  /** The custom-range dialog's two buttons. */
  rangeApply: string;
  rangeCancel: string;
  /** The confirm dialog's way out. */
  confirmCancel: string;
  blockTitleLabel: string;
  moveUp: string;
  moveDown: string;
  blockMenu: string;
}

/** Archiving and restoring, from either the card menu or the viewer. */
export interface ReportArchiveCopy {
  restoreAction: string;
  restoreTitle: string;
  restoreBody: string;
  archiveAction: string;
  archiveTitle: string;
  /**
   * Two bodies, because the two entry points name a DIFFERENT way back: the
   * list says "Arquivados" (its own filter pill) and the viewer says
   * "Mostrar arquivados". Naming the wrong one sends the reader looking for a
   * control that is not on the screen they are on.
   */
  archiveBodyFromList: string;
  archiveBodyFromViewer: string;
  /** The confirm button while the write is in flight. */
  busy: string;
  /** The viewer's kebab. */
  reportMenu: string;
}

/** The periods and grains a report is read over. */
export interface ReportRangeCopy {
  /** Preset labels, keyed by range id. */
  ranges: Readonly<Record<string, string>>;
  /** Bucket labels, keyed by grain id. */
  grains: Readonly<Record<string, string>>;
  /** The block that ran and matched nothing. */
  emptyTitle: string;
  emptyBody: string;
  /** The empty state's offer to widen — "Ver 30 dias", given the period. */
  widen(rangeLabel: string): string;
}

/** The host's built-in reports and dashboards. */
export interface ReportSystemCopy {
  blockFailed: string;
  dashboardMissingTitle: string;
  dashboardMissingBody: string;
  reportFailedTitle: string;
  reportFailedBody: string;
  /** The retry beside a failed system report. */
  retry: string;
}

/**
 * The block builder: the panel, its fields, and the vocabulary of a query.
 *
 * The three label MAPS here — operators, chart kinds, aggregations — are copy
 * rather than data even though their keys are wire values: what an operator is
 * CALLED is a product decision (this host says "é um de" where another would
 * say "is one of"), while which operators exist is the engine's.
 */
export interface ReportBuilderPanelCopy {
  /** Nothing is selected, so the panel has nothing to edit. */
  emptySelection: string;
  duplicateBlocked(max: number): string;
  blockTitleLabel: string;
  /** What an empty title falls back to, quoting the derived one. */
  blockTitleHelper(autoTitle: string): string;
  untitledBlock: string;
  /** A duplicated block's name, given the original's. */
  copyOf(title: string): string;
  viewAsChart: string;
  viewAsTable: string;
  blockMenu: string;
  /** The per-row remove affordances, numbered because the rows are unlabelled. */
  removeFilter(position: number): string;
  removeMeasure(position: number): string;
  /** The plain remove button at the foot of the panel. */
  remove: string;
  /** The panel header's dismiss, which carries no visible label. */
  closePanel: string;
  /** The panel's own heading, which names whether a block is selected. */
  panelIdle: string;
  panelEditing: string;
  /** The template picker. */
  templateTitle: string;
  templateOption(title: string, description: string): string;
  templateHint: string;
  cancel: string;
  /**
   * Block heights, keyed by the stored height. `auto` is the segment with no
   * number, which is why the key set is not just 1..3.
   */
  heights: Readonly<Record<string, string>>;
  collection: string;
  /** The block-height picker's own heading. */
  height: string;
  /** One filter row. The index is 1-based, as the reader counts. */
  valuesPlaceholder: string;
  filterValues(position: number): string;
  filterFrom(position: number): string;
  filterTo(position: number): string;
  filterField(position: number): string;
  filterCondition(position: number): string;
  filterValue(position: number): string;
  rangeEnd: string;
  condition: string;
  /** The builder's section headings and field labels. */
  splitSeries: string;
  seriesBy: string;
  groupBy: string;
  aggregation: string;
  visualization: string;
  /**
   * The visible LABELS on the builder's own controls, as distinct from the
   * numbered accessible names above. Every one was a bare literal on the
   * element, so a host could set what a screen reader heard and not what the
   * eye read — the worse half to have got wrong.
   */
  widthHeading: string;
  filtersHeading: string;
  fieldLabel: string;
  axisLabel: string;
  grainLabel: string;
  stacked: string;
  duplicate: string;
  exportCsv: string;
  grouping: string;
  discard: string;
  statusLabel: string;
  nameLabel: string;
  done: string;
  operators: Readonly<Record<string, string>>;
  charts: Readonly<Record<string, string>>;
  aggregations: Readonly<Record<string, string>>;
  /** Why a share cannot be saved. */
  needsRole: string;
  /** The role picker inside the publish section. */
  rolesLoading: string;
  rolesFailed: string;
  rolesHeading: string;
  rolesEmpty: string;
  /** The keyboard reorder's live region. */
  moved(label: string, position: number, total: number): string;
  /** The period control, and the trail above it. */
  period: string;
  breadcrumbAria: string;
  /** The default period a report opens on, and its options. */
  defaultRange: string;
  defaultRanges: Readonly<Record<string, string>>;
  /**
   * The custom-window dialog: its heading, its quick ranges, and the refusals.
   *
   * The refusals are the SAME words the server uses, so a reader who ignores
   * the message and one who reaches the API by hand meet the same sentence.
   */
  customRange: string;
  quickRangesHeading: string;
  quickRanges: Readonly<Record<string, string>>;
  dateFrom: string;
  dateTo: string;
  rangeIncomplete: string;
  rangeReversed: string;
  rangeOverMax(maxRangeDays: number): string;
  /** The list link a built-in report's back button falls back to. */
  backToList: string;
}

/**
 * One choice card in the settings dialog.
 *
 * A pair rather than two flat keys because the title and its explanation are
 * one thought — a translator moving the qualifier from one to the other is
 * making a legitimate call, and a flat shape would hide that they are related.
 */
export interface ReportChoiceCardCopy {
  title: string;
  description: string;
}

/** The settings dialog: what a report IS, and who may read it. */
export interface ReportSettingsCopy {
  title: string;
  descriptionLabel: string;
  descriptionPlaceholder: string;
  descriptionHelper: string;
  /** The lifecycle cards, keyed by the stored status. */
  statusCards: Readonly<Record<string, ReportChoiceCardCopy>>;
  /** The audience cards, keyed by the stored visibility. */
  visibilityCards: Readonly<Record<string, ReportChoiceCardCopy>>;
  /** The inert scheduled-delivery row (FUT-776). */
  scheduleLabel: string;
  scheduleValue: string;
  scheduleReason: string;
  /** The audience field's own label, above the cards. */
  visibilityLabel: string;
  /** The dialog's dismiss, which carries no visible label. */
  close: string;
}

/** Everything these screens render, in one object a host passes once. */
export interface ReportScreensCopy {
  list: ReportListCopy;
  view: ReportViewCopy;
  editor: ReportEditorCopy;
  archive: ReportArchiveCopy;
  ranges: ReportRangeCopy;
  system: ReportSystemCopy;
  builder: ReportBuilderPanelCopy;
  settings: ReportSettingsCopy;
}
