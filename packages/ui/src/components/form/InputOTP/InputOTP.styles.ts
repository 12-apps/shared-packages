import { alpha } from '@mui/material/styles/index.js';
import type { CSSObject, Theme } from '@mui/material/styles/index.js';

import { fieldEdge } from '../../../tokens/field-edge';
import { fieldRadius } from '../../../tokens/field-radius';
import { asFieldSize, fieldHeight } from '../../../tokens/field-height';
import { absoluteInk, controlNeutral } from '../../../tokens/ink';

interface ColorPalette {
  main: string;
  dark?: string;
  light?: string;
  contrastText?: string;
}

/** `neutral` is not a MUI palette entry, so it is built from the grey ramp. */
const neutralPalette = (theme: Theme): ColorPalette => controlNeutral(theme);

/** `danger` is this component's name for the error palette. */
const namedPalette = (theme: Theme, color: string): ColorPalette => {
  const colorMap: Record<string, ColorPalette> = {
    primary: theme.palette.primary,
    secondary: theme.palette.secondary,
    success: theme.palette.success,
    warning: theme.palette.warning,
    info: theme.palette.info,
    danger: theme.palette.error,
  };

  return colorMap[color] || theme.palette.primary;
};

const getColorFromTheme = (theme: Theme, color: string): ColorPalette => {
  if (color === 'neutral') {
    return neutralPalette(theme);
  }

  const palette = namedPalette(theme, color);
  const { primary } = theme.palette;

  return {
    main: palette.main || primary.main,
    dark: palette.dark || palette.main || primary.dark,
    light: palette.light || palette.main || primary.light,
    contrastText: palette.contrastText || absoluteInk(theme).white,
  };
};

type SizeKey = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/** Each slot's type. Its side is the theme's field height for the size (a square). */
const SIZES: Record<SizeKey, { fontSize: string }> = {
  xs: { fontSize: '0.75rem' },
  sm: { fontSize: '0.875rem' },
  md: { fontSize: '1rem' },
  lg: { fontSize: '1.125rem' },
  xl: { fontSize: '1.25rem' },
};

export interface OtpSlotFlags {
  customColor?: string;
  customSize?: string;
  glass?: boolean;
  gradient?: boolean;
}

export const otpSlotSx = (theme: Theme, flags: OtpSlotFlags): CSSObject => {
  const { customColor = 'primary', customSize = 'md', glass, gradient } = flags;
  const palette = getColorFromTheme(theme, customColor);
  const { fontSize } = SIZES[customSize as SizeKey] ?? SIZES.md;
  // A slot is a field: a square of the theme's field height for its size.
  const side = fieldHeight(theme, asFieldSize(customSize));

  return {
    width: side,
    height: side,
    '& .MuiOutlinedInput-root': {
      width: side,
      height: side,
      fontSize,
      fontWeight: 600,
      textAlign: 'center',
      borderRadius: fieldRadius(theme),
      ...(glass && {
        backgroundColor: alpha(theme.palette.background.paper, 0.1),
        backdropFilter: 'blur(20px)',
        '& fieldset': { border: `1px solid ${fieldEdge(theme)}` },
      }),
      ...(gradient && {
        '&.Mui-focused fieldset': {
          background: `linear-gradient(135deg, ${palette.main}, ${palette.light})`,
          borderWidth: '2px',
        },
      }),
      '& input': { textAlign: 'center', padding: 0, fontWeight: 'inherit' },
      ...(!glass && { '& fieldset': { borderColor: fieldEdge(theme) } }),
      '&:hover fieldset': { borderColor: palette.main },
      '&.Mui-focused fieldset': { borderColor: palette.main, borderWidth: '2px' },
    },
  };
};
