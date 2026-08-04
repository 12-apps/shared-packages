import Error from '@mui/icons-material/Error';
import Info from '@mui/icons-material/Info';
import CheckCircle from '@mui/icons-material/CheckCircle';
import Warning from '@mui/icons-material/Warning';
import { alpha, keyframes } from '@mui/material';
import type { CSSObject, Theme } from '@mui/material/styles';
import React from 'react';

export const pulseAnimation = keyframes`
  0% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 1;
  }
  70% {
    box-shadow: 0 0 0 10px currentColor;
    opacity: 0;
  }
  100% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 0;
  }
`;

// Additional animations can be enabled as needed
// const slideInAnimation = keyframes`
//   from {
//     transform: translateX(-100%);
//     opacity: 0;
//   }
//   to {
//     transform: translateX(0);
//     opacity: 1;
//   }
// `;

// const bounceIn = keyframes`
//   0% {
//     transform: scale(0.3);
//     opacity: 0;
//   }
//   50% {
//     transform: scale(1.05);
//   }
//   70% {
//     transform: scale(0.9);
//   }
//   100% {
//     transform: scale(1);
//     opacity: 1;
//   }
// `;

// Removed unused slideInAnimation - can be re-added if needed for future features

export const shimmerAnimation = keyframes`
  0% {
    background-position: -1000px 0;
  }
  100% {
    background-position: 1000px 0;
  }
`;

export const fadeInScale = keyframes`
  from {
    opacity: 0;
    transform: scale(0.95) translateY(-10px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
`;

export const iconRotate = keyframes`
  0% {
    transform: rotate(0deg) scale(0.8);
  }
  50% {
    transform: rotate(180deg) scale(1.1);
  }
  100% {
    transform: rotate(360deg) scale(1);
  }
`;

export const getColorFromTheme = (theme: Theme, variant: string) => {
  const colorMap: Record<string, { main: string; light?: string; dark?: string }> = {
    info: theme.palette.info,
    success: theme.palette.success,
    warning: theme.palette.warning,
    danger: theme.palette.error,
    primary: theme.palette.primary,
    secondary: theme.palette.secondary,
    neutral: {
      main: theme.palette.grey[500] || '#9E9E9E',
      light: theme.palette.grey[300] || '#E0E0E0',
      dark: theme.palette.grey[700] || '#616161',
    },
  };

  return colorMap[variant] || theme.palette.info;
};

export const getVariantIcon = (variant: string) => {
  const iconMap: Record<string, React.ReactNode> = {
    info: <Info />,
    success: <CheckCircle />,
    warning: <Warning />,
    danger: <Error />,
  };

  return iconMap[variant];
};

// The palette shape getColorFromTheme returns — a main plus optional light/dark,
// which is narrower than MUI's PaletteColor.
export type AlertPalette = { main: string; light?: string; dark?: string };

// The six visual variants. Each block is spread in only when it matches, which
// is how the original inline version read; keeping that shape here means the
// styled() callback carries one branch instead of six.
export const alertVariantStyles = (
  theme: Theme,
  customVariant: string | undefined,
  colorPalette: AlertPalette,
): CSSObject => ({
...(customVariant === 'info' && {
  backgroundColor: alpha(colorPalette.main, 0.1),
  color: colorPalette.main,
  border: `1px solid ${alpha(colorPalette.main, 0.2)}`,
  '.MuiAlert-icon': {
    color: colorPalette.main,
  },
}),

...(customVariant === 'success' && {
  backgroundColor: alpha(colorPalette.main, 0.1),
  color: colorPalette.main,
  border: `1px solid ${alpha(colorPalette.main, 0.2)}`,
  '.MuiAlert-icon': {
    color: colorPalette.main,
  },
}),

...(customVariant === 'warning' && {
  backgroundColor: alpha(colorPalette.main, 0.1),
  color: colorPalette.main,
  border: `1px solid ${alpha(colorPalette.main, 0.2)}`,
  '.MuiAlert-icon': {
    color: colorPalette.main,
  },
}),

...(customVariant === 'danger' && {
  backgroundColor: alpha(colorPalette.main, 0.1),
  color: colorPalette.main,
  border: `1px solid ${alpha(colorPalette.main, 0.2)}`,
  '.MuiAlert-icon': {
    color: colorPalette.main,
  },
}),

...(customVariant === 'glass' && {
  backgroundColor: alpha(theme.palette.background.paper, 0.1),
  backdropFilter: 'blur(20px)',
  border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
  color: theme.palette.text.primary,
  '.MuiAlert-icon': {
    color: theme.palette.primary.main,
  },
}),

...(customVariant === 'gradient' && {
  background: `linear-gradient(135deg, ${alpha(colorPalette.light || colorPalette.main, 0.9)}, ${alpha(colorPalette.dark || colorPalette.main, 0.9)})`,
  color: theme.palette.getContrastText(colorPalette.main),
  border: 'none',
  position: 'relative',
  overflow: 'hidden',
  '.MuiAlert-icon': {
    color: theme.palette.getContrastText(colorPalette.main),
  },
  '&::before': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: '-1000px',
    width: '100%',
    height: '100%',
    background: `linear-gradient(90deg, transparent, ${alpha(theme.palette.common.white, 0.2)}, transparent)`,
    animation: `${shimmerAnimation} 3s infinite`,
  },
  '&:hover': {
    filter: 'brightness(1.1)',
    transform: 'translateY(-2px) scale(1.01)',
  },
}),
});

// glow and pulse combine into three distinct looks, so the combinations are
// spelled out rather than layered — layering them would let the glow-only shadow
// leak into the glow+pulse case.
export const alertEmphasisStyles = (
  colorPalette: AlertPalette,
  glow: boolean,
  pulse: boolean,
): CSSObject => ({
...(glow &&
  !pulse && {
    boxShadow: `0 0 20px 5px ${alpha(colorPalette.main, 0.3)} !important`,
    filter: 'brightness(1.05)',
  }),

// Pulse animation
...(pulse &&
  !glow && {
    position: 'relative',
    '&::after': {
      content: '""',
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      borderRadius: 'inherit',
      backgroundColor: colorPalette.main,
      opacity: 0.2,
      animation: `${pulseAnimation} 2s infinite`,
      pointerEvents: 'none',
      zIndex: -1,
    },
  }),

// Both glow and pulse
...(glow &&
  pulse && {
    position: 'relative',
    boxShadow: `0 0 20px 5px ${alpha(colorPalette.main, 0.3)} !important`,
    filter: 'brightness(1.05)',
    '&::after': {
      content: '""',
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      borderRadius: 'inherit',
      backgroundColor: colorPalette.main,
      opacity: 0.2,
      animation: `${pulseAnimation} 2s infinite`,
      pointerEvents: 'none',
      zIndex: -1,
    },
  }),
});
