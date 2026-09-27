import { useTheme } from '@mui/material/styles/index.js';
import type { ReactNode } from 'react';

import { rem } from '../../../tokens/scales';

import { Box, CONTROL_RESET, focusRing } from './SectionNav.parts';

export interface RaisedActionButtonProps {
  /** The button's accessible name — it has no visible label. */
  label: string;
  icon: ReactNode;
  onClick: () => void;
  /**
   * Whether what the button opens is open. Omit for a button that opens
   * nothing (a plain action): it then carries no `aria-expanded` and its icon
   * never turns.
   */
  open?: boolean;
  /** The name it takes while `open` — the same control closes what it opened. REQUIRED with `open`. */
  closeLabel?: string;
  dataTestId?: string;
}

/**
 * The raised round button in the middle of a bottom bar — the one control in
 * the row that is an ACTION rather than a place.
 *
 * Lifted half out of the bar so it reads as different in kind from the tabs
 * beside it, and unlabelled so it costs the row less width than a tab: that
 * width is what lets a bar keep four labelled tabs AND this button at 320px.
 *
 * `SectionNav` draws it for its `primary` menu. It is exported on its own for
 * a bar the host already draws — drop it between two tabs, in a flex row.
 */
export function RaisedActionButton({
  label,
  icon,
  onClick,
  open,
  closeLabel,
  dataTestId = 'raised-action',
}: RaisedActionButtonProps): React.JSX.Element {
  const theme = useTheme();
  const size = rem(theme, 52);
  const expanded = open === true;
  return (
    <Box sx={{ flex: 'none', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', px: 0.5 }}>
      <Box
        component="button"
        type="button"
        onClick={onClick}
        aria-label={expanded && closeLabel ? closeLabel : label}
        aria-expanded={open}
        data-testid={dataTestId}
        sx={{
          ...CONTROL_RESET,
          ...focusRing(theme),
          width: size,
          height: size,
          // Lifted half out of the bar: the one control that is not a place.
          marginTop: rem(theme, -18),
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
          boxShadow: theme.shadows[6],
          '& svg': {
            fontSize: rem(theme, 26),
            transition: theme.transitions.create('transform', { duration: theme.transitions.duration.shorter }),
            transform: expanded ? 'rotate(45deg)' : 'none',
          },
          '@media (prefers-reduced-motion: reduce)': { '& svg': { transition: 'none' } },
        }}
      >
        {icon}
      </Box>
    </Box>
  );
}
