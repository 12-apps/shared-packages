import { alpha } from '@mui/material';
import type { CSSObject, Theme } from '@mui/material/styles';

import {
  badgeEntryStyles,
  badgeGlowStyles,
  badgeShimmerStyles,
  rgbChannels,
} from './Badge.animations';
import type { BadgeSize, BadgeVariant } from './Badge.types';

type BadgePalette = { main: string; light?: string; dark?: string; contrastText?: string };
type BadgeSizeStyles = ReturnType<typeof getSizeStyles>;

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
      contrastText: theme.palette.getContrastText(theme.palette.grey[600]),
    },
  };

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
      iconSize: '0.625rem',
    },
    sm: {
      minWidth: 16,
      height: 16,
      fontSize: '0.625rem',
      padding: '0 4px',
      dotSize: 8,
      iconSize: '0.75rem',
    },
    md: {
      minWidth: 20,
      height: 20,
      fontSize: '0.75rem',
      padding: '0 6px',
      dotSize: 10,
      iconSize: '0.875rem',
    },
    lg: {
      minWidth: 24,
      height: 24,
      fontSize: '0.875rem',
      padding: '0 8px',
      dotSize: 12,
      iconSize: '1rem',
    },
  };

  return sizeMap[size] || sizeMap.md;
};

export const getAnchorOrigin = (position: string) => {
  const positionMap: Record<string, { vertical: 'top' | 'bottom'; horizontal: 'left' | 'right' }> =
    {
      'top-right': { vertical: 'top', horizontal: 'right' },
      'top-left': { vertical: 'top', horizontal: 'left' },
      'bottom-right': { vertical: 'bottom', horizontal: 'right' },
      'bottom-left': { vertical: 'bottom', horizontal: 'left' },
    };

  return positionMap[position] || positionMap['top-right'];
};

// Exactly one variant applies, so a lookup replaces ten mutually exclusive
// spreads inside the style object.
const BADGE_VARIANTS: Record<
  string,
  (theme: Theme, colorPalette: BadgePalette, sizeStyles: BadgeSizeStyles) => CSSObject
