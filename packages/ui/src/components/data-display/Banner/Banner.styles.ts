import { alpha, keyframes } from '@mui/material/styles/index.js';
import type { CSSObject, PaletteColor, Theme } from '@mui/material/styles/index.js';

import type { BannerVariant } from './Banner.types';
import { ACTIVE, HOVER } from '../Alert/Alert.metrics';

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

    // Opacity and a wash only: the dismiss used to spin 90deg, which drew the
    // eye to the way out rather than to the message. Same fix as `Alert`'s
    // close button, which is the sibling surface (FUT-1458).
    '&:hover': {
      opacity: 1,
      backgroundColor: alpha(colorPalette.main, 0.1),
    },

    '&:focus-visible': {
      opacity: 1,
      outline: `2px solid ${colorPalette.main}`,
      outlineOffset: '2px',
    },
  },
});

/**
 * The pointer states, from `Alert`'s own table.
 *
 * Banner had NO hover at all — measured ΔE76 0.00 on every variant in both
 * modes — so moving between the two surfaces gave feedback on one and silence
 * on the other. They are the same kind of thing and now answer a pointer the
 * same way.
 *
 * Neither block may declare `transition`: `:active` under a mouse always
 * implies `:hover`, so a shorthand here would outrank the root's and reset the
 * opacity fade the press is built on.
 */
/** The same flat inset tint `Alert` paints; see `ACTIVE` for why it is a layer. */
const tint = (theme: Theme, a: number): string =>
  `inset 0 0 0 100vmax ${alpha(theme.palette.mode === 'light' ? '#000000' : '#ffffff', a)}`;

export const bannerPointerStates = (theme: Theme): CSSObject => ({
  '&:hover': {
    boxShadow: tint(theme, HOVER.tintAlpha),
  },

  // The `:not(:has(…))` names CONTROLS, not any descendant: `:active` matches
  // an ancestor of whatever is pressed, so without it pressing the dismiss or
  // an action dimmed the message that owns it. Excluding `:has(:active)`
  // wholesale does not work — pressing the TEXT makes that text `:active` too,
  // so the guard matched on every press and the state never fired.
  '&:active:not(:has(button:active, a:active, [role="button"]:active))': {
    boxShadow: tint(theme, ACTIVE.tintAlpha),
    transition: 'none',
  },
});

/** The seconds the tint takes easing back, shared with `Alert`. */
export const BANNER_TINT_S = ACTIVE.ms / 1000;
