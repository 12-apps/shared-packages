import { ToggleButton } from '@mui/material';
import { styled } from '@mui/material';
import React, { forwardRef } from 'react';

import {
  baseStyles,
  effectStyles,
  getColorFromTheme,
  variantStyles,
} from './Toggle.styles';
import type { ToggleProps } from './Toggle.types';

const StyledToggle = styled(ToggleButton, {
  shouldForwardProp: (prop) =>
    !['customVariant', 'customColor', 'customSize', 'glow', 'glass', 'gradient'].includes(
      prop as string,
    ),
})<{
  customVariant?: string;
  customColor?: string;
  customSize?: string;
  glow?: boolean;
  glass?: boolean;
  gradient?: boolean;
}>(({
  theme,
  customVariant,
  customColor = 'primary',
  customSize = 'md',
  glow,
  glass,
  gradient,
}) => {
  const colorPalette = getColorFromTheme(theme, customColor);

  return {
    ...baseStyles(theme, colorPalette, customSize),
    ...variantStyles(customVariant, colorPalette),
    ...effectStyles(theme, colorPalette, { glass, gradient, glow }),
  };
});

export const Toggle = forwardRef<HTMLButtonElement, ToggleProps>(
  (
    {
      variant = 'default',
      color = 'primary',
      size = 'md',
      icon,
      glow = false,
      glass = false,
      gradient = false,
      dataTestId,
      children,
      ...props
    },
    ref,
  ) => {
    const testIds = {
      container: dataTestId,
      icon: dataTestId ? `${dataTestId}-icon` : undefined,
    };

    return (
      <StyledToggle
        ref={ref}
        customVariant={variant}
        customColor={color}
        customSize={size}
        glow={glow}
        glass={glass}
        gradient={gradient}
        data-testid={testIds.container}
        {...props}
      >
        {icon && (
          <span
            style={{ marginRight: children ? '8px' : '0' }}
            data-testid={testIds.icon}
          >
            {icon}
          </span>
        )}
        {children}
      </StyledToggle>
    );
  },
);

Toggle.displayName = 'Toggle';
