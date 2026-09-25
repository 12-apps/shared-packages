import { alpha } from '@mui/material/styles/index.js';
import type { CSSObject, Theme } from '@mui/material/styles/index.js';

import { glowAnimation, rippleAnimation, scaleAnimation, slideAnimation } from './RadioGroup.animations';

import { fieldEdge } from '../../../tokens/field-edge';
import { fieldRadius } from '../../../tokens/field-radius';
import { asFieldSize, FIELD_BORDER_WIDTH, fieldHeight } from '../../../tokens/field-height';
import { absoluteInk, controlNeutral } from '../../../tokens/ink';
import { rem, remPx, rems } from '../../../tokens/relative';

/**
 * The segment track's padding (4px at the design scale); its border is the
 * field hairline. Its corner is the segments' radius plus both.
 */
const segmentTrackPadding = (theme: Theme): string => rem(theme, 4);

interface ColorPalette {
  main: string;
  dark?: string;
  light?: string;
  contrastText?: string;
}

/** `neutral` is not a MUI palette entry, so it is the controls' neutral tone. */
const neutralPalette = (theme: Theme): ColorPalette => controlNeutral(theme);

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
    contrastText: palette.contrastText || absoluteInk(theme).white,
  };
};

type SizeKey = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const pickSize = <T,>(map: Record<SizeKey, T>, size: string): T => map[size as SizeKey] ?? map.md;

const CARD_SIZES: Record<SizeKey, (theme: Theme) => CSSObject> = {
  xs: (theme) => ({ padding: rem(theme, 8), minHeight: rem(theme, 60) }),
  sm: (theme) => ({ padding: rem(theme, 12), minHeight: rem(theme, 70) }),
  md: (theme) => ({ padding: rem(theme, 16), minHeight: rem(theme, 80) }),
  lg: (theme) => ({ padding: rem(theme, 20), minHeight: rem(theme, 90) }),
  xl: (theme) => ({ padding: rem(theme, 24), minHeight: rem(theme, 100) }),
};

const BUTTON_SIZES: Record<SizeKey, (theme: Theme) => CSSObject> = {
  xs: (theme) => ({ padding: rems(theme, 6, 12), fontSize: rem(theme, 12), minHeight: rem(theme, 32) }),
  sm: (theme) => ({ padding: rems(theme, 8, 16), fontSize: rem(theme, 14), minHeight: rem(theme, 36) }),
  md: (theme) => ({ padding: rems(theme, 10, 20), fontSize: rem(theme, 16), minHeight: rem(theme, 40) }),
  lg: (theme) => ({ padding: rems(theme, 12, 24), fontSize: rem(theme, 18), minHeight: rem(theme, 44) }),
  xl: (theme) => ({ padding: rems(theme, 14, 28), fontSize: rem(theme, 20), minHeight: rem(theme, 48) }),
};

const SEGMENT_SIZES: Record<SizeKey, (theme: Theme) => CSSObject> = {
  xs: (theme) => ({ padding: rems(theme, 4, 8), fontSize: rem(theme, 12) }),
  sm: (theme) => ({ padding: rems(theme, 6, 12), fontSize: rem(theme, 14) }),
  md: (theme) => ({ padding: rems(theme, 8, 16), fontSize: rem(theme, 16) }),
  lg: (theme) => ({ padding: rems(theme, 10, 20), fontSize: rem(theme, 18) }),
  xl: (theme) => ({ padding: rems(theme, 12, 24), fontSize: rem(theme, 20) }),
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
    backdropFilter: `blur(${rem(theme, 10)})`,
    padding: rems(theme, 8, 12),
    borderRadius: rem(theme, 8),
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
    border: `${rem(theme, 2)} solid ${selected ? palette.main : fieldEdge(theme)}`,
    backgroundColor: selected ? alpha(palette.main, 0.05) : theme.palette.background.paper,
    position: 'relative' as const,
    overflow: 'hidden' as const,
    ...(animated && { animation: `${slideAnimation(theme)} 0.4s ease-out` }),
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
      transform: `translateY(${rem(theme, -2)}) scale(1.02)`,
      boxShadow: `${theme.shadows[4]}, 0 ${rems(theme, 10, 30, -5)} ${alpha(palette.main, 0.2)}`,
      '&::before': { width: '120%', height: '120%' },
    },
    '&:active': { transform: 'scale(0.98)' },
    ...pickSize(CARD_SIZES, customSize)(theme),
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
      backdropFilter: `blur(${rem(theme, 20)})`,
      border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
    }),
    ...(gradient &&
      selected && {
        background: `linear-gradient(135deg, ${alpha(palette.main, 0.1)}, ${alpha(palette.light || palette.main, 0.05)})`,
        borderColor: palette.main,
      }),
    ...(glow &&
      selected && {
        animation: `${glowAnimation(theme)} 2s ease-in-out infinite`,
        boxShadow: `0 0 ${rem(theme, 15)} ${alpha(palette.main, 0.4)}`,
      }),
  };
};

