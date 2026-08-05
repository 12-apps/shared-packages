import { alpha, keyframes,Tooltip as MuiTooltip } from '@mui/material';
import type { CSSObject, Theme } from '@mui/material';
import { styled } from '@mui/material/styles';
import React from 'react';

import type { TooltipProps } from './Tooltip.types';

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
  sm: { fontSize: '0.75rem', padding: '4px 8px' },
  md: { fontSize: '0.875rem', padding: '6px 12px' },
  lg: { fontSize: '1rem', padding: '8px 16px' },
} as const;

const getSizeStyles = (size?: string): { fontSize: string; padding: string } =>
  SIZE_MAP[size as keyof typeof SIZE_MAP] || SIZE_MAP.md;

const variantStyles = (theme: Theme, variant?: string): CSSObject => {
  switch (variant) {
    case 'default':
      return {
        backgroundColor: alpha(theme.palette.grey[900], 0.9),
        color: theme.palette.common.white,
      };
    case 'dark':
      return {
        backgroundColor: theme.palette.grey[900],
        color: theme.palette.common.white,
      };
    case 'light':
      return {
        backgroundColor: theme.palette.common.white,
        color: theme.palette.text.primary,
        border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
        boxShadow: theme.shadows[4],
      };
    case 'glass':
      return {
        backgroundColor: alpha(theme.palette.background.paper, 0.1),
        backdropFilter: 'blur(20px)',
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
    boxShadow: `0 0 15px 3px ${alpha(theme.palette.primary.main, 0.4)} !important`,
    filter: 'brightness(1.05)',
  }),
  ...(pulse && {
    animation: `${pulseAnimation} 2s infinite`,
  }),
});

const arrowColor = (theme: Theme, variant?: string): string => {
  switch (variant) {
    case 'light':
      return theme.palette.common.white;
    case 'glass':
      return alpha(theme.palette.background.paper, 0.1);
    case 'dark':
      return theme.palette.grey[900];
    default:
      return alpha(theme.palette.grey[900], 0.9);
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
      fontSize: sizeStyles.fontSize,
      padding: sizeStyles.padding,
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

export const Tooltip = React.forwardRef<HTMLDivElement, TooltipProps>(
  (
    {
      variant = 'default',
      size = 'md',
      glow = false,
      pulse = false,
      maxWidth = 300,
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
            sx: { maxWidth },
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
