import { alpha } from '@mui/material/styles/index.js';
import type { CSSObject, Theme } from '@mui/material/styles/index.js';

import {
  pulseAnimation,
  scaleIn,
  slideInDown,
  slideInLeft,
  slideInRight,
  slideInUp,
} from './HoverCard.animations';
import type { HoverCardAnimation, HoverCardPlacement } from './HoverCard.types';
import { shadowInk } from '../../../tokens/ink';
import { rem, rems } from '../../../tokens/relative';

/** The edge the card sits on, ignoring the `-start`/`-end` alignment suffix. */
type Side = 'top' | 'bottom' | 'left' | 'right';

export const sideOf = (placement: HoverCardPlacement): Side => {
  if (placement.startsWith('top')) return 'top';
  if (placement.startsWith('left')) return 'left';
  if (placement.startsWith('right')) return 'right';
  return 'bottom';
};

/** The arrow's size, 8 design px, through the theme's type scale. */
const arrowSize = (theme: Theme): string => rem(theme, 8);

/**
 * The arrow is a CSS triangle: two transparent borders on the cross axis and one
 * filled border pointing back at the anchor. Every placement is that same shape,
 * so the table holds only which edge is filled and where the triangle sits.
 */
const ARROWS: Record<Side, (size: string, color: string) => CSSObject> = {
  top: (size, color) => ({
    bottom: `-${size}`,
    left: '50%',
    transform: 'translateX(-50%)',
    borderLeft: `${size} solid transparent`,
    borderRight: `${size} solid transparent`,
    borderTop: `${size} solid ${color}`,
  }),
  bottom: (size, color) => ({
    top: `-${size}`,
    left: '50%',
    transform: 'translateX(-50%)',
    borderLeft: `${size} solid transparent`,
    borderRight: `${size} solid transparent`,
    borderBottom: `${size} solid ${color}`,
  }),
  left: (size, color) => ({
    right: `-${size}`,
    top: '50%',
    transform: 'translateY(-50%)',
    borderTop: `${size} solid transparent`,
    borderBottom: `${size} solid transparent`,
    borderLeft: `${size} solid ${color}`,
  }),
  right: (size, color) => ({
    left: `-${size}`,
    top: '50%',
    transform: 'translateY(-50%)',
    borderTop: `${size} solid transparent`,
    borderBottom: `${size} solid transparent`,
    borderRight: `${size} solid ${color}`,
  }),
};

export const arrowSx = (theme: Theme, placement: HoverCardPlacement): CSSObject => ({
  position: 'absolute',
  width: 0,
  height: 0,
  zIndex: 1,
  ...ARROWS[sideOf(placement)](arrowSize(theme), theme.palette.background.paper),
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

const ANIMATIONS: Record<string, (theme: Theme) => CSSObject> = {
  // `fade` shares slideInUp deliberately: the keyframes fade in while rising.
  fade: (theme) => ({ animation: `${slideInUp(theme)} 0.2s ease-out` }),
  scale: () => ({ transformOrigin: 'center', animation: `${scaleIn} 0.2s cubic-bezier(0.4, 0, 0.2, 1)` }),
  'slide-up': (theme) => ({ animation: `${slideInUp(theme)} 0.3s cubic-bezier(0.4, 0, 0.2, 1)` }),
  'slide-down': (theme) => ({ animation: `${slideInDown(theme)} 0.3s cubic-bezier(0.4, 0, 0.2, 1)` }),
  'slide-left': (theme) => ({ animation: `${slideInLeft(theme)} 0.3s cubic-bezier(0.4, 0, 0.2, 1)` }),
  'slide-right': (theme) => ({ animation: `${slideInRight(theme)} 0.3s cubic-bezier(0.4, 0, 0.2, 1)` }),
};

const VARIANTS: Record<string, (theme: Theme) => CSSObject> = {
  default: (theme) => ({
    backgroundColor: theme.palette.background.paper,
    border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
    boxShadow: theme.shadows[8],
  }),
  glass: (theme) => ({
    backgroundColor: alpha(theme.palette.background.paper, 0.85),
    backdropFilter: `blur(${rem(theme, 20)})`,
    WebkitBackdropFilter: `blur(${rem(theme, 20)})`,
    border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
    boxShadow: `${rems(theme, 0, 8, 32)} ${shadowInk(theme, 0.12)}`,
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
  boxShadow: `${rems(theme, 0, 0, 20, 5)} ${alpha(theme.palette.primary.main, 0.3)} !important`,
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
    animation: `${pulseAnimation(theme)} 2s infinite`,
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
    minWidth: rem(theme, 200),
    maxWidth: rem(theme, 400),
    ...(animation ? (ANIMATIONS[animation]?.(theme) ?? {}) : {}),
    ...(customVariant ? (VARIANTS[customVariant]?.(theme) ?? {}) : {}),
    // The old "both" arm was exactly these two spread together.
    ...(glow && glowStyles(theme)),
    ...(pulse && pulseStyles(theme)),
  };
};
