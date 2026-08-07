import type { SavedReportRecord } from './saved';

/**
 * How a stored document is described in a LISTING — the shape both the picker
 * and the MCP `listSavedReports` tool read.
 */

/**
 * Lenient shape probe over the STORED document (never trusted): which variant
 * it is, and which entities it queries. A malformed or legacy value maps to no
 * entities, so it is listed for nobody rather than throwing the whole list.
 */
export function documentShape(spec: unknown): {
  type: 'report' | 'dashboard';
  entity: string;
  entities: string[];
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
    return { type: 'dashboard', entity: '', entities };
  }
  const entity = String(record.entity ?? '');
  return { type: 'report', entity, entities: entity === '' ? [] : [entity] };
}

export interface SavedReportSummary {
  id: string;
  name: string;
  description: string | null;
  type: 'report' | 'dashboard';
  entity: string;
  entities: string[];
  status: string;
  visibility: string;
  updatedAt: string;
}

export function toSummary(record: SavedReportRecord): SavedReportSummary {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    ...documentShape(record.spec),
    status: record.status,
    visibility: record.visibility,
    updatedAt: record.updatedAt.toISOString(),
  };
}
