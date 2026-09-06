import { alpha, keyframes } from '@mui/material/styles/index.js';
import type { CSSObject, Theme } from '@mui/material/styles/index.js';

import type { CardBorderRadius, CardVariant } from './Card.base';
import {
  CARD_BORDER_WIDTH,
  CARD_ELEVATION,
  CARD_GLASS,
  CARD_GLOW,
  CARD_GRADIENT,
  CARD_INTERACTIVE_LIFT,
  CARD_NEUMORPHIC,
  CARD_PULSE,
  CARD_RADIUS_FULL,
  CARD_RADIUS_UNITS,
  CARD_SECTION_BACKGROUND,
  neumorphicShadows,
} from './Card.metrics';
import { shadowCss, shadowListCss } from '../../../tokens/shadow';

type BorderRadius = CardBorderRadius;

// Define pulse animation. The 15px spread and the 2s period are the shared
// metrics, so the native ring grows by exactly as much for exactly as long.
const pulseAnimation = keyframes`
  0% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 1;
  }
  70% {
    box-shadow: 0 0 0 ${CARD_PULSE.spread}px currentColor;
    opacity: 0;
  }
  100% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 0;
  }
`;

const borderRadiusFor = (theme: Theme, radius: BorderRadius): number | string => {
  if (radius === 'full') return CARD_RADIUS_FULL;
  const units = CARD_RADIUS_UNITS[radius] ?? CARD_RADIUS_UNITS.md;
  // `none` is a bare 0 rather than `spacing(0)`, as this has always written it.
  return units === 0 ? 0 : theme.spacing(units);
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
    opacity: CARD_PULSE.alpha,
    animation: `${pulseAnimation} ${CARD_PULSE.durationMs / 1000}s infinite`,
    pointerEvents: 'none',
    zIndex: CARD_PULSE.zIndex,
  },
});

const neumorphicShadow = (theme: Theme, lifted: boolean): string => {
  const { dark, light } = CARD_NEUMORPHIC.alpha;
  const [near, far] =
    theme.palette.mode === 'dark'
      ? [
          alpha(theme.palette.common.black, dark.near),
          alpha(theme.palette.common.white, dark.far),
        ]
      : [
          alpha(theme.palette.grey[400], lifted ? light.near.lifted : light.near.rest),
          alpha(theme.palette.common.white, lifted ? light.far.lifted : light.far.rest),
        ];

  return shadowListCss(neumorphicShadows(lifted, near, far));
};

const sectionBackground = (theme: Theme, lifted: boolean): string => {
  const wash = CARD_SECTION_BACKGROUND[theme.palette.mode === 'dark' ? 'dark' : 'light'];
  return lifted ? wash.lifted : wash.rest;
};

const glowShadow = (theme: Theme, lifted: boolean): string => {
  const { blurRadius, alpha: opacity } = lifted ? CARD_GLOW.lifted : CARD_GLOW.rest;
  return shadowCss({
    offsetX: 0,
    offsetY: 0,
    blurRadius,
    spreadDistance: 0,
    color: alpha(theme.palette.primary.main, opacity),
  });
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
    surface: { elevation: CARD_ELEVATION.rest } as CSSObject,
    hover: { elevation: lifted ? CARD_ELEVATION.lifted : CARD_ELEVATION.rest } as CSSObject,
  }),
  outlined: (theme, lifted) => ({
    surface: {
      border: `${CARD_BORDER_WIDTH}px solid ${theme.palette.divider}`,
      boxShadow: 'none',
    },
    hover: { borderColor: lifted ? theme.palette.primary.main : theme.palette.divider },
  }),
  glass: (theme, lifted) => ({
    surface: {
      backgroundColor: alpha(theme.palette.background.paper, CARD_GLASS.backgroundAlpha.rest),
      backdropFilter: `blur(${CARD_GLASS.blurPx}px)`,
      border: `${CARD_BORDER_WIDTH}px solid ${alpha(theme.palette.primary.main, CARD_GLASS.borderAlpha.rest)}`,
      boxShadow: shadowCss({
        offsetX: 0,
        offsetY: CARD_GLASS.shadow.offsetY,
        blurRadius: CARD_GLASS.shadow.blurRadius,
        spreadDistance: 0,
        color: alpha(theme.palette.common.black, CARD_GLASS.shadow.alpha),
      }),
    },
    hover: {
      backgroundColor: alpha(
        theme.palette.background.paper,
        lifted ? CARD_GLASS.backgroundAlpha.lifted : CARD_GLASS.backgroundAlpha.rest,
      ),
      border: `${CARD_BORDER_WIDTH}px solid ${alpha(theme.palette.primary.main, CARD_GLASS.borderAlpha.lifted)}`,
    },
  }),
  gradient: (theme, lifted) => ({
    surface: {
      background: cardGradient(theme, false),
      color: theme.palette.primary.contrastText,
      boxShadow: shadowCss({
        offsetX: 0,
        offsetY: CARD_GRADIENT.shadow.offsetY,
        blurRadius: CARD_GRADIENT.shadow.blurRadius,
        spreadDistance: 0,
        color: alpha(theme.palette.primary.main, CARD_GRADIENT.shadow.alpha),
      }),
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
    ? `linear-gradient(${CARD_GRADIENT.angleDeg}deg, ${theme.palette.primary.dark}, ${theme.palette.secondary.dark})`
    : `linear-gradient(${CARD_GRADIENT.angleDeg}deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`;

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
    ...(glow && { boxShadow: glowShadow(theme, false) }),
    ...(pulse && pulseSurface(theme)),
    ...chosen.surface,
    '&:hover': {
      ...(interactive && { transform: `translateY(-${CARD_INTERACTIVE_LIFT}px)` }),
      ...(glow && { boxShadow: glowShadow(theme, true) }),
      ...chosen.hover,
    },
  };
};
