import { alpha } from '@mui/material';
import type { CSSObject, Theme } from '@mui/material/styles';

import {
  bounceAnimation,
  fadeInScaleAnimation,
  glowPulseAnimation,
  pulseAnimation,
  shimmerAnimation } from './Badge.animations';
import { badgeVariantStyles } from './Badge.variants';
import type { BadgeSize, BadgeVariant } from './Badge.types';

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
    error: theme.palette.error,
    info: theme.palette.info,
    neutral: {
      main: theme.palette.grey[600],
      light: theme.palette.grey[400],
      dark: theme.palette.grey[800],
      contrastText: theme.palette.getContrastText(theme.palette.grey[600]) } };

  return colorMap[color] || theme.palette.primary;
};

export const getSizeStyles = (size: BadgeSize) => {
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
  > = {
    xs: {
      minWidth: 14,
      height: 14,
      fontSize: '0.5rem',
      padding: '0 3px',
      dotSize: 6,
      iconSize: '0.625rem' },
    sm: {
      minWidth: 16,
      height: 16,
      fontSize: '0.625rem',
      padding: '0 4px',
      dotSize: 8,
      iconSize: '0.75rem' },
    md: {
      minWidth: 20,
      height: 20,
      fontSize: '0.75rem',
      padding: '0 6px',
      dotSize: 10,
      iconSize: '0.875rem' },
    lg: {
      minWidth: 24,
      height: 24,
      fontSize: '0.875rem',
      padding: '0 8px',
      dotSize: 12,
      iconSize: '1rem' } };

  return sizeMap[size] || sizeMap.md;
};

export const getAnchorOrigin = (position: string) => {
  const positionMap: Record<string, { vertical: 'top' | 'bottom'; horizontal: 'left' | 'right' }> =
    {
      'top-right': { vertical: 'top', horizontal: 'right' },
      'top-left': { vertical: 'top', horizontal: 'left' },
      'bottom-right': { vertical: 'bottom', horizontal: 'right' },
      'bottom-left': { vertical: 'bottom', horizontal: 'left' } };

  return positionMap[position] || positionMap['top-right'];
};

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
          boxShadow: `0 0 15px 3px ${alpha(colorPalette.main, 0.5)}`,
          filter: 'brightness(1.1)',
          '&:hover': {
            boxShadow: `0 0 20px 4px ${alpha(colorPalette.main, 0.6)}` } }),

      // Pulse animation
      ...(pulse &&
        !glow && {
          animation: `${pulseAnimation} 2s ease-in-out infinite` }),

      // Both glow and pulse
      ...(glow &&
        pulse && {
          animation: `${glowPulseAnimation} 2s ease-in-out infinite, ${pulseAnimation} 2s ease-in-out infinite`,
          filter: 'brightness(1.1)',
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
          animation: `${fadeInScaleAnimation} 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55)` }),

      // Bounce animation
      ...(bounce && {
        animation: `${bounceAnimation} 1s ease-in-out` }),

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
            ${alpha(theme.palette.common.white, 0.4)},
            transparent
          )`,
          animation: `${shimmerAnimation} 3s infinite` } }) });

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
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      fontWeight: 600,
      border: `2px solid ${theme.palette.background.paper}`,
      letterSpacing: '0.025em',
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
        gap: '2px',
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
        transform: 'scale(1.1)',
        zIndex: 1 } } };
}
