import { alpha } from '@mui/material';
import type { CSSObject, Theme } from '@mui/material';

import { glowAnimation, rippleAnimation, scaleAnimation, slideAnimation } from './RadioGroup.animations';

interface ColorPalette {
  main: string;
  dark?: string;
  light?: string;
  contrastText?: string;
}

/**
 * `neutral` is not a MUI palette entry, so it is built from the grey ramp. The
 * literal fallbacks cover a theme whose grey ramp has been replaced with one
 * that omits these steps.
 */
const neutralPalette = (theme: Theme): ColorPalette => ({
  main: theme.palette.grey?.[700] || '#616161',
  dark: theme.palette.grey?.[800] || '#424242',
  light: theme.palette.grey?.[500] || '#9e9e9e',
  contrastText: '#fff',
});

/** `danger` is this component's name for the error palette; the rest map straight through. */
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

/**
 * Resolves a colour name to a full palette, filling any step the theme leaves
 * out from `main` and then from the primary palette. Split into three so the
 * fallback chains do not all count against one function.
 */
const getColorFromTheme = (theme: Theme, color: string): ColorPalette => {
  if (color === 'neutral') {
    return neutralPalette(theme);
  }

  const palette = namedPalette(theme, color);
  const { primary } = theme.palette;

  // namedPalette always yields a palette, so these need no optional chaining;
  // each step still falls back to `main` and then to primary when the theme
  // leaves it out.
  return {
    main: palette.main || primary.main,
    dark: palette.dark || palette.main || primary.dark,
    light: palette.light || palette.main || primary.light,
    contrastText: palette.contrastText || '#fff',
  };
};

type SizeKey = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const pickSize = <T,>(map: Record<SizeKey, T>, size: string): T => map[size as SizeKey] ?? map.md;

const CARD_SIZES: Record<SizeKey, CSSObject> = {
  xs: { padding: '8px', minHeight: '60px' },
  sm: { padding: '12px', minHeight: '70px' },
  md: { padding: '16px', minHeight: '80px' },
  lg: { padding: '20px', minHeight: '90px' },
  xl: { padding: '24px', minHeight: '100px' },
};

const BUTTON_SIZES: Record<SizeKey, CSSObject> = {
  xs: { padding: '6px 12px', fontSize: '0.75rem', minHeight: '32px' },
  sm: { padding: '8px 16px', fontSize: '0.875rem', minHeight: '36px' },
  md: { padding: '10px 20px', fontSize: '1rem', minHeight: '40px' },
  lg: { padding: '12px 24px', fontSize: '1.125rem', minHeight: '44px' },
  xl: { padding: '14px 28px', fontSize: '1.25rem', minHeight: '48px' },
};

const SEGMENT_SIZES: Record<SizeKey, CSSObject> = {
  xs: { padding: '4px 8px', fontSize: '0.75rem' },
  sm: { padding: '6px 12px', fontSize: '0.875rem' },
  md: { padding: '8px 16px', fontSize: '1rem' },
  lg: { padding: '10px 20px', fontSize: '1.125rem' },
  xl: { padding: '12px 24px', fontSize: '1.25rem' },
};

export interface SurfaceFlags {
  selected?: boolean;
  customColor?: string;
  glass?: boolean;
  gradient?: boolean;
  glow?: boolean;
  customSize?: string;
  animated?: boolean;
}

export const formLabelSx = (theme: Theme, glass?: boolean, error?: boolean): CSSObject => ({
  marginBottom: theme.spacing(2),
  fontWeight: 600,
  color: error ? theme.palette.error.main : theme.palette.text.primary,
  ...(glass && {
    backgroundColor: alpha(theme.palette.background.paper, 0.1),
    backdropFilter: 'blur(10px)',
    padding: '8px 12px',
    borderRadius: '8px',
    border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
    display: 'inline-block',
  }),
});

/** The card's resting surface, before glass/gradient/glow override parts of it. */
const cardBase = (theme: Theme, flags: SurfaceFlags, palette: ColorPalette): CSSObject => {
  const { selected, animated, customSize = 'md' } = flags;

  return {
    cursor: 'pointer',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    border: `2px solid ${selected ? palette.main : alpha(theme.palette.divider, 0.3)}`,
    backgroundColor: selected ? alpha(palette.main, 0.05) : theme.palette.background.paper,
    position: 'relative' as const,
    overflow: 'hidden' as const,
    ...(animated && { animation: `${slideAnimation} 0.4s ease-out` }),
    // A radial wash that grows from the centre as the card is selected or hovered.
    '&::before': {
      content: '""',
      position: 'absolute',
      top: '50%',
      left: '50%',
      width: selected ? '100%' : '0',
      height: selected ? '100%' : '0',
      background: `radial-gradient(circle, ${alpha(palette.main, 0.1)} 0%, transparent 70%)`,
      transform: 'translate(-50%, -50%)',
      transition: 'all 0.5s ease',
      borderRadius: '50%',
    },
    '&:hover': {
      borderColor: palette.main,
      backgroundColor: alpha(palette.main, 0.02),
      transform: 'translateY(-2px) scale(1.02)',
      boxShadow: `${theme.shadows[4]}, 0 10px 30px -5px ${alpha(palette.main, 0.2)}`,
      '&::before': { width: '120%', height: '120%' },
    },
    '&:active': { transform: 'scale(0.98)' },
    ...pickSize(CARD_SIZES, customSize),
  };
};

