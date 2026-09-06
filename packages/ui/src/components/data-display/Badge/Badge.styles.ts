import { alpha } from '@mui/material/styles/index.js';
import type { CSSObject, Theme } from '@mui/material/styles/index.js';

import {
  bounceAnimation,
  fadeInScaleAnimation,
  glowPulseAnimation,
  pulseAnimation,
  shimmerAnimation } from './Badge.animations';
import {
  BADGE_BORDER_WIDTH,
  BADGE_CONTENT_GAP,
  BADGE_FONT_WEIGHT,
  BADGE_LETTER_SPACING_EM,
  BADGE_SIZES,
  BADGE_TRANSITION_EASING,
  BADGE_TRANSITION_MS,
  BOUNCE,
  FADE_IN_SCALE,
  GLOW,
  HOVER_SCALE,
  PULSE,
  SHIMMER,
  badgeAnchor,
} from './Badge.metrics';
import { badgeVariantStyles } from './Badge.variants';
import type { BadgeSize, BadgeVariant } from './Badge.types';
import { px } from '../../../tokens/theme';

export type BadgePalette = {
  main: string;
  light?: string;
  dark?: string;
  contrastText?: string;
};
export type BadgeSizeStyles = ReturnType<typeof getSizeStyles>;

const getColorFromTheme = (theme: Theme, color: string) => {
  const colorMap: Record<string, ReturnType<typeof theme.palette.augmentColor>> = {
    primary: theme.palette.primary,
    secondary: theme.palette.secondary,
    success: theme.palette.success,
    warning: theme.palette.warning,
    info: theme.palette.info,
    // `danger`, the house word the prop actually takes. Keyed on MUI's `error`
    // it matched nothing and fell through to the default.
    danger: theme.palette.error,
    neutral: {
      main: theme.palette.grey[600],
      light: theme.palette.grey[400],
      dark: theme.palette.grey[800],
      contrastText: theme.palette.getContrastText(theme.palette.grey[600]) } };

  return colorMap[color] || theme.palette.primary;
};

// Derived from the shared metrics, not restated: the native `Badge` reads the
// same table, so the two renderers cannot disagree on a chip.
const sizeMap: Record<
  BadgeSize,
  {
    minWidth: number;
    height: number;
    fontSize: string;
    padding: string;
    dotSize: number;
    iconSize: string;
  }
> = Object.fromEntries(
  Object.entries(BADGE_SIZES).map(([size, metrics]) => [
    size,
    {
      minWidth: metrics.minWidth,
      height: metrics.height,
      fontSize: px(metrics.fontSize),
      padding: `0 ${metrics.paddingHorizontal}px`,
      dotSize: metrics.dotSize,
      iconSize: px(metrics.iconSize),
    },
  ]),
) as Record<
  BadgeSize,
  { minWidth: number; height: number; fontSize: string; padding: string; dotSize: number; iconSize: string }
>;

export const getSizeStyles = (size: BadgeSize) => sizeMap[size] || sizeMap.md;

export const getAnchorOrigin = (position: string) =>
  badgeAnchor((position || 'top-right') as Parameters<typeof badgeAnchor>[0]);

// Exactly one variant applies, so a lookup replaces ten mutually exclusive
// spreads inside the style object.
// The glow effect needs the badge colour as bare RGB components for a CSS
// variable, and the palette hands them over as hex or rgb().
const rgbValuesOf = (color: string): string => {
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const [r, g, b] = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
    return `${r}, ${g}, ${b}`;
  }

  const match = color.match(/\d+/g);
  if (match) return `${match[0]}, ${match[1]}, ${match[2]}`;
  return '255, 255, 255';
};

// Glow and pulse combine into a third, distinct treatment rather than stacking.
const badgeLightingStyles = ({
  glow,
  pulse,
  colorPalette }: {
  glow?: boolean;
  pulse?: boolean;
  colorPalette: BadgePalette;
}): CSSObject => ({
      // Glow effect
      ...(glow &&
        !pulse && {
          boxShadow: `0 0 ${GLOW.blur}px ${GLOW.spread}px ${alpha(colorPalette.main, GLOW.alpha)}`,
          filter: `brightness(${GLOW.brightness})`,
          '&:hover': {
            boxShadow: `0 0 ${GLOW.hoverBlur}px ${GLOW.hoverSpread}px ${alpha(colorPalette.main, GLOW.hoverAlpha)}` } }),

      // Pulse animation
      ...(pulse &&
        !glow && {
          animation: `${pulseAnimation} ${PULSE.durationMs / 1000}s ease-in-out infinite` }),

      // Both glow and pulse
      ...(glow &&
        pulse && {
          animation: `${glowPulseAnimation} ${PULSE.durationMs / 1000}s ease-in-out infinite, ${pulseAnimation} ${PULSE.durationMs / 1000}s ease-in-out infinite`,
          filter: `brightness(${GLOW.brightness})`,
        }),

});