> = {
  default: (theme, colorPalette, sizeStyles) => ({
        backgroundColor: colorPalette.main,
        color:
          colorPalette.contrastText || theme.palette.getContrastText?.(colorPalette.main) || '#fff',
        minWidth: sizeStyles.minWidth,
        height: sizeStyles.height,
        fontSize: sizeStyles.fontSize,
        padding: sizeStyles.padding,
        borderRadius: sizeStyles.height / 2,
      }),
  dot: (theme, colorPalette, sizeStyles) => ({
        backgroundColor: colorPalette.main,
        width: sizeStyles.dotSize,
        height: sizeStyles.dotSize,
        minWidth: sizeStyles.dotSize,
        borderRadius: '50%',
        padding: 0,
      }),
  count: (theme, colorPalette, sizeStyles) => ({
        backgroundColor: colorPalette.main,
        color:
          colorPalette.contrastText || theme.palette.getContrastText?.(colorPalette.main) || '#fff',
        minWidth: sizeStyles.minWidth,
        height: sizeStyles.height,
        fontSize: sizeStyles.fontSize,
        padding: sizeStyles.padding,
        borderRadius: '50%',
      }),
  gradient: (theme, colorPalette, sizeStyles) => ({
        background: `linear-gradient(135deg, ${colorPalette.main} 0%, ${colorPalette.dark || colorPalette.main} 100%)`,
        color: '#fff',
        minWidth: sizeStyles.minWidth,
        height: sizeStyles.height,
        fontSize: sizeStyles.fontSize,
        padding: sizeStyles.padding,
        borderRadius: sizeStyles.height / 2,
      }),
  glass: (theme, colorPalette, sizeStyles) => ({
        backgroundColor: alpha(colorPalette.main, 0.1),
        backdropFilter: 'blur(10px) saturate(200%)',
        WebkitBackdropFilter: 'blur(10px) saturate(200%)',
        border: `1px solid ${alpha(colorPalette.main, 0.2)}`,
        color: colorPalette.main,
        minWidth: sizeStyles.minWidth,
        height: sizeStyles.height,
        fontSize: sizeStyles.fontSize,
        padding: sizeStyles.padding,
        borderRadius: sizeStyles.height / 2,
        boxShadow: `inset 0 1px 1px ${alpha(theme.palette.common.white, 0.1)}`,
      }),
  outline: (theme, colorPalette, sizeStyles) => ({
        backgroundColor: 'transparent',
        border: `2px solid ${colorPalette.main}`,
        color: colorPalette.main,
        minWidth: sizeStyles.minWidth,
        height: sizeStyles.height,
        fontSize: sizeStyles.fontSize,
        padding: sizeStyles.padding,
        borderRadius: sizeStyles.height / 2,
      }),
  secondary: (theme, colorPalette, sizeStyles) => ({
        backgroundColor: alpha(colorPalette.main, 0.15),
        color: colorPalette.main,
        border: `1px solid ${alpha(colorPalette.main, 0.3)}`,
        minWidth: sizeStyles.minWidth,
        height: sizeStyles.height,
        fontSize: sizeStyles.fontSize,
        padding: sizeStyles.padding,
        borderRadius: sizeStyles.height / 2,
      }),
  destructive: (theme, colorPalette, sizeStyles) => ({
        backgroundColor: theme.palette.error.main,
        color: theme.palette.error.contrastText,
        minWidth: sizeStyles.minWidth,
        height: sizeStyles.height,
        fontSize: sizeStyles.fontSize,
        padding: sizeStyles.padding,
        borderRadius: sizeStyles.height / 2,
        fontWeight: 700,
      }),
  success: (theme, colorPalette, sizeStyles) => ({
        backgroundColor: theme.palette.success.main,
        color: theme.palette.success.contrastText,
        minWidth: sizeStyles.minWidth,
        height: sizeStyles.height,
        fontSize: sizeStyles.fontSize,
        padding: sizeStyles.padding,
        borderRadius: sizeStyles.height / 2,
      }),
  warning: (theme, colorPalette, sizeStyles) => ({
        backgroundColor: theme.palette.warning.main,
        color: theme.palette.warning.contrastText,
        minWidth: sizeStyles.minWidth,
        height: sizeStyles.height,
        fontSize: sizeStyles.fontSize,
        padding: sizeStyles.padding,
        borderRadius: sizeStyles.height / 2,
      }),
};

const badgeVariantStyles = (
  theme: Theme,
  colorPalette: BadgePalette,
  sizeStyles: BadgeSizeStyles,
  customVariant?: string,
): CSSObject =>
  customVariant ? (BADGE_VARIANTS[customVariant]?.(theme, colorPalette, sizeStyles) ?? {}) : {};

// The badge chip's own styling, lifted out so the styled() callback just
// forwards its props.
type BadgeStyleArgs = {
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
};

export const badgeStyles = ({
  theme, customVariant, customSize = 'md', customColor = 'primary',
  glow, pulse, animate, shimmer, bounce, hasIcon,
}: BadgeStyleArgs): CSSObject => {
  const colorPalette = getColorFromTheme(theme, customColor);
  const sizeStyles = getSizeStyles(customSize);

  return {
    '--glow-color': rgbChannels(colorPalette.main),
    '& .MuiBadge-badge': {
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      fontWeight: 600,
      border: `2px solid ${theme.palette.background.paper}`,
      letterSpacing: '0.025em',
      textTransform:
        customVariant === 'gradient' || customVariant === 'glass' ? 'uppercase' : 'none',
      willChange: 'transform, opacity',
      backfaceVisibility: 'hidden',

      // Base styles based on variant










      // Outline variant


      // Secondary variant


      // Destructive variant


      // Success variant


      // Warning variant


      // Adjust padding when icon is present
      ...badgeVariantStyles(theme, colorPalette, sizeStyles, customVariant),
      ...(hasIcon && {
        paddingLeft: sizeStyles.padding.split(' ')[1],
        display: 'inline-flex',
        alignItems: 'center',
        gap: '2px',
      }),

      ...badgeEntryStyles({ animate, bounce }),
      ...badgeShimmerStyles({ theme, colorPalette, customVariant, shimmer }),
      ...badgeGlowStyles({ colorPalette, glow, pulse }),

      // Hover effects
      '&:not(.MuiBadge-dot):hover': {
        transform: 'scale(1.1)',
        zIndex: 1,
      },
    },
  };
}
