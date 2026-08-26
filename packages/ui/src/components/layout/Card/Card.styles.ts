import { alpha, keyframes } from '@mui/material/styles/index.js';
import type { CSSObject, Theme } from '@mui/material/styles/index.js';

import type { CardProps, CardVariant } from './Card.types';

type BorderRadius = NonNullable<CardProps['borderRadius']>;

// Define pulse animation
const pulseAnimation = keyframes`
  0% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 1;
  }
  70% {
    box-shadow: 0 0 0 15px currentColor;
    opacity: 0;
  }
  100% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 0;
  }
`;

const borderRadiusFor = (theme: Theme, radius: BorderRadius): number | string => {
  switch (radius) {
    case 'none':
      return 0;
    case 'sm':
      return theme.spacing(0.5);
    case 'lg':
      return theme.spacing(2);
    case 'xl':
      return theme.spacing(3);
    case 'full':
      return '50%';
    default:
      return theme.spacing(1);
  }
};

const pulseSurface = (theme: Theme): CSSObject => ({
  position: 'relative',
  overflow: 'visible',
  '&::after': {
    content: '""',
    position: 'absolute',
    top: '0',
    left: '0',
    right: '0',
    bottom: '0',
    borderRadius: 'inherit',
    backgroundColor: theme.palette.primary.main,
    opacity: 0.3,
    animation: `${pulseAnimation} 2s infinite`,
    pointerEvents: 'none',
    zIndex: -1,
  },
});

const neumorphicShadow = (theme: Theme, lifted: boolean): string => {
  const spread = lifted ? 12 : 8;
  const blur = spread * 2;

  return theme.palette.mode === 'dark'
    ? `${spread}px ${spread}px ${blur}px ${alpha(theme.palette.common.black, 0.3)}, -${spread}px -${spread}px ${blur}px ${alpha(theme.palette.common.white, 0.1)}`
    : `${spread}px ${spread}px ${blur}px ${alpha(theme.palette.grey[400], lifted ? 0.3 : 0.2)}, -${spread}px -${spread}px ${blur}px ${alpha(theme.palette.common.white, lifted ? 0.9 : 0.8)}`;
};

const sectionBackground = (theme: Theme, lifted: boolean): string => {
  if (theme.palette.mode === 'dark') {
    return lifted ? 'rgba(0, 0, 0, 0.25)' : 'rgba(0, 0, 0, 0.2)';
  }
  return lifted ? 'rgba(0, 0, 0, 0.04)' : 'rgba(0, 0, 0, 0.02)';
};

interface Surface {
  surface: CSSObject;
  hover: CSSObject;
}

/**
 * Each variant contributes a resting surface and whatever it changes on hover.
 * Only `interactive` cards actually move on hover, so the hover half of every
 * variant reads back its resting value when `interactive` is off.
 */
const VARIANT_SURFACES: Record<CardVariant, (theme: Theme, lifted: boolean) => Surface> = {
  elevated: (_theme, lifted) => ({
    surface: { elevation: 4 } as CSSObject,
    hover: { elevation: lifted ? 8 : 4 } as CSSObject,
  }),
  outlined: (theme, lifted) => ({
    surface: { border: `1px solid ${theme.palette.divider}`, boxShadow: 'none' },
    hover: { borderColor: lifted ? theme.palette.primary.main : theme.palette.divider },
  }),
  glass: (theme, lifted) => ({
    surface: {
      backgroundColor: alpha(theme.palette.background.paper, 0.1),
      backdropFilter: 'blur(20px)',
      border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
      boxShadow: `0 8px 32px ${alpha(theme.palette.common.black, 0.1)}`,
    },
    hover: {
      backgroundColor: alpha(theme.palette.background.paper, lifted ? 0.15 : 0.1),
      border: `1px solid ${alpha(theme.palette.primary.main, 0.3)}`,
    },
  }),
  gradient: (theme, lifted) => ({
    surface: {
      background: cardGradient(theme, false),
      color: theme.palette.primary.contrastText,
      boxShadow: `0 4px 20px ${alpha(theme.palette.primary.main, 0.3)}`,
    },
    hover: { background: cardGradient(theme, lifted) },
  }),
  neumorphic: (theme, lifted) => ({
    surface: {
      backgroundColor:
        theme.palette.mode === 'dark' ? theme.palette.grey[800] : theme.palette.grey[100],
      boxShadow: neumorphicShadow(theme, false),
      border: 'none',
    },
    hover: { boxShadow: neumorphicShadow(theme, lifted) },
  }),
  section: (theme, lifted) => ({
    surface: {
      backgroundColor: sectionBackground(theme, false),
      border: 'none',
      boxShadow: 'none',
    },
    hover: { backgroundColor: sectionBackground(theme, lifted) },
  }),
};

const cardGradient = (theme: Theme, dark: boolean): string =>
  dark
    ? `linear-gradient(135deg, ${theme.palette.primary.dark}, ${theme.palette.secondary.dark})`
    : `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`;

// An unrecognised variant gets the shared base only — no interactive, glow or
// pulse decoration, as before.
const variantSurface = (
  theme: Theme,
  variant: CardVariant,
  interactive: boolean,
): Surface | null => VARIANT_SURFACES[variant]?.(theme, interactive) ?? null;

interface CardStyleArgs {
  variant: CardVariant;
  interactive: boolean;
  glow: boolean;
  pulse: boolean;
  borderRadius: BorderRadius;
}

export const cardStyles = (
  theme: Theme,
  { variant, interactive, glow, pulse, borderRadius }: CardStyleArgs,
): CSSObject => {
  const base: CSSObject = {
    borderRadius: borderRadiusFor(theme, borderRadius),
    transition: theme.transitions.create(
      ['box-shadow', 'transform', 'border-color', 'background-color'],
      { duration: theme.transitions.duration.standard },
    ),
  };

  const chosen = variantSurface(theme, variant, interactive);
  if (!chosen) return base;

  return {
    ...base,
    ...(interactive && { cursor: 'pointer', '&:active': { transform: 'translateY(0)' } }),
    ...(glow && { boxShadow: `0 0 20px ${alpha(theme.palette.primary.main, 0.3)}` }),
    ...(pulse && pulseSurface(theme)),
    ...chosen.surface,
    '&:hover': {
      ...(interactive && { transform: 'translateY(-2px)' }),
      ...(glow && { boxShadow: `0 0 30px ${alpha(theme.palette.primary.main, 0.4)}` }),
      ...chosen.hover,
    },
  };
};