export const radioCardSx = (theme: Theme, flags: SurfaceFlags): CSSObject => {
  const { selected, customColor = 'primary', glass, gradient, glow } = flags;
  const palette = getColorFromTheme(theme, customColor);

  return {
    ...cardBase(theme, flags, palette),
    ...(glass && {
      backgroundColor: selected
        ? alpha(palette.main, 0.1)
        : alpha(theme.palette.background.paper, 0.1),
      backdropFilter: 'blur(20px)',
      border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
    }),
    ...(gradient &&
      selected && {
        background: `linear-gradient(135deg, ${alpha(palette.main, 0.1)}, ${alpha(palette.light || palette.main, 0.05)})`,
        borderColor: palette.main,
      }),
    ...(glow &&
      selected && {
        animation: `${glowAnimation} 2s ease-in-out infinite`,
        boxShadow: `0 0 15px ${alpha(palette.main, 0.4)}`,
      }),
  };
};

/** The pill button's resting surface, before glass/gradient override parts of it. */
const buttonBase = (theme: Theme, flags: SurfaceFlags, palette: ColorPalette): CSSObject => {
  const { selected, animated, customSize = 'md' } = flags;

  return {
    borderRadius: theme.spacing(1),
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    fontWeight: 500,
    border: `2px solid ${selected ? palette.main : alpha(theme.palette.divider, 0.5)}`,
    backgroundColor: selected ? palette.main : 'transparent',
    color: selected ? palette.contrastText || '#fff' : theme.palette.text.primary,
    position: 'relative' as const,
    overflow: 'hidden' as const,
    ...(animated && selected && { animation: `${scaleAnimation} 0.3s ease-out` }),
    // Sized to zero until pressed, when the ripple keyframes expand it.
    '&::after': {
      content: '""',
      position: 'absolute',
      top: '50%',
      left: '50%',
      width: 0,
      height: 0,
      borderRadius: '50%',
      backgroundColor: alpha(palette.contrastText || '#fff', 0.3),
      transform: 'translate(-50%, -50%)',
      pointerEvents: 'none' as const,
    },
    '&:active::after': {
      animation: `${rippleAnimation} 0.6s ease-out`,
      width: '100%',
      height: '100%',
    },
    '&:hover': {
      borderColor: palette.main,
      backgroundColor: selected ? palette.dark : alpha(palette.main, 0.1),
      transform: 'translateY(-1px) scale(1.02)',
      boxShadow: `0 4px 12px ${alpha(palette.main, 0.2)}`,
    },
    '&:active': { transform: 'scale(0.98)' },
    ...pickSize(BUTTON_SIZES, customSize),
  };
};

export const buttonRadioSx = (theme: Theme, flags: SurfaceFlags): CSSObject => {
  const { selected, customColor = 'primary', glass, gradient } = flags;
  const palette = getColorFromTheme(theme, customColor);

  return {
    ...buttonBase(theme, flags, palette),
    ...(glass && {
      backgroundColor: selected
        ? alpha(palette.main, 0.8)
        : alpha(theme.palette.background.paper, 0.1),
      backdropFilter: 'blur(20px)',
      border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
    }),
    ...(gradient &&
      selected && {
        background: `linear-gradient(135deg, ${palette.main}, ${palette.dark})`,
        border: 'none',
      }),
  };
};

export const segmentContainerSx = (
  theme: Theme,
  glass?: boolean,
  customColor = 'primary',
): CSSObject => {
  const palette = getColorFromTheme(theme, customColor);

  return {
    padding: '4px',
    borderRadius: theme.spacing(1.5),
    backgroundColor: glass
      ? alpha(theme.palette.background.paper, 0.1)
      : alpha(palette.main, 0.05),
    backdropFilter: glass ? 'blur(20px)' : 'none',
    border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
    display: 'flex',
    gap: '2px',
  };
};

/**
 * An underline that grows from the centre outwards, and is already full width
 * when the segment is the selected one.
 */
const segmentUnderline = (color: string, selected: boolean): CSSObject => ({
  content: '""',
  position: 'absolute',
  bottom: 0,
  left: selected ? 0 : '50%',
  width: selected ? '100%' : 0,
  height: '2px',
  backgroundColor: color,
  transition: 'all 0.3s ease',
  transform: selected ? 'translateX(0)' : 'translateX(-50%)',
});

export const segmentButtonSx = (theme: Theme, flags: SurfaceFlags): CSSObject => {
  const { selected, customColor = 'primary', customSize = 'md', animated } = flags;
  const palette = getColorFromTheme(theme, customColor);

  return {
    flex: 1,
    borderRadius: theme.spacing(1),
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    fontWeight: 500,
    backgroundColor: selected ? theme.palette.background.paper : 'transparent',
    color: selected ? palette.main : theme.palette.text.secondary,
    boxShadow: selected
      ? `${theme.shadows[2]}, inset 0 1px 3px ${alpha(palette.main, 0.1)}`
      : 'none',
    position: 'relative' as const,
    overflow: 'hidden' as const,
    ...(animated && selected && { animation: `${scaleAnimation} 0.3s ease-out` }),
    '&::before': segmentUnderline(palette.main, Boolean(selected)),
    '&:hover': {
      backgroundColor: selected
        ? theme.palette.background.paper
        : alpha(theme.palette.action.hover, 0.08),
      color: palette.main,
      '&::before': { width: '100%', left: 0, transform: 'translateX(0)' },
    },
    '&:active': { transform: 'scale(0.98)' },
    ...pickSize(SEGMENT_SIZES, customSize),
  };
};
