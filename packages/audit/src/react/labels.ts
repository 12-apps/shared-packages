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
 *
 * ## What the GRID's own chrome says, and why it is not here
 *
 * Since the trail moved onto `@12-apps/ui`'s `DataViews` grid, the words on the
 * controls that grid owns — the search box's placeholder, a range pill's
 * `De`/`Até`, the column and display panels, "Limpar filtros", the pager — come
 * from the host's `DataViewsCopy`, through the provider it already mounts for
 * every other list. That is the same rule this file states, one layer out: the
 * words belong to the host, declared once.
 *
 * Thirteen labels left with those controls (`searchPlaceholder`, `filterFrom`,
 * `filterTo`, the three `dayPlaceholder*`, `clearBound`, `sortByDate`,
 * `clearFilters`, `previousPage`, `nextPage`, `pageStatus`, `actorAny`). They
 * are REMOVED rather than kept as accepted-and-ignored config: a label a host
 * still passes and nothing renders is a promise the surface has stopped
 * keeping, and the compiler telling an adopter so at the call site is the whole
 * value of copy being config.
 */
import { AuditConfigError } from '../core/errors';

export interface AuditLabels {
  title: string;
  /** Heading of the `[i]` popover that explains the page. */
  aboutTitle: string;
  /** The one-paragraph explanation inside it. */
  about: string;
  columnDate: string;
  columnActor: string;
  /**
   * The impersonated subject, as the EXPORT's own column.
   *
   * On screen the pair is one cell over two lines; in a spreadsheet it has to
   * be a column of its own — "which rows happened during a support session" is
   * a question filtering and pivoting answer, and a suffix inside the actor
   * cell answers it for nobody.
   */
  columnOnBehalfOf: string;
  columnAction: string;
  columnResource: string;
  columnResourceId: string;
  columnChange: string;
  filterAction: string;
  filterResource: string;
  filterActor: string;
  /** The day-range pill's label — the window the trail is read over. */
  filterPeriod: string;
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
  /** The export button. */
  exportAction: string;
  exportCsv: string;
  exportJson: string;
  /** The downloaded file's base name (no extension). */
  exportFileName: string;
  /** "Only the first {count} entries were exported." */
  exportTruncated: string;
  /**
   * Why a saved-view mutation could not run — shown only where no host wired
   * persistence for the trail's table (an embedded trail, a bare mount).
   */
  viewsUnavailable: string;
}

export const DEFAULT_LABELS: AuditLabels = {
  title: 'Audit trail',
  aboutTitle: 'About the audit trail',
  about:
    'Everything recorded here is permanent: who did it, what changed and when. ' +
    'Entries cannot be edited or deleted.',
  columnDate: 'Date',
  columnActor: 'Actor',
  columnOnBehalfOf: 'On behalf of',
  columnAction: 'Action',
  columnResource: 'Resource',
  columnResourceId: 'Identifier',
  columnChange: 'Change',
  filterAction: 'Action',
  filterResource: 'Resource',
  filterActor: 'Actor',
  filterPeriod: 'Period',
  systemActor: 'System',
  onBehalfOf: '{actor} on behalf of {subject}',
  unknownActor: 'Deleted user',
  loading: 'Loading…',
  empty: 'No entries recorded for the chosen filters.',
  errorTitle: 'Could not load the audit trail',
  requestFailed: 'Could not load the audit trail.',
  retry: 'Try again',
  exportAction: 'Export',
  exportCsv: 'CSV (.csv)',
  exportJson: 'JSON (.json)',
  exportFileName: 'audit-trail',
  exportTruncated: 'Only the first {count} entries were exported.',
  viewsUnavailable: 'Saved views are not available on this screen.',
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
