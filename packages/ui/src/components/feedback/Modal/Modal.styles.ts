import { alpha, keyframes } from '@mui/material/styles/index.js';
import type { CSSObject, Theme } from '@mui/material/styles/index.js';

import { scrim, shadowInk } from '../../../tokens/ink';
import { rem, rems } from '../../../tokens/relative';

import type { ModalProps } from './Modal.types';

type Variant = NonNullable<ModalProps['variant']>;
type Size = NonNullable<ModalProps['size']>;
type Radius = NonNullable<ModalProps['borderRadius']>;

const pulseAnimation = (theme: Theme) => keyframes`
  0% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 1;
  }
  70% {
    box-shadow: 0 0 0 ${rem(theme, 20)} currentColor;
    opacity: 0;
  }
  100% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 0;
  }
`;

const RADII: Record<Radius, (theme: Theme) => number | string> = {
  none: () => 0,
  sm: (theme) => theme.spacing(0.5),
  md: (theme) => theme.spacing(1),
  lg: (theme) => theme.spacing(2),
  xl: (theme) => theme.spacing(3),
};

/** Every preset is capped at 90vw so the panel never overflows a small screen. */
const WIDTHS: Record<Size, number> = { xs: 320, sm: 480, md: 640, lg: 800, xl: 960 };

/**
 * Where the panel sits. Top and bottom are the same layout anchored to opposite
 * edges; centre is the only one that offsets on both axes.
 */
const PLACEMENTS: Record<string, CSSObject> = {
  top: { top: '10%', left: '50%', transform: 'translateX(-50%)', maxHeight: '80vh' },
  bottom: { bottom: '10%', left: '50%', transform: 'translateX(-50%)', maxHeight: '80vh' },
  center: {
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    maxHeight: '90vh',
  },
};

interface ModalStyleFlags {
  variant: Variant;
  size: Size;
  borderRadius: Radius;
  glass: boolean;
  gradient: boolean;
  glow: boolean;
  pulse: boolean;
}

/** The ring that expands out of the panel while `pulse` is set. */
const pulseRing = (theme: Theme): CSSObject => ({
  content: '""',
  position: 'absolute' as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  borderRadius: 'inherit',
  backgroundColor: theme.palette.primary.main,
  opacity: 0.3,
  animation: `${pulseAnimation(theme)} 2s infinite`,
  pointerEvents: 'none' as const,
  zIndex: -1,
});

/** The surface: its fill, its blur and the shadow that lifts it off the backdrop. */
const surface = (theme: Theme, flags: ModalStyleFlags): CSSObject => {
  const { variant, glass, gradient, glow } = flags;
  // The glass variant is the glass flag by another name, so either turns it on.
  const isGlass = glass || variant === 'glass';

  const boxShadow = glow
    ? `${rems(theme, 0, 0, 40)} ${alpha(theme.palette.primary.main, 0.3)}`
    : isGlass
      ? `${rems(theme, 0, 8, 32)} ${shadowInk(theme, 0.1)}`
      : theme.shadows[8];

  return {
    backgroundColor: isGlass
      ? alpha(theme.palette.background.paper, 0.1)
      : theme.palette.background.paper,
    backdropFilter: isGlass ? `blur(${rem(theme, 20)})` : gradient ? `blur(${rem(theme, 10)})` : 'none',
    border: isGlass ? `1px solid ${alpha(theme.palette.primary.main, 0.2)}` : 'none',
    boxShadow,
    ...(gradient && {
      background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)}, ${alpha(theme.palette.secondary.main, 0.1)})`,
    }),
  };
};

export const panelSx = (theme: Theme, flags: ModalStyleFlags): CSSObject => {
  const { variant, size, borderRadius, pulse } = flags;

  return {
    // A pulsing panel positions its own ring, so it becomes the containing block.
    position: pulse ? ('relative' as const) : ('absolute' as const),
    width: rem(theme, WIDTHS[size] ?? WIDTHS.md),
    maxWidth: '90vw',
    borderRadius: (RADII[borderRadius] ?? RADII.lg)(theme),
    outline: 0,
    overflowY: 'auto',
    transition: theme.transitions.create(
      ['box-shadow', 'background-color', 'backdrop-filter', 'transform'],
      { duration: theme.transitions.duration.standard },
    ),
    ...(PLACEMENTS[variant] ?? PLACEMENTS.center),
    ...surface(theme, flags),
    ...(pulse && { '&::after': pulseRing(theme) }),
  };
};

export const backdropSx = (theme: Theme, isGlass: boolean): CSSObject => ({
  backgroundColor: scrim(theme, isGlass ? 0.2 : 0.5),
  backdropFilter: isGlass ? `blur(${rem(theme, 8)})` : 'none',
});
