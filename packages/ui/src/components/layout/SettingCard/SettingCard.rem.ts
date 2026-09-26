import type { Theme } from '@mui/material/styles/index.js';

/**
 * A size drawn at `px`, as rem through the theme's type scale.
 *
 * A private copy of `tokens/relative`'s `rem()` (FUT-2591), which this
 * maintenance line predates: `theme.typography.pxToRem(px)` needs no gate or
 * shared vocabulary to be correct, and pulling the shared module forward
 * would drag its lint gate and exceptions ledger onto a line that only takes
 * security and backport fixes.
 */
export function rem(theme: Theme, px: number): string {
  return theme.typography.pxToRem(px);
}
