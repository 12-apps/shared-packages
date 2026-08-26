import { alpha, keyframes } from '@mui/material/styles';
import type { CSSObject, Theme } from '@mui/material/styles';

const glowAnimation = keyframes`
  0% {
    box-shadow: 0 0 5px currentColor;
  }
  50% {
    box-shadow: 0 0 20px currentColor, 0 0 30px currentColor;
  }
  100% {
    box-shadow: 0 0 5px currentColor;
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
export const floatAnimation = keyframes`
  0% {
    transform: translateY(0px);
  }
  50% {
    transform: translateY(-3px);
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

// grey is indexed by weight rather than main/dark/light, so neutral is built by
// hand. The literals are the MUI grey values, used if the theme omits a weight.
const neutralPalette = (theme: Theme): ResolvedPalette => {
  const grey = theme.palette.grey as unknown as Record<number, string>;

  return {
    main: grey?.[700] || '#616161',
    dark: grey?.[800] || '#424242',
    light: grey?.[500] || '#9e9e9e',
    contrastText: '#fff',
  };
};

// Each slot falls back to the palette's own main, then to primary — a custom
// theme can define main without dark or light.
const pick = (...candidates: Array<string | undefined>): string =>
  candidates.find(Boolean) ?? '';

const withFallbacks = (theme: Theme, palette: PartialPalette): ResolvedPalette => ({
  main: pick(palette?.main, theme.palette.primary.main),
  dark: pick(palette?.dark, palette?.main, theme.palette.primary.dark),
  light: pick(palette?.light, palette?.main, theme.palette.primary.light),
  contrastText: pick(palette?.contrastText, '#fff'),
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
      backdropFilter: 'blur(20px)',
      border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
      '&:hover': {
        backgroundColor: alpha(theme.palette.background.paper, 0.15),
        backdropFilter: 'blur(25px)',
      },
      '&:focus': {
        backgroundColor: alpha(theme.palette.background.paper, 0.2),
        backdropFilter: 'blur(30px)',
      },
    }
  : {};

// Gradient border effect
const gradientStyles = gradient
  ? {
      background: `linear-gradient(${theme.palette.background.paper}, ${theme.palette.background.paper}) padding-box,
               linear-gradient(135deg, ${colorPalette.main}, ${colorPalette.light}) border-box`,
      border: '2px solid transparent',
      '&:focus': {
        background: `linear-gradient(${theme.palette.background.paper}, ${theme.palette.background.paper}) padding-box,
                 linear-gradient(135deg, ${colorPalette.main}, ${colorPalette.dark}) border-box`,
      },
    }
  : {};

// Glow effect
const glowStyles = glow
  ? {
      animation: `${glowAnimation} 2s ease-in-out infinite`,
      boxShadow: `0 0 10px ${alpha(colorPalette.main, 0.3)}`,
    }
  : {};

  return { ...glassStyles, ...gradientStyles, ...glowStyles };
};
