'use client';

import { Drawer, Popover } from '@mui/material';

/** Chrome-free surface props: the panel draws its own border and shadow. */
const BARE_PAPER = { background: 'transparent', boxShadow: 'none' } as const;

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
      slotProps={{ paper: { sx: { ...BARE_PAPER, marginTop: '6px', overflow: 'visible' } } }}
    >
      {children}
    </Popover>
  );
}
