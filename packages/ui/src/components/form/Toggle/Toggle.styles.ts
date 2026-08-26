import { alpha, keyframes } from '@mui/material/styles';
import type { CSSObject, PaletteColor, Theme } from '@mui/material/styles';

const glowAnimation = keyframes`
  0% { box-shadow: 0 0 5px currentColor; }
  50% { box-shadow: 0 0 15px currentColor, 0 0 25px currentColor; }
  100% { box-shadow: 0 0 5px currentColor; }
`;

const floatAnimation = keyframes`
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-2px); }
`;

interface TogglePalette {
  main: string;
  dark: string;
  light: string;
  contrastText: string;
}

const neutralPalette = (theme: Theme): TogglePalette => ({
  main: theme.palette.grey?.[700] || '#616161',
  dark: theme.palette.grey?.[800] || '#424242',
  light: theme.palette.grey?.[500] || '#9e9e9e',
  contrastText: '#fff',
});

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
    contrastText: palette?.contrastText || '#fff',
  };
};

const SIZE_MAP: Record<string, CSSObject> = {
  xs: { padding: '4px 8px', fontSize: '0.75rem' },
  sm: { padding: '6px 12px', fontSize: '0.875rem' },
  md: { padding: '8px 16px', fontSize: '1rem' },
  lg: { padding: '10px 20px', fontSize: '1.125rem' },
  xl: { padding: '12px 24px', fontSize: '1.25rem' },
};

export const baseStyles = (
  theme: Theme,
  colorPalette: TogglePalette,
  customSize: string,
): CSSObject => ({
  textTransform: 'none',
  fontWeight: 500,
  borderRadius: theme.spacing(1),
  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  border: `2px solid ${alpha(theme.palette.divider, 0.3)}`,
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
    transform: 'translateY(-1px)',
    boxShadow: `0 4px 8px ${alpha(colorPalette.main, 0.15)}`,
    animation: `${floatAnimation} 2s ease-in-out infinite`,

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
    color: colorPalette.contrastText || '#fff',
    borderColor: colorPalette.main,
    boxShadow: `0 2px 8px ${alpha(colorPalette.main, 0.3)}`,

    '&::after': {
      content: '""',
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: `linear-gradient(135deg, transparent, ${alpha('#fff', 0.1)})`,
      pointerEvents: 'none',
    },

    '&:hover': {
      backgroundColor: colorPalette.dark,
      transform: 'translateY(-2px) scale(1.02)',
      boxShadow: `0 6px 20px ${alpha(colorPalette.main, 0.4)}`,
    },
  },

  // Size wins over everything above it.
  ...(SIZE_MAP[customSize] ?? {}),
});

export const variantStyles = (
  customVariant: string | undefined,
  colorPalette: TogglePalette,
): CSSObject => {
  switch (customVariant) {
    case 'outline':
      return {
        backgroundColor: 'transparent',
        border: `2px solid ${colorPalette.main}`,
        color: colorPalette.main,

        '&.Mui-selected': {
          backgroundColor: colorPalette.main,
          color: colorPalette.contrastText || '#fff',
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
    backdropFilter: 'blur(20px)',
    border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
  }),

  ...(gradient && {
    '&.Mui-selected': {
      background: `linear-gradient(135deg, ${colorPalette.light}, ${colorPalette.main}, ${colorPalette.dark})`,
      backgroundSize: '200% 200%',
      animation: `${floatAnimation} 3s ease-in-out infinite`,
      border: 'none',

      '&:hover': {
        backgroundPosition: '100% 100%',
      },
    },
  }),

  ...(glow && {
    '&.Mui-selected': {
      animation: `${glowAnimation} 2s ease-in-out infinite`,
      boxShadow: `0 0 15px ${alpha(colorPalette.main, 0.6)}`,
    },
  }),
});
