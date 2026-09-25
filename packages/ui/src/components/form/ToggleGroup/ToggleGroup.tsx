import Box from '@mui/material/Box/index.js';
import ToggleButton from '@mui/material/ToggleButton/index.js';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup/index.js';
import { alpha, useTheme, styled } from '@mui/material/styles/index.js';
import type { Theme } from '@mui/material/styles/index.js';
import React, { forwardRef } from 'react';

import type { ToggleGroupProps } from './ToggleGroup.types';
import { cssLengthToPx } from '../../../tokens/css-units';
import { asFieldSize, fieldHeight } from '../../../tokens/field-height';
import { fieldRadius } from '../../../tokens/field-radius';
import { controlNeutral } from '../../../tokens/ink';

const GLASS_PADDING = 4;
const GLASS_BORDER = 1;

const getColorFromTheme = (theme: Theme, color: string) => {
  if (color === 'neutral') {
    const neutral = controlNeutral(theme);
    return { ...neutral, contrastText: theme.palette.getContrastText(neutral.main) };
  }

  const colorMap = {
    primary: theme.palette.primary,
    secondary: theme.palette.secondary,
    success: theme.palette.success,
    warning: theme.palette.warning,
    info: theme.palette.info,
    danger: theme.palette.error,
  };

  const palette = colorMap[color as keyof typeof colorMap] || theme.palette.primary;

  // Ensure palette has required properties
  return {
    main: palette.main,
    dark: palette.dark || palette.main,
    light: palette.light || palette.main,
    contrastText: palette.contrastText || theme.palette.getContrastText(palette.main),
  };
};

const StyledToggleGroup = styled(ToggleButtonGroup, {
  shouldForwardProp: (prop) => !['customColor', 'customSize', 'glass'].includes(prop as string),
})<{
  customColor?: string;
  customSize?: string;
  glass?: boolean;
}>(({ theme, glass }) => {
  // Each button is the field, so it takes the field radius. The glass frame
  // around them is inset by its padding, the buttons' margin and its border,
  // and rounds by that much more so the two corners stay concentric.
  const radius = fieldRadius(theme);
  const inset = GLASS_PADDING + cssLengthToPx(theme.spacing(0.5), 4) + GLASS_BORDER;
  return {
    backgroundColor: glass ? alpha(theme.palette.background.paper, 0.1) : 'transparent',
    backdropFilter: glass ? 'blur(20px)' : 'none',
    borderRadius: glass ? radius + inset : radius,
    padding: glass ? GLASS_PADDING : 0,
    border: glass ? `${GLASS_BORDER}px solid ${alpha(theme.palette.divider, 0.2)}` : 'none',

    '& .MuiToggleButtonGroup-grouped': {
      margin: theme.spacing(0.5),
      border: 0,
      borderRadius: `${radius}px !important`,
    },
  };
});

export const ToggleGroup = forwardRef<HTMLDivElement, ToggleGroupProps>(
  (
    {
      variant = 'single',
      color = 'primary',
      size = 'md',
      options,
      glass = false,
      gradient = false,
      value,
      onChange,
      dataTestId = 'toggle-group',
      ...props
    },
    ref,
  ) => {
    const theme = useTheme();
    const colorPalette = getColorFromTheme(theme, color);

    const sizeMap = {
      xs: { padding: '4px 8px', fontSize: '0.75rem' },
      sm: { padding: '6px 12px', fontSize: '0.875rem' },
      md: { padding: '8px 16px', fontSize: '1rem' },
      lg: { padding: '10px 20px', fontSize: '1.125rem' },
      xl: { padding: '12px 24px', fontSize: '1.25rem' },
    };

    return (
      <StyledToggleGroup
        ref={ref}
        customColor={color}
        customSize={size}
        glass={glass}
        value={value}
        onChange={onChange}
        exclusive={variant === 'exclusive' || variant === 'single'}
        data-testid={dataTestId}
        {...props}
      >
        {options.map((option) => (
          <ToggleButton
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            data-testid={`${dataTestId}-item-${option.value}`}
            sx={{
              textTransform: 'none',
              fontWeight: 500,
              transition: 'all 0.3s ease',
              ...sizeMap[size as keyof typeof sizeMap],
              // The theme's field height for the size; the label centres in it.
              minHeight: (theme) => fieldHeight(theme, asFieldSize(size)),
              paddingTop: 0,
              paddingBottom: 0,

              '&.Mui-selected': {
                backgroundColor: colorPalette.main,
                color: colorPalette.contrastText,

                ...(gradient && {
                  background: `linear-gradient(135deg, ${colorPalette.main}, ${colorPalette.dark})`,
                }),
              },
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {option.icon}
              {option.label}
            </Box>
          </ToggleButton>
        ))}
      </StyledToggleGroup>
    );
  },
);

ToggleGroup.displayName = 'ToggleGroup';
