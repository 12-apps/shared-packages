import { alpha, keyframes } from '@mui/material';
import type { CSSObject, Theme } from '@mui/material/styles';

import type { BadgeSize, BadgeVariant } from './Badge.types';

type BadgePalette = { main: string; light?: string; dark?: string; contrastText?: string };
type BadgeSizeStyles = ReturnType<typeof getSizeStyles>;

export const pulseAnimation = keyframes`
  0% {
    transform: scale(1);
    opacity: 1;
  }
  70% {
    transform: scale(1.2);
    opacity: 0.7;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
`;

// Define bounce animation
export const bounceAnimation = keyframes`
  0%, 20%, 50%, 80%, 100% {
    transform: translateY(0) scale(1);
  }
  40% {
    transform: translateY(-8px) scale(1.05);
  }
  60% {
    transform: translateY(-4px) scale(1.02);
  }
`;

// Define shimmer animation
export const shimmerAnimation = keyframes`
  0% {
    background-position: -1000px 0;
  }
  100% {
    background-position: 1000px 0;
  }
`;

// Define fade in animation with scale
export const fadeInScaleAnimation = keyframes`
  0% {
    opacity: 0;
    transform: scale(0.5);
  }
  50% {
    transform: scale(1.1);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
`;

// Define glow pulse animation
export const glowPulseAnimation = keyframes`
  0% {
    box-shadow: 0 0 5px 2px rgba(var(--glow-color), 0.4);
  }
  50% {
    box-shadow: 0 0 20px 4px rgba(var(--glow-color), 0.8);
  }
  100% {
    box-shadow: 0 0 5px 2px rgba(var(--glow-color), 0.4);
  }
`;

export const getColorFromTheme = (theme: Theme, color: string) => {
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
  hasIcon,
}: {
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
}): CSSObject => {
  const colorPalette = getColorFromTheme(theme, customColor);
  const sizeStyles = getSizeStyles(customSize);

  // Extract RGB values for CSS variable
  const getRgbValues = (color: string) => {
    // Simple hex to RGB conversion
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return `${r}, ${g}, ${b}`;
    }
    // For rgb/rgba colors, extract values
    const match = color.match(/\d+/g);
    if (match) {
      return `${match[0]}, ${match[1]}, ${match[2]}`;
    }
    return '255, 255, 255';
  };

  return {
    '--glow-color': getRgbValues(colorPalette.main),
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

      // Animation on mount
      ...(animate &&
        !bounce && {
          animation: `${fadeInScaleAnimation} 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55)`,
        }),

      // Bounce animation
      ...(bounce && {
        animation: `${bounceAnimation} 1s ease-in-out`,
      }),

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
          animation: `${shimmerAnimation} 3s infinite`,
        },
      }),

      // Glow effect
      ...(glow &&
        !pulse && {
          boxShadow: `0 0 15px 3px ${alpha(colorPalette.main, 0.5)}`,
          filter: 'brightness(1.1)',
          '&:hover': {
            boxShadow: `0 0 20px 4px ${alpha(colorPalette.main, 0.6)}`,
          },
        }),

      // Pulse animation
      ...(pulse &&
        !glow && {
          animation: `${pulseAnimation} 2s ease-in-out infinite`,
        }),

      // Both glow and pulse
      ...(glow &&
        pulse && {
          animation: `${glowPulseAnimation} 2s ease-in-out infinite, ${pulseAnimation} 2s ease-in-out infinite`,
          filter: 'brightness(1.1)',
        }),

      // Hover effects
      '&:not(.MuiBadge-dot):hover': {
        transform: 'scale(1.1)',
        zIndex: 1,
      },
    },
  };
}
