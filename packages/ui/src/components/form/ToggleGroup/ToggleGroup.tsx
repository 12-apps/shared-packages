import Box from '@mui/material/Box/index.js';
import ToggleButton from '@mui/material/ToggleButton/index.js';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup/index.js';
import { alpha, useTheme, styled } from '@mui/material/styles/index.js';
import type { Theme } from '@mui/material/styles/index.js';
import React, { forwardRef } from 'react';

import type { ToggleGroupProps } from './ToggleGroup.types';
import { asFieldSize, FIELD_BORDER_WIDTH, fieldHeight } from '../../../tokens/field-height';
import { fieldRadius } from '../../../tokens/field-radius';
import { controlNeutral } from '../../../tokens/ink';
import { rem, remPx, rems } from '../../../tokens/relative';
import { cssLengthToPx } from '../../../tokens/css-units';

/** The glass frame's padding (4px at the design scale); its border is the field hairline. */
const glassPadding = (theme: Theme): string => rem(theme, 4);

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

/** The glass frame's radius: the field radius plus its padding, the buttons' margin and its border. */
const glassFrameRadius = (theme: Theme): number =>
  fieldRadius(theme) + remPx(theme, 4) + cssLengthToPx(theme.spacing(0.5), 4) + FIELD_BORDER_WIDTH;

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
  return {
    backgroundColor: glass ? alpha(theme.palette.background.paper, 0.1) : 'transparent',
    backdropFilter: glass ? `blur(${rem(theme, 20)})` : 'none',
    borderRadius: glass ? glassFrameRadius(theme) : radius,
    padding: glass ? glassPadding(theme) : 0,
    border: glass ? `${FIELD_BORDER_WIDTH}px solid ${alpha(theme.palette.divider, 0.2)}` : 'none',

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
      xs: { padding: rems(theme, 4, 8), fontSize: rem(theme, 12) },
      sm: { padding: rems(theme, 6, 12), fontSize: rem(theme, 14) },
      md: { padding: rems(theme, 8, 16), fontSize: rem(theme, 16) },
      lg: { padding: rems(theme, 10, 20), fontSize: rem(theme, 18) },
      xl: { padding: rems(theme, 12, 24), fontSize: rem(theme, 20) },
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
