import type { SavedReportRecord } from './saved';
import { readWorkingCopy } from './working-copy';

/**
 * How a stored document is described in a LISTING — the shape both the picker
 * and the MCP `listSavedReports` tool read.
 */

/**
 * Lenient shape probe over the STORED document (never trusted): which variant
 * it is, which entities it queries, and how many blocks it holds. A malformed
 * or legacy value maps to no entities, so it is listed for nobody rather than
 * throwing the whole list.
 *
 * `blockCount` is what the list card says out loud ("3 blocos") and what its
 * sparkline is drawn from — the one number that tells a single chart apart
 * from a twelve-block dashboard before you open either. A single report is 1:
 * it is one block's worth of document, not zero.
 *
 * A document we could not READ is 0, though, and that is not the same claim.
 * The non-dashboard branch is also where every malformed value lands — `null`,
 * a string, a legacy row — so counting it as 1 would put "1 bloco" on a card
 * whose content we just failed to parse. An unreadable document already
 * reports no entities for exactly this reason; the count follows the same
 * signal, so the card says "0 blocos" and stops claiming to know.
 */
export function documentShape(spec: unknown): {
  type: 'report' | 'dashboard';
  entity: string;
  entities: string[];
  blockCount: number;
} {
  const record = typeof spec === 'object' && spec !== null ? (spec as Record<string, unknown>) : {};
  if (record.kind === 'dashboard') {
    const blocks = Array.isArray(record.blocks) ? record.blocks : [];
    const entities = [
      ...new Set(
        blocks
          .map((block) => {
            const inner =
              typeof block === 'object' && block !== null
                ? (block as { spec?: { entity?: unknown } }).spec
                : undefined;
            return String(inner?.entity ?? '');
          })
          .filter((entity) => entity !== ''),
      ),
    ];
    return { type: 'dashboard', entity: '', entities, blockCount: blocks.length };
  }
  const entity = String(record.entity ?? '');
  return {
    type: 'report',
    entity,
    entities: entity === '' ? [] : [entity],
    blockCount: entity === '' ? 0 : 1,
  };
}

export interface SavedReportSummary {
  id: string;
  name: string;
  description: string | null;
  type: 'report' | 'dashboard';
  entity: string;
  entities: string[];
  /** How many blocks the stored document holds; a single report is 1. */
  blockCount: number;
  status: string;
  visibility: string;
  /**
   * Whether the CALLER authored this document — the `Meus` scope of the list.
   *
   * Resolved here, against the actor the route already holds, rather than by
   * shipping `createdBy` and letting the client compare: a tenant's report list
   * would then carry a user id per row, which is an identifier nobody on that
   * screen needs and which no amount of client-side care can un-send.
   */
  ownedByMe: boolean;
  /**
   * A PUBLISHED report carrying an edit its author has not published yet
   * (FUT-755) — a state worth seeing on the list card without opening it.
   *
   * NOT the same claim as `status: 'draft'`, and the card draws them as two
   * different chips for exactly that reason: a draft has never been published,
   * while this one is live to its readers AND being changed.
   *
   * Reported to every viewer rather than only to authors: it is a property of
   * the document, not of the caller, and it discloses only THAT the report is
   * being edited — the parked content itself never rides a listing.
   */
  hasUnpublishedChanges: boolean;
  updatedAt: string;
}

/**
 * One stored row as the list reads it.
 *
 * `viewerId` is the signed-in user (`ReportActor.userId`), and it is required
 * rather than defaulted: every caller has an actor in hand, and a default would
 * make "nobody owns anything" the silent answer for a route that simply forgot
 * to pass it — a `Meus` scope that is always empty and never errors.
 */
export function toSummary(record: SavedReportRecord, viewerId: string | null): SavedReportSummary {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    ...documentShape(record.spec),
    status: record.status,
    visibility: record.visibility,
    // An anonymous actor owns nothing: `null === null` is true, and an
    // unauthenticated caller must not inherit every unattributed document.
    ownedByMe: record.createdBy !== null && record.createdBy === viewerId,
    // Through the same reader the EDITOR uses, so a card can never advertise
    // unpublished changes the editor then fails to open (or hide changes it
    // would happily resume).
    hasUnpublishedChanges: readWorkingCopy(record.workingCopy) !== null,
    updatedAt: record.updatedAt.toISOString(),
  };
}
