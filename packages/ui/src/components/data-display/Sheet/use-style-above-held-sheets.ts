import { useTheme } from '@mui/material/styles/index.js';
import React from 'react';

import { levelAboveHeldSheets } from './held-sheet';

/** Which theme level the overlay opens at: a modal dialog, or a MUI drawer. */
export type OverlayLevel = 'modal' | 'drawer';

/**
 * An overlay's root style, lifted above any HELD sheet open as it opens
 * (FUT-4478, FUT-4748). A held sheet stays behind the question or the panel its
 * host opens next to it, and may sit above the overlay's own `zIndex` (a host's
 * stack, a host theme's lift); at its own level the overlay was drawn under the
 * sheet — unseen, unclickable. Read once per opening: the sheet is already on
 * screen then, and the level stays put while the overlay is answered. Inline,
 * so it outranks any class or `sx` rule that raised the sheet. With no held
 * sheet at or above the overlay's level, the caller's style is untouched.
 *
 * Shared by `AlertDialog` and `Dialog` so the two can never disagree.
 */
export function useStyleAboveHeldSheets(
  open: boolean | undefined,
  style: React.CSSProperties | undefined,
  level: OverlayLevel = 'modal',
): React.CSSProperties | undefined {
  const theme = useTheme();
  const ownLevel = theme.zIndex?.[level] ?? 0;
  const lifted = React.useMemo(() => (open ? levelAboveHeldSheets(ownLevel) : undefined), [open, ownLevel]);
  return lifted === undefined ? style : { ...style, zIndex: lifted };
}
