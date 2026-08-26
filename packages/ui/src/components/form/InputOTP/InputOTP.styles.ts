import { alpha } from '@mui/material/styles/index.js';
import type { CSSObject, Theme } from '@mui/material/styles/index.js';

interface ColorPalette {
  main: string;
  dark?: string;
  light?: string;
  contrastText?: string;
}

/** `neutral` is not a MUI palette entry, so it is built from the grey ramp. */
const neutralPalette = (theme: Theme): ColorPalette => ({
  main: theme.palette.grey[700],
  dark: theme.palette.grey[800],
  light: theme.palette.grey[500],
  contrastText: '#fff',
});

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
    contrastText: palette.contrastText || '#fff',
  };
};

type SizeKey = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/** Each slot is a square, so width and height always match. */
const SIZES: Record<SizeKey, { side: string; fontSize: string }> = {
  xs: { side: '32px', fontSize: '0.75rem' },
  sm: { side: '40px', fontSize: '0.875rem' },
  md: { side: '48px', fontSize: '1rem' },
  lg: { side: '56px', fontSize: '1.125rem' },
  xl: { side: '64px', fontSize: '1.25rem' },
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
  const { side, fontSize } = SIZES[customSize as SizeKey] ?? SIZES.md;

  return {
    width: side,
    height: side,
    '& .MuiOutlinedInput-root': {
      width: side,
      height: side,
      fontSize,
      fontWeight: 600,
      textAlign: 'center',
      borderRadius: theme.spacing(1),
      ...(glass && {
        backgroundColor: alpha(theme.palette.background.paper, 0.1),
        backdropFilter: 'blur(20px)',
        '& fieldset': { border: `1px solid ${alpha(theme.palette.divider, 0.2)}` },
      }),
      ...(gradient && {
        '&.Mui-focused fieldset': {
          background: `linear-gradient(135deg, ${palette.main}, ${palette.light})`,
          borderWidth: '2px',
        },
      }),
      '& input': { textAlign: 'center', padding: 0, fontWeight: 'inherit' },
      '&:hover fieldset': { borderColor: palette.main },
      '&.Mui-focused fieldset': { borderColor: palette.main, borderWidth: '2px' },
    },
  };
};
