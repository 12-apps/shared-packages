import { alpha, keyframes } from '@mui/material/styles/index.js';
import type { CSSObject, PaletteColor, Theme } from '@mui/material/styles/index.js';

import type { BannerVariant } from './Banner.types';

// Animations
export const fadeInSlide = keyframes`
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

const pulseAnimation = keyframes`
  0% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 0.7;
  }
  70% {
    box-shadow: 0 0 0 8px currentColor;
    opacity: 0;
  }
  100% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 0;
  }
`;

export const getVariantColor = (theme: Theme, variant: BannerVariant) => {
  const colorMap = {
    info: theme.palette.info,
    success: theme.palette.success,
    warning: theme.palette.warning,
    critical: theme.palette.error,
  };
  return colorMap[variant];
};

export const bannerPartStyles = (theme: Theme, colorPalette: PaletteColor): CSSObject => ({
  // Icon container
  '.banner-icon': {
    flexShrink: 0,
    marginTop: theme.spacing(0.25),
    color: colorPalette.main,
    fontSize: '1.25rem',
    display: 'flex',
    alignItems: 'center',
    position: 'relative',

    '&::before': {
      content: '""',
      position: 'absolute',
      inset: -4,
      borderRadius: '50%',
      background: alpha(colorPalette.main, 0.1),
      animation: `${pulseAnimation} 3s infinite`,
    },
  },

  // Content area
  '.banner-content': {
    flex: 1,
    minWidth: 0, // Prevents flex item overflow
  },

  // Title styles
  '.banner-title': {
    fontWeight: 600,
    fontSize: '1rem',
    lineHeight: 1.4,
    marginBottom: theme.spacing(0.5),
    color: colorPalette.dark || colorPalette.main,
  },

  // Description styles  
  '.banner-description': {
    fontSize: '0.875rem',
    lineHeight: 1.5,
    opacity: 0.9,
    color: 'inherit',
  },

  // Actions area
  '.banner-actions': {
    display: 'flex',
    flexShrink: 0,
    gap: theme.spacing(1),
    alignItems: 'center',
    marginTop: theme.spacing(1),

    [theme.breakpoints.up('sm')]: {
      marginTop: 0,
      marginLeft: theme.spacing(2),
    },
  },

  // Dismiss button
  '.banner-dismiss': {
    color: 'inherit',
    opacity: 0.7,
    marginLeft: theme.spacing(1),
    flexShrink: 0,

    '&:hover': {
      opacity: 1,
      backgroundColor: alpha(colorPalette.main, 0.1),
      transform: 'rotate(90deg)',
    },

    '&:focus': {
      opacity: 1,
      outline: `2px solid ${colorPalette.main}`,
      outlineOffset: '2px',
    },
  },
});
