import MuiTooltip from '@mui/material/Tooltip/index.js';
import { alpha, keyframes, styled } from '@mui/material/styles/index.js';
import type { CSSObject, Theme } from '@mui/material/styles/index.js';
import React from 'react';

import type { TooltipProps } from './Tooltip.types';
import { absoluteInk, neutralTones } from '../../../tokens/ink';
import { rem, rems, sxRem } from '../../../tokens/relative';

// Define pulse animation
const pulseAnimation = keyframes`
  0% {
    transform: scale(1);
    opacity: 1;
  }
  70% {
    transform: scale(1.05);
    opacity: 0.8;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
`;

const SIZE_MAP = {
  sm: { fontSize: sxRem(12), padding: (theme: Theme) => rems(theme, 4, 8) },
  md: { fontSize: sxRem(14), padding: (theme: Theme) => rems(theme, 6, 12) },
  lg: { fontSize: sxRem(16), padding: (theme: Theme) => rems(theme, 8, 16) },
} as const;

const getSizeStyles = (
  size?: string,
): { fontSize: (theme: Theme) => string; padding: (theme: Theme) => string } =>
  SIZE_MAP[size as keyof typeof SIZE_MAP] || SIZE_MAP.md;

const variantStyles = (theme: Theme, variant?: string): CSSObject => {
  switch (variant) {
    case 'default':
      return {
        backgroundColor: alpha(neutralTones(theme).inverseSurface, 0.9),
        color: absoluteInk(theme).white,
      };
    case 'dark':
      return {
        backgroundColor: neutralTones(theme).inverseSurface,
        color: absoluteInk(theme).white,
      };
    case 'light':
      return {
        backgroundColor: absoluteInk(theme).white,
        color: theme.palette.text.primary,
        border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
        boxShadow: theme.shadows[4],
      };
    case 'glass':
      return {
        backgroundColor: alpha(theme.palette.background.paper, 0.1),
        backdropFilter: `blur(${rem(theme, 20)})`,
        border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
        color: theme.palette.text.primary,
      };
    default:
      return {};
  }
};

// glow and pulse are independent flags. The three combinations used to be spelled
// out one by one, but each is just the union of whichever flags are set.
const emphasisStyles = (theme: Theme, glow?: boolean, pulse?: boolean): CSSObject => ({
  ...(glow && {
    boxShadow: `${rems(theme, 0, 0, 15, 3)} ${alpha(theme.palette.primary.main, 0.4)} !important`,
    filter: 'brightness(1.05)',
  }),
  ...(pulse && {
    animation: `${pulseAnimation} 2s infinite`,
  }),
});

const arrowColor = (theme: Theme, variant?: string): string => {
  switch (variant) {
    case 'light':
      return absoluteInk(theme).white;
    case 'glass':
      return alpha(theme.palette.background.paper, 0.1);
    case 'dark':
      return neutralTones(theme).inverseSurface;
    default:
      return alpha(neutralTones(theme).inverseSurface, 0.9);
  }
};

const StyledTooltip = styled(MuiTooltip, {
  shouldForwardProp: (prop) =>
    !['customVariant', 'customSize', 'glow', 'pulse'].includes(prop as string),
})<{
  customVariant?: string;
  customSize?: string;
  glow?: boolean;
  pulse?: boolean;
}>(({ theme, customVariant, customSize, glow, pulse }) => {
  const sizeStyles = getSizeStyles(customSize);

  return {
    '& .MuiTooltip-tooltip': {
      borderRadius: theme.spacing(1),
      fontSize: sizeStyles.fontSize(theme),
      padding: sizeStyles.padding(theme),
      fontWeight: 500,
      transition: 'all 0.3s ease',
      position: 'relative',
      overflow: 'hidden',
      ...variantStyles(theme, customVariant),
      ...emphasisStyles(theme, glow, pulse),
    },

    '& .MuiTooltip-arrow': {
      color: arrowColor(theme, customVariant),
    },
  };
});

/**
 * The tooltip's cap: 300 design px unless the caller says otherwise. `sx` has
 * always read a number of 1 or less as a fraction of the parent, and that stays so.
 */
const tooltipCap =
  (maxWidth: number | undefined) =>
  (theme: Theme): string => {
    const cap = maxWidth ?? 300;
    return cap <= 1 && cap !== 0 ? `${cap * 100}%` : rem(theme, cap);
  };

export const Tooltip = React.forwardRef<HTMLDivElement, TooltipProps>(
  (
    {
      variant = 'default',
      size = 'md',
      glow = false,
      pulse = false,
      maxWidth,
      dataTestId,
      children,
      ...props
    },
    ref,
  ) => {
    const childWithTestId = dataTestId
      ? React.cloneElement(children as React.ReactElement<{ 'data-testid'?: string }>, {
          'data-testid': `${dataTestId}-trigger`,
        })
      : children;

    return (
      <StyledTooltip
        ref={ref}
        customVariant={variant}
        customSize={size}
        glow={glow}
        pulse={pulse}
        enterDelay={0}
        leaveDelay={0}
        disableHoverListener={false}
        disableFocusListener={false}
        disableTouchListener={false}
        slotProps={{
          tooltip: {
            sx: { maxWidth: tooltipCap(maxWidth) },
            role: 'tooltip',
            ...(dataTestId && { 'data-testid': `${dataTestId}-content` }),
          },
        }}
        {...props}
      >
        {childWithTestId}
      </StyledTooltip>
    );
  },
);

Tooltip.displayName = 'Tooltip';
