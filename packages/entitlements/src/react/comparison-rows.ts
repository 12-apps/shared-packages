/**
 * The comparison matrix's DATA half, pure: the payload folded into sections
 * of rows (`buildMatrix`), and cut down to a screen's own rows by stable key
 * (`selectComparisonRows`). `comparison-matrix.tsx` draws what this builds.
 */
import type { ComparisonLine, ComparisonRowRequest, ComparisonTier } from '../plan-wire';

/** One row: the label, and what each tier makes of it (by tier key). */
export interface MatrixRow {
  id: string;
  label: string;
  cells: Map<string, ComparisonLine>;
}

export interface MatrixSection {
  title: string;
  rows: MatrixRow[];
}

/**
 * Every cell in the whole comparison, as one flat sequence.
 *
 * Flattened rather than walked as tiers-then-sections-then-lines because the
 * traversal IS flat in substance — one pass over the payload, every level
 * indexed by a Map — and three nested loops say "join" to every reader and to
 * the complexity gate alike.
 */
interface FlatCell {
  tierKey: string;
  sectionTitle: string;
  line: ComparisonLine;
}

function flatCells(tiers: ComparisonTier[]): FlatCell[] {
  return tiers.flatMap((tier) =>
    tier.sections.flatMap((section) =>
      section.lines.map((line) => ({
        tierKey: tier.key,
        sectionTitle: section.title,
        line,
      })),
    ),
  );
}

/**
 * A row's identity within its section: the line's stable `key` when the host
 * sent one, else its label. Encoded as a JSON tuple tagged by kind, so no
 * separator can collide two different pairs and a label can never pose as a
 * key.
 */
function rowId(sectionTitle: string, line: ComparisonLine): string {
  return JSON.stringify(
    line.key === undefined ? [sectionTitle, 'label', line.label] : [sectionTitle, 'key', line.key],
  );
}

/**
 * Fold the cells into sections of rows, preserving the host's own order.
 *
 * First appearance wins for placement: a section or a row is positioned by
 * the cheapest tier that mentions it, and later tiers only fill cells in. That
 * keeps the reading order stable no matter which tier introduces a line.
 */
export function buildMatrix(tiers: ComparisonTier[]): MatrixSection[] {
  const sections: MatrixSection[] = [];
  const sectionIndex = new Map<string, MatrixSection>();
  const rowIndex = new Map<string, MatrixRow>();

  for (const { tierKey, sectionTitle, line } of flatCells(tiers)) {
    let section = sectionIndex.get(sectionTitle);
    if (section === undefined) {
      section = { title: sectionTitle, rows: [] };
      sectionIndex.set(sectionTitle, section);
      sections.push(section);
    }
    const id = rowId(sectionTitle, line);
    let row = rowIndex.get(id);
    if (row === undefined) {
      row = { id, label: line.label, cells: new Map() };
      rowIndex.set(id, row);
      section.rows.push(row);
    }
    row.cells.set(tierKey, line);
  }
  return sections;
}

/**
 * The tiers cut down to the lines a screen asked for, by STABLE key.
 *
 * Every tier is kept — the point is to see the same rows across all of them —
 * but each keeps only the lines whose `key` is in `keys`, and a section left
 * with nothing drops out. A key no line carries is ignored rather than an
 * error: the screen names the rows it is about, and a host that has not
 * shipped one yet must not break the dialog. A line without a `key` is never
 * picked; filtering by translated label is exactly what the key exists to
 * avoid.
 */
export function selectComparisonRows(
  tiers: ComparisonTier[],
  keys: readonly string[],
): ComparisonTier[] {
  const wanted = new Set(keys);
  return tiers.map((tier) => ({
    ...tier,
    sections: tier.sections
      .map((section) => ({
        ...section,
        lines: section.lines.filter((line) => line.key !== undefined && wanted.has(line.key)),
      }))
      .filter((section) => section.lines.length > 0),
  }));
}

/** The line a tier carries for a stable key, whichever section it sits in. */
function lineForKey(tier: ComparisonTier, key: string): ComparisonLine | undefined {
  for (const section of tier.sections) {
    const found = section.lines.find((line) => line.key === key);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * The matrix for a screen's OWN rows: one row per request, in the screen's
 * order, labelled with the screen's words and marked from each tier's line
 * that carries the request's key.
 *
 * The screen words its rows because what a feature means HERE is the
 * screen's to say ("Export to PDF" rather than the catalogue's "Reports"), not the plan
 * page's catalogue sentence. So the same key may open several rows: one
 * entitlement can gate several things the screen lists apart, and each gets a
 * row of its own (the row's identity is its position, never its key). A key
 * no tier carries drops its row, as an unknown key does for `keys`: a host
 * that has not shipped the line yet must not paint a column of crosses
 * claiming no plan includes the thing. A tier that lacks a line others
 * carry reads as not including it, like every matrix here.
 *
 * One untitled section: the screen's rows are one list, and the matrix
 * draws no heading for a single section.
 */
export function buildRowsMatrix(
  tiers: ComparisonTier[],
  rows: readonly ComparisonRowRequest[],
): MatrixSection[] {
  const built = rows.flatMap((request, index): MatrixRow[] => {
    const cells = new Map<string, ComparisonLine>();
    for (const tier of tiers) {
      const line = lineForKey(tier, request.key);
      if (line !== undefined) cells.set(tier.key, line);
    }
    if (cells.size === 0) return [];
    return [{ id: JSON.stringify(['row', index, request.key]), label: request.label, cells }];
  });
  return built.length === 0 ? [] : [{ title: '', rows: built }];
}

/** The distinct keys of a screen's rows, in first-seen order. */
export function keysOfRows(rows: readonly ComparisonRowRequest[]): string[] {
  return [...new Set(rows.map((row) => row.key))];
}
