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
  loadFailedTitle: string;
  loadFailedBody: string;
}

/** Everything these screens render, in one object a host passes once. */
export interface ReportScreensCopy {
  list: ReportListCopy;
  view: ReportViewCopy;
}
