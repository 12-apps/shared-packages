import { alpha, keyframes } from '@mui/material';
import type { CSSObject, Theme } from '@mui/material/styles';

type BadgePalette = { main: string; light?: string; dark?: string; contrastText?: string };

const pulseAnimation = keyframes`
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
const bounceAnimation = keyframes`
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
const shimmerAnimation = keyframes`
  0% {
    background-position: -1000px 0;
  }
  100% {
    background-position: 1000px 0;
  }
`;

// Define fade in animation with scale
const fadeInScaleAnimation = keyframes`
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
const glowPulseAnimation = keyframes`
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

// The mount animation. `bounce` supersedes the fade-in rather than stacking
// with it, so the two are decided together.
export const badgeEntryStyles = ({
  animate,
  bounce,
}: {
  animate?: boolean;
  bounce?: boolean;
}): CSSObject => ({
  // Animation on mount
  ...(animate &&
    !bounce && {
      animation: `${fadeInScaleAnimation} 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55)`,
    }),

  // Bounce animation
  ...(bounce && {
    animation: `${bounceAnimation} 1s ease-in-out`,
  }),
});

// Shimmer effect
export const badgeShimmerStyles = ({
  theme,
  colorPalette,
  customVariant,
  shimmer,
}: {
  theme: Theme;
  colorPalette: BadgePalette;
  customVariant?: string;
  shimmer?: boolean;
}): CSSObject =>
  shimmer
    ? {
        background:
          customVariant === 'gradient'
            ? `linear-gradient(135deg, ${colorPalette.main} 0%, ${colorPalette.dark || colorPalette.main} 100%)`
            : colorPalette.main,
        backgroundSize: '1000px 100%',
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
      }
    : {};

// Glow and pulse are three states, not two flags: either alone, or the combined
// animation that neither produces on its own.
export const badgeGlowStyles = ({
  colorPalette,
  glow,
  pulse,
}: {
  colorPalette: BadgePalette;
  glow?: boolean;
  pulse?: boolean;
}): CSSObject => ({
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
});

// The `--glow-color` CSS variable wants channels, not a colour: the glow's
// box-shadow composes its own alpha from them.
export const rgbChannels = (color: string): string => {
  // Simple hex to RGB conversion
  if (color.startsWith('#')) {
    const hex = color.slice(1);

    return [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(', ');
  }

  // For rgb/rgba colors, extract values
  const match = color.match(/\d+/g);

  return match ? `${match[0]}, ${match[1]}, ${match[2]}` : '255, 255, 255';
};
