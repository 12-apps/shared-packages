/**
 * The pinned row's paint and its screen-reader text (FUT-4745).
 *
 * One home for both, shared by the DataGrid's table row and the DataViews
 * card, list row and board card, so a pinned record reads the same in every
 * layout. Two signals, so colour is never the only one:
 *
 * - a 3px ACCENT bar on the row's leading edge, in `primary.main`;
 * - a FAINT fill of `primary.main`, in light mode only.
 *
 * Primary, not success: the store's brand wins, and a green row put a red
 * "Cancelado" chip beside green. The fill is capped by the row's own red text:
 * `error.main` must keep 4.5:1 on it, hovered included (success at 0.08 fell to
 * 4.49 in light and 3.92 in dark).
 *
 * Dark mode carries NO fill, measured rather than assumed: the grid sits on an
 * elevation-1 Paper, whose white overlay makes the dark surface rgb(30,30,30),
 * where `error.main` text is already at 4.52:1 on a PLAIN row. Any primary wash
 * lightens that surface and takes it under 4.5 (0.05 gives 4.07). So in dark the
 * bar and the label mark the row, and hover is the same as every other row's.
 */
import Box from '@mui/material/Box/index.js';
import { alpha, type Theme } from '@mui/material/styles/index.js';
import type React from 'react';

import { VISUALLY_HIDDEN_SX } from '../../../platform/visually-hidden';
import { rem } from '../../../tokens/relative';

/** The light-mode fill's opacity at rest. */
export const PINNED_FILL_OPACITY = 0.05;
/** The light-mode fill's opacity under the pointer — `error.main` text still passes on it. */
export const PINNED_HOVER_OPACITY = 0.06;

/** The pinned row's background: a faint primary wash in light mode, none in dark. */
export function pinnedRowTint(theme: Theme): string {
  return alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0 : PINNED_FILL_OPACITY);
}

/** Under the pointer: a touch deeper in light mode; in dark, every row's own hover. */
export function pinnedRowHoverTint(theme: Theme): string {
  if (theme.palette.mode === 'dark') return theme.palette.action.hover;
  return alpha(theme.palette.primary.main, PINNED_HOVER_OPACITY);
}

/**
 * The leading-edge accent: a 3px inset shadow in the primary colour. A shadow,
 * not a border, so it takes no width and nothing beside it moves.
 */
export function pinnedRowAccent(theme: Theme): string {
  return `inset ${rem(theme, 3)} 0 0 ${theme.palette.primary.main}`;
}

/**
 * The host's words for the pinned row, out of sight and read aloud. Renders
 * nothing without a label: the package has no wording of its own to fall
 * back to.
 */
export function PinnedRowLabel({ label }: { label?: string }): React.JSX.Element | null {
  if (!label) return null;
  return (
    <Box component="span" data-slot="pinned-label" sx={VISUALLY_HIDDEN_SX}>
      {label}
    </Box>
  );
}
