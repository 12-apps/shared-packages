import { alpha, keyframes } from '@mui/material/styles/index.js';
import type { CSSObject, PaletteColor, Theme } from '@mui/material/styles/index.js';

import type { BannerVariant } from './Banner.types';
import { pointerInkStyles } from '../Alert/Alert.ink';
import { ACTIVE, HOVER, SEMANTIC_SURFACE } from '../Alert/Alert.metrics';
import { darken, lighten } from '../../../tokens/color';
import { modeInk } from '../../../tokens/ink';
import { rem } from '../../../tokens/relative';

// Animations
export const fadeInSlide = (theme: Theme) => keyframes`
  from {
    opacity: 0;
    transform: translateY(${rem(theme, -10)});
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

const pulseAnimation = (theme: Theme) => keyframes`
  0% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 0.7;
  }
  70% {
    box-shadow: 0 0 0 ${rem(theme, 8)} currentColor;
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

/**
 * The ink the words are painted in (FUT-4519): the variant's hue pulled toward
 * the mode's absolute by the same amount the Alert's semantic ink is. The hue
 * itself is the ICON's colour; as text it was 2.5:1 to 3.8:1 on its own wash.
 */
export const bannerInk = (theme: Theme, main: string): string =>
  theme.palette.mode === 'dark' ? lighten(main, SEMANTIC_SURFACE.ink) : darken(main, SEMANTIC_SURFACE.ink);

/** The class `Banner` wraps its `children` in, at `display: contents`, so they can step with the words. */
export const BANNER_CHILDREN_CLASS = 'banner-children';

/** What steps under a pointer: the title, the message and the children, none nested in another. */
const BANNER_WORDS = `& .banner-title, & .banner-description, & .${BANNER_CHILDREN_CLASS}`;

/** The dismiss button: opacity and a wash only, no spin. */
const bannerDismissStyles = (theme: Theme, colorPalette: PaletteColor): CSSObject => ({
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
    outline: `${rem(theme, 2)} solid ${colorPalette.main}`,
    outlineOffset: rem(theme, 2),
  },
});

export const bannerPartStyles = (theme: Theme, colorPalette: PaletteColor): CSSObject => ({
  // Icon container
  '.banner-icon': {
    flexShrink: 0,
    marginTop: theme.spacing(0.25),
    color: colorPalette.main,
    fontSize: rem(theme, 20),
    display: 'flex',
    alignItems: 'center',
    position: 'relative',

    '&::before': {
      content: '""',
      position: 'absolute',
      inset: rem(theme, -4),
      borderRadius: '50%',
      background: alpha(colorPalette.main, 0.1),
      animation: `${pulseAnimation(theme)} 3s infinite`,
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
    fontSize: rem(theme, 16),
    lineHeight: 1.4,
    marginBottom: theme.spacing(0.5),
    // The root's ink, not `dark`: the pointer step mixes `currentColor`, and
    // `dark` was 3.5:1 on dark mode's wash.
    color: 'inherit',
  },

  // Description styles
  '.banner-description': {
    fontSize: rem(theme, 14),
    lineHeight: 1.5,
    opacity: 0.9,
    color: 'inherit',
  },

  // `display: contents`: no box of its own, so the layout is what it was.
  [`.${BANNER_CHILDREN_CLASS}`]: {
    display: 'contents',
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

  '.banner-dismiss': bannerDismissStyles(theme, colorPalette),
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
  `inset 0 0 0 100vmax ${alpha(modeInk(theme), a)}`;

export const bannerPointerStates = (theme: Theme): CSSObject => {
  // The tint moves the surface toward the ink's side; the words step the same
  // way, by the Alert's own table (FUT-4519, as FUT-4506 did for the Alert).
  const ink = pointerInkStyles(theme, undefined, BANNER_WORDS);
  return {
    ...ink.rest,

    '&:hover': {
      boxShadow: tint(theme, HOVER.tintAlpha),
      ...ink.hover,
    },

  // The `:not(:has(…))` names CONTROLS, not any descendant: `:active` matches
  // an ancestor of whatever is pressed, so without it pressing the dismiss or
  // an action dimmed the message that owns it. Excluding `:has(:active)`
  // wholesale does not work — pressing the TEXT makes that text `:active` too,
  // so the guard matched on every press and the state never fired.
    '&:active:not(:has(button:active, a:active, [role="button"]:active))': {
      boxShadow: tint(theme, ACTIVE.tintAlpha),
      transition: 'none',
      ...ink.press,
    },
  };
};

/** The seconds the tint takes easing back, shared with `Alert`. */
export const BANNER_TINT_S = ACTIVE.ms / 1000;
