import { alpha, keyframes } from '@mui/material/styles/index.js';
import type { CSSObject, PaletteColor, Theme } from '@mui/material/styles/index.js';

import { fieldRadius } from '../../../tokens/field-radius';
import { asFieldSize, fieldBorder, fieldHeight } from '../../../tokens/field-height';
import { absoluteInk, controlNeutral, sheen } from '../../../tokens/ink';
import { rem, rems } from '../../../tokens/relative';

const glowAnimation = (theme: Theme) => keyframes`
  0% { box-shadow: 0 0 ${rem(theme, 5)} currentColor; }
  50% { box-shadow: 0 0 ${rem(theme, 15)} currentColor, 0 0 ${rem(theme, 25)} currentColor; }
  100% { box-shadow: 0 0 ${rem(theme, 5)} currentColor; }
`;

const floatAnimation = (theme: Theme) => keyframes`
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(${rem(theme, -2)}); }
`;

interface TogglePalette {
  main: string;
  dark: string;
  light: string;
  contrastText: string;
}

const neutralPalette = (theme: Theme): TogglePalette => controlNeutral(theme);

// A theme can be handed to us with shades missing, so each one falls back through
// the palette's own main colour before reaching for primary.
const shade = (
  palette: PaletteColor | undefined,
  key: 'dark' | 'light',
  fallback: PaletteColor,
): string => palette?.[key] || palette?.main || fallback[key];

export const getColorFromTheme = (theme: Theme, color: string): TogglePalette => {
  if (color === 'neutral') return neutralPalette(theme);

  const colorMap: Record<string, PaletteColor> = {
    primary: theme.palette.primary,
    secondary: theme.palette.secondary,
    success: theme.palette.success,
    warning: theme.palette.warning,
    info: theme.palette.info,
    danger: theme.palette.error,
  };

  const fallback = theme.palette.primary;
  const palette = colorMap[color] || fallback;

  return {
    main: palette?.main || fallback.main,
    dark: shade(palette, 'dark', fallback),
    light: shade(palette, 'light', fallback),
    contrastText: palette?.contrastText || absoluteInk(theme).white,
  };
};

/**
 * Each size's padding (vertical, horizontal) and type, in design px, read
 * through the type scale.
 */
const SIZE_MAP: Record<string, { paddingPx: readonly [number, number]; fontPx: number }> = {
  xs: { paddingPx: [4, 8], fontPx: 12 },
  sm: { paddingPx: [6, 12], fontPx: 14 },
  md: { paddingPx: [8, 16], fontPx: 16 },
  lg: { paddingPx: [10, 20], fontPx: 18 },
  xl: { paddingPx: [12, 24], fontPx: 20 },
};

const sizeStyles = (theme: Theme, customSize: string): CSSObject => {
  const size = SIZE_MAP[customSize];
  return size ? { padding: rems(theme, ...size.paddingPx), fontSize: rem(theme, size.fontPx) } : {};
};

export const baseStyles = (
  theme: Theme,
  colorPalette: TogglePalette,
  customSize: string,
): CSSObject => ({
  textTransform: 'none',
  fontWeight: 500,
  borderRadius: fieldRadius(theme),
  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  border: fieldBorder(theme),
  color: theme.palette.text.primary,
  backgroundColor: 'transparent',
  position: 'relative',
  overflow: 'hidden',

  // A zero-sized circle that grows to fill the button on hover.
  '&::before': {
    content: '""',
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 0,
    height: 0,
    borderRadius: '50%',
    backgroundColor: alpha(colorPalette.main, 0.2),
    transform: 'translate(-50%, -50%)',
    transition: 'width 0.4s, height 0.4s',
  },

  '&:hover': {
    backgroundColor: alpha(colorPalette.main, 0.08),
    borderColor: colorPalette.main,
    transform: `translateY(${rem(theme, -1)})`,
    boxShadow: `0 ${rems(theme, 4, 8)} ${alpha(colorPalette.main, 0.15)}`,
    animation: `${floatAnimation(theme)} 2s ease-in-out infinite`,

    '&::before': {
      width: '100%',
      height: '100%',
    },
  },

  '&:active': {
    transform: 'scale(0.98)',
  },

  '&.Mui-selected': {
    backgroundColor: colorPalette.main,
    color: colorPalette.contrastText || absoluteInk(theme).white,
    borderColor: colorPalette.main,
    boxShadow: `0 ${rems(theme, 2, 8)} ${alpha(colorPalette.main, 0.3)}`,

    '&::after': {
      content: '""',
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: `linear-gradient(135deg, transparent, ${sheen(theme, 0.1)})`,
      pointerEvents: 'none',
    },

    '&:hover': {
      backgroundColor: colorPalette.dark,
      transform: `translateY(${rem(theme, -2)}) scale(1.02)`,
      boxShadow: `0 ${rems(theme, 6, 20)} ${alpha(colorPalette.main, 0.4)}`,
    },
  },

  // Size wins over everything above it — its font and horizontal padding; the
  // height is the theme's field height for the size.
  ...sizeStyles(theme, customSize),
  minHeight: fieldHeight(theme, asFieldSize(customSize)),
  paddingTop: 0,
  paddingBottom: 0,
});

export const variantStyles = (
  theme: Theme,
  customVariant: string | undefined,
  colorPalette: TogglePalette,
): CSSObject => {
  switch (customVariant) {
    case 'outline':
      return {
        backgroundColor: 'transparent',
        border: `${rem(theme, 2)} solid ${colorPalette.main}`,
        color: colorPalette.main,

        '&.Mui-selected': {
          backgroundColor: colorPalette.main,
          color: colorPalette.contrastText || absoluteInk(theme).white,
        },
      };
    case 'soft':
      return {
        backgroundColor: alpha(colorPalette.main, 0.1),
        border: 'none',
        color: colorPalette.main,

        '&.Mui-selected': {
          backgroundColor: alpha(colorPalette.main, 0.2),
          color: colorPalette.main,
        },
      };
    default:
      return {};
  }
};

interface ToggleEffects {
  glass?: boolean;
  gradient?: boolean;
  glow?: boolean;
}

// gradient and glow both target `.Mui-selected`; with both on, the later spread
// wins, so glow's animation replaces gradient's.
export const effectStyles = (
  theme: Theme,
  colorPalette: TogglePalette,
  { glass, gradient, glow }: ToggleEffects,
): CSSObject => ({
  ...(glass && {
    backgroundColor: alpha(theme.palette.background.paper, 0.1),
    backdropFilter: `blur(${rem(theme, 20)})`,
    border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
  }),

  ...(gradient && {
    '&.Mui-selected': {
      background: `linear-gradient(135deg, ${colorPalette.light}, ${colorPalette.main}, ${colorPalette.dark})`,
      backgroundSize: '200% 200%',
      animation: `${floatAnimation(theme)} 3s ease-in-out infinite`,
      border: 'none',

      '&:hover': {
        backgroundPosition: '100% 100%',
      },
    },
  }),

  ...(glow && {
    '&.Mui-selected': {
      animation: `${glowAnimation(theme)} 2s ease-in-out infinite`,
      boxShadow: `0 0 ${rem(theme, 15)} ${alpha(colorPalette.main, 0.6)}`,
    },
  }),
});
