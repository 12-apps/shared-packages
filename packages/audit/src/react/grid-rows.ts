/**
 * The trail's rows, in the shape the shared grid takes them.
 *
 * A `DataViews` grid reads FLAT, pre-formatted values: its filter accessors,
 * its search scan, its export and its saved-view state all address a row by
 * key, so every cell this screen shows is resolved here — the stamp in the
 * host's locale, the actor pair as one sentence, the vocabulary's words for the
 * action and the resource, the redacted diff as a summary line.
 *
 * Doing it once, at the boundary, is what lets the columns stay declarations.
 * The alternative — a `cell` renderer per column reaching back into the wire
 * row plus the vocabulary plus the labels — is the same three lookups written
 * six times, and it puts the ACTOR PAIR (the fact this trail exists to keep)
 * behind a renderer where the export and the search cannot see it.
 *
 * Both `formatDiff` and the actor sentences came from the hand-rolled table
 * this replaces, unchanged: what changed is the table, not what a row says.
 */
import type { AuditLogWire } from '../core/types';
import type { AuditVocabulary } from '../core/vocabulary';

import { formatLabel, type AuditLabels } from './labels';

/**
 * One entry as the grid renders, filters, searches and exports it.
 *
 * Extends `Record<string, unknown>` to satisfy the grid's row constraint — the
 * estate-wide convention for a DataViews row type.
 */
export interface AuditRow extends Record<string, unknown> {
  id: string;
  /** The raw stamp, kept so a host formatting its own export still has it. */
  createdAt: string;
  /** `YYYY-MM-DD`, the day the period range filter compares against. */
  createdDay: string;
  /** The stamp in the surface's locale. */
  dateLabel: string;
  /** "Who · under which role", or the system label for an actorless entry. */
  actorLabel: string;
  /** "<actor> on behalf of <subject>", or `null` for an ordinary entry. */
  onBehalfOfLabel: string | null;
  /** The actor's id — what the actor pill filters on (`''` = a system write). */
  actorUserId: string;
  /** The raw action id — what the action pill filters on. */
  action: string;
  actionLabel: string;
  /** The raw resource type id — what the resource pill filters on. */
  resourceType: string;
  resourceLabel: string;
  resourceId: string;
  /** The redacted diff, as one "field: before → after" line. */
  changeLabel: string;
}

/** Compact "field: before → after" summary of the redacted diff. */
export function formatDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys
    .map((key) => {
      const was = before[key];
      const now = after[key];
      if (was === undefined) return `${key}: ${String(now)}`;
      if (now === undefined) return `${key}: ${String(was)}`;
      return `${key}: ${String(was)} → ${String(now)}`;
    })
    .join(' · ');
}

/** "Who · under which role", or the system label for an actorless entry. */
function actorText(entry: AuditLogWire, labels: AuditLabels): string {
  if (!entry.actorUserId) return labels.systemActor;
  const name = entry.actorName ?? labels.unknownActor;
  return entry.actorRole ? `${name} · ${entry.actorRole}` : name;
}

/**
 * The impersonated subject's line, or `null` for an ordinary entry.
 *
 * Rendered BESIDE the actor, never instead of it. The pair is what lets "who
 * really did this" and "who did the screen claim to be" be answered
 * independently; a row that collapsed them would lose exactly the fact the
 * column exists to keep — a support session would read as the owner working
 * alone.
 */
function onBehalfOfText(entry: AuditLogWire, labels: AuditLabels): string | null {
  if (!entry.onBehalfOfUserId) return null;
  return formatLabel(labels.onBehalfOf, {
    actor: entry.actorUserId ? (entry.actorName ?? labels.unknownActor) : labels.systemActor,
    subject: entry.onBehalfOfName ?? labels.unknownActor,
  });
}

/** What a row needs resolving: the host words, the vocabulary, the clock. */
interface AuditRowContext {
  labels: AuditLabels;
  vocabulary: AuditVocabulary;
  formatDate: (iso: string) => string;
  /**
   * The reader's tag, carried to the two vocabulary labels below.
   *
   * Threaded down to HERE rather than resolved once in `surfaceParts`: a label
   * read at mount answers every later render in the language the surface was
   * built with, and in a browser that is the language of whoever loaded the
   * tab. Absent means nobody said — the host's own resolver decides what that
   * falls back to.
   */
  locale?: string;
}

/** One wire entry → one grid row. */
export function toAuditRow(entry: AuditLogWire, context: AuditRowContext): AuditRow {
  const { labels, vocabulary, formatDate, locale } = context;
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    // The ISO day, sliced rather than re-derived through a Date: the wire
    // stamp is already ISO-8601 and `YYYY-MM-DD` strings compare correctly
    // with `<`/`>`, which is the whole reason the period filter is a day range
    // and not a number over timestamps.
    createdDay: entry.createdAt.slice(0, 10),
    dateLabel: formatDate(entry.createdAt),
    actorLabel: actorText(entry, labels),
    onBehalfOfLabel: onBehalfOfText(entry, labels),
    actorUserId: entry.actorUserId ?? '',
    action: entry.action,
    actionLabel: vocabulary.actionLabel(entry.action, { locale }),
    resourceType: entry.resourceType,
    resourceLabel: vocabulary.resourceLabel(entry.resourceType, { locale }),
    resourceId: entry.resourceId,
    changeLabel: formatDiff(entry.before, entry.after),
  };
}

/** A page of wire entries → the grid's rows. */
export function toAuditRows(
  entries: readonly AuditLogWire[],
  context: AuditRowContext,
): AuditRow[] {
  return entries.map((entry) => toAuditRow(entry, context));
}
