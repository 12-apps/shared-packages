import { alpha, keyframes } from '@mui/material/styles/index.js';
import type { CSSObject, Theme } from '@mui/material/styles/index.js';

import { fieldEdge } from '../../../tokens/field-edge';
import { absoluteInk, controlNeutral } from '../../../tokens/ink';
import { rem } from '../../../tokens/relative';

const glowAnimation = (theme: Theme) => keyframes`
  0% {
    box-shadow: 0 0 ${rem(theme, 5)} currentColor;
  }
  50% {
    box-shadow: 0 0 ${rem(theme, 20)} currentColor, 0 0 ${rem(theme, 30)} currentColor;
  }
  100% {
    box-shadow: 0 0 ${rem(theme, 5)} currentColor;
  }
`;

// Ripple animation for buttons (commented out - not currently used)
// const rippleAnimation = keyframes`
//   0% {
//     transform: scale(0);
//     opacity: 1;
//   }
//   100% {
//     transform: scale(4);
//     opacity: 0;
//   }
// `;

// Float animation for rich text toolbar
export const floatAnimation = (theme: Theme) => keyframes`
  0% {
    transform: translateY(0px);
  }
  50% {
    transform: translateY(${rem(theme, -3)});
  }
  100% {
    transform: translateY(0px);
  }
`;

type ResolvedPalette = {
  main: string;
  dark: string;
  light: string;
  contrastText: string;
};

type PartialPalette = { main: string; dark?: string; light?: string; contrastText?: string };

// `neutral` is not a MUI palette entry, so it is the controls' neutral tone.
const neutralPalette = (theme: Theme): ResolvedPalette => controlNeutral(theme);

// Each slot falls back to the palette's own main, then to primary — a custom
// theme can define main without dark or light.
const pick = (...candidates: Array<string | undefined>): string =>
  candidates.find(Boolean) ?? '';

const withFallbacks = (theme: Theme, palette: PartialPalette): ResolvedPalette => ({
  main: pick(palette?.main, theme.palette.primary.main),
  dark: pick(palette?.dark, palette?.main, theme.palette.primary.dark),
  light: pick(palette?.light, palette?.main, theme.palette.primary.light),
  contrastText: pick(palette?.contrastText, absoluteInk(theme).white),
});

export const getColorFromTheme = (theme: Theme, color: string): ResolvedPalette => {
  if (color === 'neutral') return neutralPalette(theme);

  const colorMap: Record<string, PartialPalette> = {
    primary: theme.palette.primary,
    secondary: theme.palette.secondary,
    success: theme.palette.success,
    warning: theme.palette.warning,
    info: theme.palette.info,
    danger: theme.palette.error,
  };

  return withFallbacks(theme, colorMap[color] || theme.palette.primary);
};

// glass, gradient and glow are independent flags that each layer styles onto the
// base. Spelled out here rather than inline so the styled() callback keeps one
// branch instead of three.
export const textareaEmphasisStyles = ({
  theme,
  colorPalette,
  glass,
  gradient,
  glow,
}: {
  theme: Theme;
  colorPalette: { main: string; light?: string; dark?: string };
  glass?: boolean;
  gradient?: boolean;
  glow?: boolean;
}): CSSObject => {
const glassStyles = glass
  ? {
      backgroundColor: alpha(theme.palette.background.paper, 0.1),
      backdropFilter: `blur(${rem(theme, 20)})`,
      border: `1px solid ${fieldEdge(theme)}`,
      '&:hover': {
        backgroundColor: alpha(theme.palette.background.paper, 0.15),
        backdropFilter: `blur(${rem(theme, 25)})`,
      },
      '&:focus': {
        backgroundColor: alpha(theme.palette.background.paper, 0.2),
        backdropFilter: `blur(${rem(theme, 30)})`,
      },
    }
  : {};

// Gradient border effect
const gradientStyles = gradient
  ? {
      background: `linear-gradient(${theme.palette.background.paper}, ${theme.palette.background.paper}) padding-box,
               linear-gradient(135deg, ${colorPalette.main}, ${colorPalette.light}) border-box`,
      border: `${rem(theme, 2)} solid transparent`,
      '&:focus': {
        background: `linear-gradient(${theme.palette.background.paper}, ${theme.palette.background.paper}) padding-box,
                 linear-gradient(135deg, ${colorPalette.main}, ${colorPalette.dark}) border-box`,
      },
    }
  : {};

// Glow effect
const glowStyles = glow
  ? {
      animation: `${glowAnimation(theme)} 2s ease-in-out infinite`,
      boxShadow: `0 0 ${rem(theme, 10)} ${alpha(colorPalette.main, 0.3)}`,
    }
  : {};

  return { ...glassStyles, ...gradientStyles, ...glowStyles };
};
