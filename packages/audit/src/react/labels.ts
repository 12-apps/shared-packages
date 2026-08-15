/**
 * The viewer's user-facing copy.
 *
 * ENGLISH by default, and that default is a FALLBACK rather than a
 * recommendation. A screen has to render some language, and the only defensible
 * default for a package is its own documented one — this surface used to
 * default to the extraction origin's market language, so an adopter that never
 * passed `labels` shipped somebody else's locale to its users with nothing to
 * notice it by. Pass your product's copy.
 *
 * ACTION and RESOURCE labels are NOT here — they belong to the vocabulary, so
 * the list of actions and the list of their names cannot drift. They were
 * separate files in separate apps before this package existed, and did: nine
 * actions the writer could emit had no label at all and rendered a raw dotted
 * id to an operator.
 */
import { AuditConfigError } from '../core/errors';

export interface AuditLabels {
  title: string;
  /** The one-paragraph explanation above the list. */
  about: string;
  columnDate: string;
  columnActor: string;
  columnAction: string;
  columnResource: string;
  columnResourceId: string;
  columnChange: string;
  filterAction: string;
  filterResource: string;
  filterActor: string;
  filterFrom: string;
  filterTo: string;
  /**
   * The day bounds' placeholder segments, in the host's words.
   *
   * The ORDER they appear in is the locale's (see `resolveDayFormat`); these are
   * only the letters, which are a translation like any other — a Brazilian
   * merchant reads `aaaa` where an English one reads `yyyy`, and a field that
   * spells its own format is the difference between typing it right the first
   * time and discovering the order by getting it wrong.
   */
  dayPlaceholderDay: string;
  dayPlaceholderMonth: string;
  dayPlaceholderYear: string;
  /**
   * Accessible name for ONE bound's clear button — "{field}" is the bound's own
   * label. Each bound carries its own, because clearing just "From" otherwise
   * means pressing "Clear filters" and losing every other filter on the screen.
   */
  clearBound: string;
  /** Accessible name for the date column's sort toggle. */
  sortByDate: string;
  /** Placeholder for the free-text resource-id search. */
  searchPlaceholder: string;
  /** The actor cell for an entry with no actor (a webhook, a job). */
  systemActor: string;
  /**
   * "<actor> on behalf of <subject>" — the impersonation PAIR, rendered as one
   * line naming BOTH people. `{actor}` and `{subject}` are substituted.
   */
  onBehalfOf: string;
  /** The label for an id the directory could not resolve to a name. */
  unknownActor: string;
  loading: string;
  empty: string;
  errorTitle: string;
  /**
   * What a failed read reports when the server sent no message of its own — the
   * default transport's fallback. Distinct from {@link errorTitle}: that heads
   * the error panel, this is the sentence under it.
   */
  requestFailed: string;
  retry: string;
  clearFilters: string;
  previousPage: string;
  nextPage: string;
  /** "Page {page} of {pageCount} · {total} entries". */
  pageStatus: string;
  actorAny: string;
}

export const DEFAULT_LABELS: AuditLabels = {
  title: 'Audit trail',
  about:
    'Everything recorded here is permanent: who did it, what changed and when. ' +
    'Entries cannot be edited or deleted.',
  columnDate: 'Date',
  columnActor: 'Actor',
  columnAction: 'Action',
  columnResource: 'Resource',
  columnResourceId: 'Identifier',
  columnChange: 'Change',
  filterAction: 'Action',
  filterResource: 'Resource',
  filterActor: 'Actor',
  filterFrom: 'From',
  filterTo: 'To',
  dayPlaceholderDay: 'dd',
  dayPlaceholderMonth: 'mm',
  dayPlaceholderYear: 'yyyy',
  clearBound: 'Clear {field}',
  sortByDate: 'Sort by date',
  searchPlaceholder: 'Search by identifier',
  systemActor: 'System',
  onBehalfOf: '{actor} on behalf of {subject}',
  unknownActor: 'Deleted user',
  loading: 'Loading…',
  empty: 'No entries recorded for the chosen filters.',
  errorTitle: 'Could not load the audit trail',
  requestFailed: 'Could not load the audit trail.',
  retry: 'Try again',
  clearFilters: 'Clear filters',
  previousPage: 'Previous',
  nextPage: 'Next',
  pageStatus: 'Page {page} of {pageCount} · {total} entries',
  actorAny: 'All',
};

export type AuditLabelOverrides = Partial<AuditLabels>;

/**
 * The labels in force, refusing a blank override.
 *
 * A blank one renders an empty cell, an empty button or an empty heading — a
 * screen that reads as broken rather than as untranslated, and the likely cause
 * is a host threading its copy through a lookup that missed a key. Refused at
 * assembly rather than at render, so it is a failure to build the surface and
 * not a blank box an operator reports weeks later.
 */
export const createAuditLabels = (overrides?: AuditLabelOverrides): AuditLabels => {
  const merged = { ...DEFAULT_LABELS, ...overrides };
  for (const [key, value] of Object.entries(merged)) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new AuditConfigError(`labels.${key}`, 'must be a non-blank string.');
    }
  }
  return merged;
};

/** Fill `{name}` placeholders in a label. */
export function formatLabel(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}
