'use client';

import Drawer from '@mui/material/Drawer';
import Popover from '@mui/material/Popover';

import { stackedOverlayZIndex } from '../../../tokens/layers';

/** Chrome-free surface props: the panel draws its own border and shadow. */
const BARE_PAPER = { background: 'transparent', boxShadow: 'none' } as const;

/**
 * Both surfaces clear the sheet ladder rather than taking MUI's default.
 *
 * A `Popover` defaults to `zIndex.modal` and a temporary `Drawer` to
 * `zIndex.drawer`, one step lower still — and `StackedModal` gives its second
 * panel 1310. So this panel opened UNDER the sheet that opened it, and, being a
 * live modal with an unreachable backdrop, took the focus of every field around
 * it with no way to dismiss it (12-57). See `tokens/layers`.
 */
const ABOVE_SHEETS = { zIndex: stackedOverlayZIndex } as const;

interface SurfaceProps {
  open: boolean;
  /** True below the sheet breakpoint — anchor to the bottom edge instead. */
  sheet: boolean;
  anchorEl: HTMLElement | null;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * Where the panel lives: anchored under the trigger on a pointer, or a bottom
 * sheet on a phone.
 *
 * Both surfaces are modal, which is what gives the panel its dismiss-on-outside,
 * Esc handling and focus containment for free rather than hand-rolled.
 */
export function CategoryPanelSurface({
  open,
  sheet,
  anchorEl,
  onClose,
  children,
}: SurfaceProps): React.JSX.Element {
  if (sheet) {
    return (
      <Drawer
        anchor="bottom"
        open={open}
        onClose={onClose}
        sx={ABOVE_SHEETS}
        slotProps={{ paper: { sx: BARE_PAPER } }}
      >
        {children}
      </Drawer>
    );
  }
  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      marginThreshold={8}
      sx={ABOVE_SHEETS}
      slotProps={{ paper: { sx: { ...BARE_PAPER, marginTop: '6px', overflow: 'visible' } } }}
    >
      {children}
    </Popover>
  );
}
