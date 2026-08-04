'use client';

import { Box, Button } from '@mui/material';
import type { ButtonProps } from '@mui/material';
import type { ReactNode } from 'react';

type Breakpoint = 'sm' | 'md' | 'lg';

export interface HeaderButtonProps {
  /** The label — shown next to the icon on wide screens, hidden (icon-only) below `collapseBelow`. */
  text: ReactNode;
  /** Leading icon/image — always visible. */
  icon: ReactNode;
  /** Optional trailing icon (e.g. a dropdown chevron) — always visible. */
  endIcon?: ReactNode;
  onClick?: ButtonProps['onClick'];
  /** MUI variant. @default 'contained' */
  variant?: ButtonProps['variant'];
  /** MUI color. @default 'primary' */
  color?: ButtonProps['color'];
  disabled?: boolean;
  /** Width below which the button collapses to icon-only. @default 'md' */
  collapseBelow?: Breakpoint;
  fullWidth?: boolean;
  'aria-haspopup'?: ButtonProps['aria-haspopup'];
  'aria-expanded'?: boolean;
  dataTestId?: string;
}

/**
 * A page-header action that adapts to width: below `collapseBelow` it renders
 * ONLY its icon (compact, so several fit one line on phones); at/above it renders
 * the icon + text label. The accessible name is always `text`, so the icon-only
 * state stays labeled for screen readers.
 */
export function HeaderButton({
  text,
  icon,
  endIcon,
  onClick,
  variant = 'contained',
  color = 'primary',
  disabled,
  collapseBelow = 'md',
  fullWidth,
  dataTestId,
  ...aria
}: HeaderButtonProps): React.JSX.Element {
  // Hide the label below the breakpoint; keep the icon(s). `gap` collapses around
  // the display:none label, so on mobile it reads as a compact icon button.
  const labelDisplay = { xs: 'none', [collapseBelow]: 'inline' };
  const horizontalPad = { xs: 1, [collapseBelow]: 2 };
  return (
    <Button
      variant={variant}
      color={color}
      size="medium"
      onClick={onClick}
      disabled={disabled}
      fullWidth={fullWidth}
      aria-label={typeof text === 'string' ? text : undefined}
      aria-haspopup={aria['aria-haspopup']}
      aria-expanded={aria['aria-expanded']}
      data-testid={dataTestId}
      sx={{ minWidth: 0, gap: 0.75, px: horizontalPad, py: 1, fontSize: '1rem', textTransform: 'none' }}
    >
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center' }}>
        {icon}
      </Box>
      <Box component="span" sx={{ display: labelDisplay }}>
        {text}
      </Box>
      {endIcon != null && (
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center' }}>
          {endIcon}
        </Box>
      )}
    </Button>
  );
}
