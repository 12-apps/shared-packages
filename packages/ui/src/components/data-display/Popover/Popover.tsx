import type { PaperProps } from '@mui/material/Paper/index.js';
import Paper from '@mui/material/Paper/index.js';
import MuiPopover from '@mui/material/Popover/index.js';
import { alpha, keyframes, styled, type Theme } from '@mui/material/styles/index.js';
import React from 'react';

import type { PopoverProps } from './Popover.types';
import { shadowInk } from '../../../tokens/ink';
import { rem, rems } from '../../../tokens/relative';

// Define pulse animation
const pulseAnimation = (theme: Theme) => keyframes`
  0% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 1;
  }
  70% {
    box-shadow: 0 0 0 ${rem(theme, 10)} currentColor;
    opacity: 0;
  }
  100% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 0;
  }
`;

const StyledPaper = styled(Paper, {
  shouldForwardProp: (prop) => 
    !['customVariant', 'glow', 'pulse'].includes(prop as string),
})<{ 
  customVariant?: string; 
  glow?: boolean; 
  pulse?: boolean; 
}>(({ theme, customVariant, glow, pulse }) => ({
  borderRadius: theme.spacing(1.5),
  transition: 'all 0.3s ease',
  position: 'relative',
  overflow: 'hidden',

  // Variant styles
  ...(customVariant === 'default' && {
    backgroundColor: theme.palette.background.paper,
    border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
    boxShadow: theme.shadows[8],
  }),

  ...(customVariant === 'glass' && {
    backgroundColor: alpha(theme.palette.background.paper, 0.1),
    backdropFilter: `blur(${rem(theme, 20)})`,
    border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
    boxShadow: `${rems(theme, 0, 8, 32)} ${shadowInk(theme, 0.1)}`,
  }),

  ...(customVariant === 'arrow' && {
    backgroundColor: theme.palette.background.paper,
    border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
    boxShadow: theme.shadows[12],
  }),

  // Glow effect
  ...(glow && !pulse && {
    boxShadow: `${rems(theme, 0, 0, 20, 5)} ${alpha(theme.palette.primary.main, 0.3)} !important`,
    filter: 'brightness(1.05)',
  }),

  // Pulse animation
  ...(pulse && !glow && {
    position: 'relative',
    '&::after': {
      content: '""',
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      borderRadius: 'inherit',
      backgroundColor: theme.palette.primary.main,
      opacity: 0.1,
      animation: `${pulseAnimation(theme)} 2s infinite`,
      pointerEvents: 'none',
      zIndex: -1,
    },
  }),

  // Both glow and pulse
  ...(glow && pulse && {
    position: 'relative',
    boxShadow: `${rems(theme, 0, 0, 20, 5)} ${alpha(theme.palette.primary.main, 0.3)} !important`,
    filter: 'brightness(1.05)',
    '&::after': {
      content: '""',
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      borderRadius: 'inherit',
      backgroundColor: theme.palette.primary.main,
      opacity: 0.1,
      animation: `${pulseAnimation(theme)} 2s infinite`,
      pointerEvents: 'none',
      zIndex: -1,
    },
  }),
}));

/**
 * The paper's cap: 400 design px unless the caller says otherwise. `sx` has
 * always read a number of 1 or less as a fraction of the parent, and that stays so.
 */
const popoverCap =
  (maxWidth: number | undefined) =>
  (theme: Theme): string => {
    const cap = maxWidth ?? 400;
    return cap <= 1 && cap !== 0 ? `${cap * 100}%` : rem(theme, cap);
  };

export const Popover = React.forwardRef<HTMLDivElement, PopoverProps>(
  ({
    variant = 'default',
    glow = false,
    pulse = false,
    maxWidth,
    dataTestId,
    children,
    ...props
  }, ref) => (
      <MuiPopover
        ref={ref}
        data-testid={dataTestId || 'popover-content'}
        PaperProps={{
          component: StyledPaper as React.ComponentType<PaperProps>,
          customVariant: variant,
          glow,
          pulse,
          sx: { maxWidth: popoverCap(maxWidth) },
          ...props.PaperProps,
        } as PaperProps & { customVariant?: string; glow?: boolean; pulse?: boolean }}
        {...props}
      >
        {children}
      </MuiPopover>
    )
);

Popover.displayName = 'Popover';