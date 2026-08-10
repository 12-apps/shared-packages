import type { SavedReportRecord } from './saved';

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
    blockCount: 1,
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
    updatedAt: record.updatedAt.toISOString(),
  };
}