/** The pill button's resting surface, before glass/gradient override parts of it. */
const buttonBase = (theme: Theme, flags: SurfaceFlags, palette: ColorPalette): CSSObject => {
  const { selected, animated, customSize = 'md' } = flags;

  return {
    borderRadius: fieldRadius(theme),
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    fontWeight: 500,
    border: `${FIELD_BORDER_WIDTH}px solid ${selected ? palette.main : fieldEdge(theme)}`,
    backgroundColor: selected ? palette.main : 'transparent',
    color: selected ? palette.contrastText || absoluteInk(theme).white : theme.palette.text.primary,
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
      backgroundColor: alpha(palette.contrastText || absoluteInk(theme).white, 0.3),
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
      transform: `translateY(${rem(theme, -1)}) scale(1.02)`,
      boxShadow: `0 ${rems(theme, 4, 12)} ${alpha(palette.main, 0.2)}`,
    },
    '&:active': { transform: 'scale(0.98)' },
    ...pickSize(BUTTON_SIZES, customSize)(theme),
    // The theme's field height for the size, in place of the table's own.
    minHeight: fieldHeight(theme, asFieldSize(customSize)),
    paddingTop: 0,
    paddingBottom: 0,
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
      backdropFilter: `blur(${rem(theme, 20)})`,
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
    padding: segmentTrackPadding(theme),
    // Concentric with the segments inside it, which take the field radius.
    borderRadius: fieldRadius(theme) + remPx(theme, 4) + FIELD_BORDER_WIDTH,
    backgroundColor: glass
      ? alpha(theme.palette.background.paper, 0.1)
      : alpha(palette.main, 0.05),
    backdropFilter: glass ? `blur(${rem(theme, 20)})` : 'none',
    border: `${FIELD_BORDER_WIDTH}px solid ${alpha(theme.palette.divider, 0.2)}`,
    display: 'flex',
    gap: rem(theme, 2),
  };
};

/**
 * An underline that grows from the centre outwards, and is already full width
 * when the segment is the selected one.
 */
const segmentUnderline = (theme: Theme, color: string, selected: boolean): CSSObject => ({
  content: '""',
  position: 'absolute',
  bottom: 0,
  left: selected ? 0 : '50%',
  width: selected ? '100%' : 0,
  height: rem(theme, 2),
  backgroundColor: color,
  transition: 'all 0.3s ease',
  transform: selected ? 'translateX(0)' : 'translateX(-50%)',
});

export const segmentButtonSx = (theme: Theme, flags: SurfaceFlags): CSSObject => {
  const { selected, customColor = 'primary', customSize = 'md', animated } = flags;
  const palette = getColorFromTheme(theme, customColor);

  return {
    flex: 1,
    borderRadius: fieldRadius(theme),
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    fontWeight: 500,
    backgroundColor: selected ? theme.palette.background.paper : 'transparent',
    color: selected ? palette.main : theme.palette.text.secondary,
    boxShadow: selected
      ? `${theme.shadows[2]}, inset 0 ${rems(theme, 1, 3)} ${alpha(palette.main, 0.1)}`
      : 'none',
    position: 'relative' as const,
    overflow: 'hidden' as const,
    ...(animated && selected && { animation: `${scaleAnimation} 0.3s ease-out` }),
    '&::before': segmentUnderline(theme, palette.main, Boolean(selected)),
    '&:hover': {
      backgroundColor: selected
        ? theme.palette.background.paper
        : alpha(theme.palette.action.hover, 0.08),
      color: palette.main,
      '&::before': { width: '100%', left: 0, transform: 'translateX(0)' },
    },
    '&:active': { transform: 'scale(0.98)' },
    ...pickSize(SEGMENT_SIZES, customSize)(theme),
    // Each segment is a field; the track around it adds its own inset.
    minHeight: fieldHeight(theme, asFieldSize(customSize)),
    paddingTop: 0,
    paddingBottom: 0,
  };
};
