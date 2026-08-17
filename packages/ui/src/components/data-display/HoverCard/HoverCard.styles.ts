import { alpha } from '@mui/material';
import type { CSSObject, Theme } from '@mui/material';

import {
  pulseAnimation,
  scaleIn,
  slideInDown,
  slideInLeft,
  slideInRight,
  slideInUp,
} from './HoverCard.animations';
import type { HoverCardAnimation, HoverCardPlacement } from './HoverCard.types';

/** The edge the card sits on, ignoring the `-start`/`-end` alignment suffix. */
type Side = 'top' | 'bottom' | 'left' | 'right';

export const sideOf = (placement: HoverCardPlacement): Side => {
  if (placement.startsWith('top')) return 'top';
  if (placement.startsWith('left')) return 'left';
  if (placement.startsWith('right')) return 'right';
  return 'bottom';
};

const ARROW_SIZE = 8;

/**
 * The arrow is a CSS triangle: two transparent borders on the cross axis and one
 * filled border pointing back at the anchor. Every placement is that same shape,
 * so the table holds only which edge is filled and where the triangle sits.
 */
const ARROWS: Record<Side, (color: string) => CSSObject> = {
  top: (color) => ({
    bottom: -ARROW_SIZE,
    left: '50%',
    transform: 'translateX(-50%)',
    borderLeft: `${ARROW_SIZE}px solid transparent`,
    borderRight: `${ARROW_SIZE}px solid transparent`,
    borderTop: `${ARROW_SIZE}px solid ${color}`,
  }),
  bottom: (color) => ({
    top: -ARROW_SIZE,
    left: '50%',
    transform: 'translateX(-50%)',
    borderLeft: `${ARROW_SIZE}px solid transparent`,
    borderRight: `${ARROW_SIZE}px solid transparent`,
    borderBottom: `${ARROW_SIZE}px solid ${color}`,
  }),
  left: (color) => ({
    right: -ARROW_SIZE,
    top: '50%',
    transform: 'translateY(-50%)',
    borderTop: `${ARROW_SIZE}px solid transparent`,
    borderBottom: `${ARROW_SIZE}px solid transparent`,
    borderLeft: `${ARROW_SIZE}px solid ${color}`,
  }),
  right: (color) => ({
    left: -ARROW_SIZE,
    top: '50%',
    transform: 'translateY(-50%)',
    borderTop: `${ARROW_SIZE}px solid transparent`,
    borderBottom: `${ARROW_SIZE}px solid transparent`,
    borderRight: `${ARROW_SIZE}px solid ${color}`,
  }),
};

export const arrowSx = (theme: Theme, placement: HoverCardPlacement): CSSObject => ({
  position: 'absolute',
  width: 0,
  height: 0,
  zIndex: 1,
  ...ARROWS[sideOf(placement)](theme.palette.background.paper),
});

type Origin = { vertical: 'top' | 'center' | 'bottom'; horizontal: 'left' | 'center' | 'right' };

/** Where the popover attaches to the anchor, per side. */
const ANCHOR_ORIGINS: Record<Side, Origin> = {
  top: { vertical: 'top', horizontal: 'center' },
  bottom: { vertical: 'bottom', horizontal: 'center' },
  left: { vertical: 'center', horizontal: 'left' },
  right: { vertical: 'center', horizontal: 'right' },
};

/** The card's own corner meets the anchor's, so its origin is the opposite one. */
const flip = (origin: Origin): Origin => ({
  vertical: origin.vertical === 'top' ? 'bottom' : origin.vertical === 'bottom' ? 'top' : 'center',
  horizontal:
    origin.horizontal === 'left' ? 'right' : origin.horizontal === 'right' ? 'left' : 'center',
});

export const getAnchorOrigin = (placement: HoverCardPlacement): Origin =>
  ANCHOR_ORIGINS[sideOf(placement)];

export const getTransformOrigin = (placement: HoverCardPlacement): Origin =>
  flip(ANCHOR_ORIGINS[sideOf(placement)]);

const ANIMATIONS: Record<string, CSSObject> = {
  // `fade` shares slideInUp deliberately: the keyframes fade in while rising.
  fade: { animation: `${slideInUp} 0.2s ease-out` },
  scale: { transformOrigin: 'center', animation: `${scaleIn} 0.2s cubic-bezier(0.4, 0, 0.2, 1)` },
  'slide-up': { animation: `${slideInUp} 0.3s cubic-bezier(0.4, 0, 0.2, 1)` },
  'slide-down': { animation: `${slideInDown} 0.3s cubic-bezier(0.4, 0, 0.2, 1)` },
  'slide-left': { animation: `${slideInLeft} 0.3s cubic-bezier(0.4, 0, 0.2, 1)` },
  'slide-right': { animation: `${slideInRight} 0.3s cubic-bezier(0.4, 0, 0.2, 1)` },
};

const VARIANTS: Record<string, (theme: Theme) => CSSObject> = {
  default: (theme) => ({
    backgroundColor: theme.palette.background.paper,
    border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
    boxShadow: theme.shadows[8],
  }),
  glass: (theme) => ({
    backgroundColor: alpha(theme.palette.background.paper, 0.85),
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
    boxShadow: `0 8px 32px ${alpha(theme.palette.common.black, 0.12)}`,
  }),
  detailed: (theme) => ({
    backgroundColor: theme.palette.background.paper,
    border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
    boxShadow: theme.shadows[12],
  }),
  minimal: (theme) => ({
    backgroundColor: theme.palette.background.paper,
    border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
    boxShadow: theme.shadows[4],
  }),
};

const glowStyles = (theme: Theme): CSSObject => ({
  boxShadow: `0 0 20px 5px ${alpha(theme.palette.primary.main, 0.3)} !important`,
  filter: 'brightness(1.05)',
});

const pulseStyles = (theme: Theme): CSSObject => ({
  position: 'relative',
  '&::after': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 'inherit',
    backgroundColor: theme.palette.primary.main,
    opacity: 0.1,
    animation: `${pulseAnimation} 2s infinite`,
    pointerEvents: 'none',
    zIndex: -1,
  },
});

export interface CardStyleFlags {
  customVariant?: string;
  glow?: boolean;
  pulse?: boolean;
  animation?: HoverCardAnimation;
}

export const cardSx = (theme: Theme, flags: CardStyleFlags): CSSObject => {
  const { customVariant, glow, pulse, animation } = flags;

  return {
    borderRadius: theme.spacing(1.5),
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    position: 'relative',
    overflow: 'visible',
    minWidth: 200,
    maxWidth: 400,
    ...(animation ? (ANIMATIONS[animation] ?? {}) : {}),
    ...(customVariant ? (VARIANTS[customVariant]?.(theme) ?? {}) : {}),
    // The old "both" arm was exactly these two spread together.
    ...(glow && glowStyles(theme)),
    ...(pulse && pulseStyles(theme)),
  };
};
