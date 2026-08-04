'use client';

/**
 * A chip whose caveat is REACHABLE, not merely hoverable (FUT-495).
 *
 * The FUT-491 out-of-area badge rode a native `title` on a wrapper span: never
 * announced by assistive tech, and invisible on touch (no hover) — so the one
 * caveat that justifies showing an undeliverable price was missing for exactly
 * the users who most need it spelled out. The review flagged it; this is the
 * shape both caveats now share (out-of-area, and a failed source's reason):
 *
 * - a real tooltip — hover, keyboard focus, touch long-press — for the visible
 *   affordance, on a focusable wrapper so it is reachable without a mouse;
 * - the full text in the DOM, visually hidden, so every screen reader
 *   announces it WITH the chip instead of only while a tooltip happens to be
 *   open. That is also what makes the caveat assertable in a test without
 *   simulating hover.
 */
import type { JSX } from 'react';

import { Chip } from '@12-apps/ui/data-display/Chip';
import { Tooltip } from '@12-apps/ui/data-display/Tooltip';
import { Box } from '@12-apps/ui/mui/Box';

/** Off-screen but in the accessibility tree — the standard sr-only recipe. */
const VISUALLY_HIDDEN = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;

interface CaveatChipProps {
  /** The compact visible label — what fits beside a supplier or a source name. */
  label: string;
  /** The full explanation: tooltip text AND the announced description. */
  hint: string;
  color?: 'warning' | 'error';
  /** Test id of the wrapper — the hook every surface's test asserts on. */
  dataTestId: string;
}

export function CaveatChip({
  label,
  hint,
  color = 'warning',
  dataTestId,
}: CaveatChipProps): JSX.Element {
  return (
    // `describeChild`: the chip keeps its own label and GAINS the explanation,
    // rather than having it replace the label for screen readers.
    <Tooltip title={hint} describeChild maxWidth={340}>
      <Box
        component="span"
        data-testid={dataTestId}
        tabIndex={0}
        sx={{ display: 'inline-flex', alignItems: 'center', cursor: 'help' }}
      >
        <Chip label={label} size="small" variant="outlined" color={color} />
        <Box component="span" sx={VISUALLY_HIDDEN}>
          {hint}
        </Box>
      </Box>
    </Tooltip>
  );
}