const badgeAnimationStyles = ({
  animate,
  bounce,
  shimmer,
  glow: _glow,
  pulse: _pulse,
  customVariant,
  colorPalette,
  theme }: {
  animate?: boolean;
  bounce?: boolean;
  shimmer?: boolean;
  glow?: boolean;
  pulse?: boolean;
  customVariant?: BadgeVariant;
  colorPalette: BadgePalette;
  theme: Theme;
}): CSSObject => ({
      ...(animate &&
        !bounce && {
          animation: `${fadeInScaleAnimation} ${FADE_IN_SCALE.durationMs / 1000}s cubic-bezier(0.68, -0.55, 0.265, 1.55)` }),

      // Bounce animation
      ...(bounce && {
        animation: `${bounceAnimation} ${BOUNCE.durationMs / 1000}s ease-in-out` }),

      // Shimmer effect
      ...(shimmer && {
        background:
          customVariant === 'gradient'
            ? `linear-gradient(135deg, ${colorPalette.main} 0%, ${colorPalette.dark || colorPalette.main} 100%)`
            : colorPalette.main,
        backgroundSize: shimmer ? '1000px 100%' : 'auto',
        position: 'relative',
        overflow: 'hidden',
        '&::after': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: `linear-gradient(
            90deg,
            transparent,
            ${alpha(theme.palette.common.white, SHIMMER.alpha)},
            transparent
          )`,
          animation: `${shimmerAnimation} ${SHIMMER.durationMs / 1000}s infinite` } }) });

// The badge chip's own styling, lifted out so the styled() callback just
// forwards its props.
interface BadgeStyleArgs {
  theme: Theme;
  customVariant?: BadgeVariant;
  customSize?: BadgeSize;
  customColor?: string;
  glow?: boolean;
  pulse?: boolean;
  animate?: boolean;
  shimmer?: boolean;
  bounce?: boolean;
  hasIcon?: boolean;
}

export const badgeStyles = ({
  theme,
  customVariant,
  customSize = 'md',
  customColor = 'primary',
  glow,
  pulse,
  animate,
  shimmer,
  bounce,
  hasIcon }: BadgeStyleArgs): CSSObject => {
  const colorPalette = getColorFromTheme(theme, customColor);
  const sizeStyles = getSizeStyles(customSize);

  return {
    '--glow-color': rgbValuesOf(colorPalette.main),
    '& .MuiBadge-badge': {
      transition: `all ${BADGE_TRANSITION_MS / 1000}s ${BADGE_TRANSITION_EASING}`,
      fontWeight: BADGE_FONT_WEIGHT,
      border: `${BADGE_BORDER_WIDTH}px solid ${theme.palette.background.paper}`,
      letterSpacing: `${BADGE_LETTER_SPACING_EM}em`,
      textTransform:
        customVariant === 'gradient' || customVariant === 'glass' ? 'uppercase' : 'none',
      willChange: 'transform, opacity',
      backfaceVisibility: 'hidden',

      // Outline variant

      // Destructive variant

      // Warning variant

      // Adjust padding when icon is present
      ...badgeVariantStyles(theme, colorPalette, sizeStyles, customVariant),
      ...(hasIcon && {
        paddingLeft: sizeStyles.padding.split(' ')[1],
        display: 'inline-flex',
        alignItems: 'center',
        gap: `${BADGE_CONTENT_GAP}px`,
      }),

      // Animation on mount
      ...badgeAnimationStyles({
        animate,
        bounce,
        shimmer,
        glow,
        pulse,
        customVariant,
        colorPalette,
        theme }),
      ...badgeLightingStyles({ glow, pulse, colorPalette }),

      '&:not(.MuiBadge-dot):hover': {
        transform: `scale(${HOVER_SCALE})`,
        zIndex: 1 } } };
}
