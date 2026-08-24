/**
 * The full matrix, behind a disclosure.
 *
 * This is where every line the cards no longer print actually lives. The shape
 * is the point: a label is stated ONCE, across a row, with one cell per tier —
 * where four cards stated the same thirty labels four times and made a
 * left-to-right comparison something the reader had to do from memory.
 *
 * Closed by default. Most visits to this screen are "what am I on" and "what
 * does the next one cost", and both are answered above; the matrix is for the
 * one visit in ten that is actually comparing, and it costs that visit a
 * single press.
 *
 * ## Every word here is the host's, including the cells
 *
 * Rows and labels come from the payload. The two MARKS do not — a card's tick
 * sits beside a label that carries the meaning, but a matrix cell has no text
 * of its own, so ✓ and − are the cell's only reading and each needs a word.
 * They are required copy (`comparisonTable.included` / `.excluded`) rather
 * than a glyph this package words itself.
 *
 * ## The row set is built from the union, not from the first tier
 *
 * The host's builder emits the same sections in the same order for every tier
 * — that shape is what makes the comparison legible in the first place — but
 * this reads the union anyway and renders a missing cell as excluded. A host
 * whose tiers disagree gets a table with a hole in it, which is honest; the
 * alternative silently drops whatever the first tier happens not to have.
 */
import { useState, type JSX } from 'react';

import { Button } from '@12-apps/ui/form/Button';
import { Box } from '@12-apps/ui/mui/Box';
import { Text } from '@12-apps/ui/typography/Text';

import type { ComparisonLine, ComparisonTier } from '../plan-wire';
import type { ComparisonTableCopy } from './copy';
import { IncludedMark } from './marks';

/** One row: the label, and what each tier makes of it (by tier key). */
interface MatrixRow {
  label: string;
  cells: Map<string, ComparisonLine>;
}

interface MatrixSection {
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
 * Fold the cells into sections of rows, preserving the host's own order.
 *
 * First appearance wins for placement: a section or a label is positioned by
 * the cheapest tier that mentions it, and later tiers only fill cells in. That
 * keeps the reading order stable no matter which tier introduces a line.
 */
function buildMatrix(tiers: ComparisonTier[]): MatrixSection[] {
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
    // Section AND label: a label is only unique within its section, encoded as
    // a JSON pair so no separator can collide two different pairs.
    const key = JSON.stringify([sectionTitle, line.label]);
    let row = rowIndex.get(key);
    if (row === undefined) {
      row = { label: line.label, cells: new Map() };
      rowIndex.set(key, row);
      section.rows.push(row);
    }
    row.cells.set(tierKey, line);
  }
  return sections;
}

/**
 * One cell.
 *
 * A ceiling PRINTS rather than ticking: "até 100" against "até 20" is the
 * whole reason a row exists, and two identical ✓ marks would hide it. The
 * mark is kept beside it so the column still scans vertically.
 */
function MatrixCell({
  line,
  copy,
}: {
  line: ComparisonLine | undefined;
  copy: ComparisonTableCopy;
}): JSX.Element {
  const included = line?.included ?? false;
  const detail = included ? line?.detail ?? null : null;
  return (
    <Box
      component="td"
      sx={{
        py: 1,
        px: 1.5,
        borderBottom: '1px solid',
        borderColor: 'divider',
        textAlign: 'center',
        verticalAlign: 'middle',
      }}
    >
      {detail === null ? (
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <IncludedMark included={included} label={included ? copy.included : copy.excluded} />
        </Box>
      ) : (
        <Text as="span" size="sm">
          {detail}
        </Text>
      )}
    </Box>
  );
}

function MatrixHead({
  tiers,
  copy,
}: {
  tiers: ComparisonTier[];
  copy: ComparisonTableCopy;
}): JSX.Element {
  return (
    <Box component="thead">
      <Box component="tr">
        <Box
          component="th"
          scope="col"
          sx={{
            py: 1,
            px: 1.5,
            textAlign: 'left',
            borderBottom: '2px solid',
            borderColor: 'divider',
            // Sticky so the row label survives the horizontal scroll a
            // five-column table needs on anything narrower than a laptop.
            position: 'sticky',
            left: 0,
            bgcolor: 'background.paper',
            minWidth: 220,
          }}
        >
          <Text as="span" size="xs" weight="bold" color="secondary">
            {copy.featureColumn}
          </Text>
        </Box>
        {tiers.map((tier) => (
          <Box
            key={tier.key}
            component="th"
            scope="col"
            sx={{
              py: 1,
              px: 1.5,
              textAlign: 'center',
              borderBottom: '2px solid',
              borderColor: tier.current ? 'primary.main' : 'divider',
              minWidth: 110,
            }}
          >
            <Text as="span" size="sm" weight="bold">
              {tier.name}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function MatrixBody({
  sections,
  tiers,
  copy,
}: {
  sections: MatrixSection[];
  tiers: ComparisonTier[];
  copy: ComparisonTableCopy;
}): JSX.Element {
  return (
    <>
      {sections.map((section) => (
        <Box component="tbody" key={section.title}>
          <Box component="tr">
            <Box
              component="th"
              scope="colgroup"
              colSpan={tiers.length + 1}
              sx={{
                py: 1,
                px: 1.5,
                textAlign: 'left',
                bgcolor: 'action.hover',
                borderBottom: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Text as="span" size="xs" weight="bold" color="secondary">
                {section.title.toUpperCase()}
              </Text>
            </Box>
          </Box>
          {section.rows.map((row) => (
            <Box component="tr" key={row.label}>
              <Box
                component="th"
                scope="row"
                sx={{
                  py: 1,
                  px: 1.5,
                  textAlign: 'left',
                  fontWeight: 'normal',
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  position: 'sticky',
                  left: 0,
                  bgcolor: 'background.paper',
                }}
              >
                <Text as="span" size="sm">
                  {row.label}
                </Text>
              </Box>
              {tiers.map((tier) => (
                <MatrixCell key={tier.key} line={row.cells.get(tier.key)} copy={copy} />
              ))}
            </Box>
          ))}
        </Box>
      ))}
    </>
  );
}

export function ComparisonTable({
  tiers,
  copy,
}: {
  tiers: ComparisonTier[];
  copy: ComparisonTableCopy;
}): JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (tiers.length === 0) return null;
  const sections = buildMatrix(tiers);
  if (sections.length === 0) return null;

  return (
    <Box>
      <Button
        variant="text"
        size="sm"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        data-testid="plan-compare-toggle"
      >
        {open ? copy.close : copy.open}
      </Button>
      {/* Unmounted rather than hidden while closed: ~30 rows × 5 columns is
          real DOM, and nothing below depends on it existing. */}
      {open ? (
        <Box
          sx={{ mt: 1, overflowX: 'auto', border: 1, borderColor: 'divider', borderRadius: 2 }}
        >
          <Box
            component="table"
            data-testid="plan-comparison-table"
            sx={{ width: '100%', borderCollapse: 'collapse' }}
          >
            <MatrixHead tiers={tiers} copy={copy} />
            <MatrixBody sections={sections} tiers={tiers} copy={copy} />
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}
