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
 * The matrix itself is `ComparisonMatrix`, shared with the per-screen
 * `PlanCompareDialog`; this module is only the disclosure around it.
 */
import { useState, type JSX } from 'react';

import { Button } from '@12-apps/ui/form/Button';
import { Box } from '@12-apps/ui/mui/Box';

import type { ComparisonTier } from '../plan-wire';
import { ComparisonMatrix } from './comparison-matrix';
import { buildMatrix } from './comparison-rows';
import type { ComparisonTableCopy } from './copy';

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
          <ComparisonMatrix
            tiers={tiers}
            sections={sections}
            copy={copy}
            dataTestId="plan-comparison-table"
          />
        </Box>
      ) : null}
    </Box>
  );
}
