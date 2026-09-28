import Typography from '@mui/material/Typography/index.js';
import { useTheme, type SxProps, type Theme } from '@mui/material/styles/index.js';
import type { ReactNode } from 'react';

import { rem } from '../../../tokens/scales';

import { Box, CONTROL_RESET, SlotIcon, focusRing } from './SectionNav.parts';

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
  /**
   * Draw `label` under the button. A bar of VERBS names the act it is for; a
   * bar of places can leave its one action to the icon.
   */
  captioned?: boolean;
  /** Dimmed and not operable. */
  disabled?: boolean;
  /** A write it started is in flight: a spinner replaces the icon, and it is inert. */
  loading?: boolean;
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
  captioned = false,
  disabled = false,
  loading = false,
  dataTestId = 'raised-action',
}: RaisedActionButtonProps): React.JSX.Element {
  const theme = useTheme();
  const expanded = open === true;
  const inert = disabled || loading;
  return (
    <Box
      sx={{
        flex: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        px: 0.5,
      }}
    >
      <Box
        component="button"
        type="button"
        onClick={onClick}
        disabled={inert}
        aria-busy={loading || undefined}
        aria-label={expanded && closeLabel ? closeLabel : label}
        aria-expanded={open}
        data-testid={dataTestId}
        sx={raisedSx(theme, expanded)}
      >
        <SlotIcon icon={icon} loading={loading} />
      </Box>
      {captioned ? <RaisedCaption label={label} inert={inert} /> : null}
    </Box>
  );
}

/**
 * The label under a captioned button. Hidden from assistive tech: the button
 * already carries the same words as its name, and reading them twice is noise.
 */
function RaisedCaption({ label, inert }: { label: string; inert: boolean }): React.JSX.Element {
  return (
    <Typography
      component="span"
      variant="caption"
      aria-hidden
      sx={{ lineHeight: 1.3, mt: 0.25, whiteSpace: 'nowrap', color: inert ? 'text.disabled' : 'text.primary' }}
    >
      {label}
    </Typography>
  );
}

/** The round button: lifted half out of the bar, its icon turning while what it opened is open. */
function raisedSx(theme: Theme, expanded: boolean): SxProps<Theme> {
  const size = rem(theme, 52);
  return {
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
    '&:disabled': { cursor: 'default', bgcolor: 'action.disabledBackground', color: 'text.disabled', boxShadow: 'none' },
    '& svg': {
      fontSize: rem(theme, 26),
      transition: theme.transitions.create('transform', { duration: theme.transitions.duration.shorter }),
      transform: expanded ? 'rotate(45deg)' : 'none',
    },
    '@media (prefers-reduced-motion: reduce)': { '& svg': { transition: 'none' } },
  } as SxProps<Theme>;
}
