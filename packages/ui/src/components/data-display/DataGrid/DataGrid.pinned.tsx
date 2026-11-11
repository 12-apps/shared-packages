/**
 * The pinned row's paint and its screen-reader text (FUT-4745).
 *
 * One home for both, shared by the DataGrid's table row and the DataViews
 * card, so a pinned record reads the same in every layout. The tint is the
 * theme's SUCCESS colour at the theme's own selection opacity — no literal
 * colour anywhere — so it follows a host's brand palette and is twice as
 * strong in dark mode, where MUI's `selectedOpacity` is 0.16 against 0.08.
 */
import Box from '@mui/material/Box/index.js';
import { alpha, type Theme } from '@mui/material/styles/index.js';
import type React from 'react';

import { VISUALLY_HIDDEN_SX } from '../../../platform/visually-hidden';

/** The pinned row's background: success at the selection opacity. */
export function pinnedRowTint(theme: Theme): string {
  return alpha(theme.palette.success.main, theme.palette.action.selectedOpacity);
}

/** The same tint under the pointer, deepened by the hover opacity. */
export function pinnedRowHoverTint(theme: Theme): string {
  const { selectedOpacity, hoverOpacity } = theme.palette.action;
  return alpha(theme.palette.success.main, selectedOpacity + hoverOpacity);
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
