import Error from '@mui/icons-material/Error';
import Info from '@mui/icons-material/Info';
import CheckCircle from '@mui/icons-material/CheckCircle';
import Warning from '@mui/icons-material/Warning';
import { alpha, darken, keyframes, lighten } from '@mui/material';
import type { CSSObject, Theme } from '@mui/material';
import React from 'react';

export const pulseAnimation = keyframes`
  0% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 1;
  }
  70% {
    box-shadow: 0 0 0 10px currentColor;
    opacity: 0;
  }
  100% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 0;
  }
`;

// Additional animations can be enabled as needed
// const slideInAnimation = keyframes`
//   from {
//     transform: translateX(-100%);
//     opacity: 0;
//   }
//   to {
//     transform: translateX(0);
//     opacity: 1;
//   }
// `;

// const bounceIn = keyframes`
//   0% {
//     transform: scale(0.3);
//     opacity: 0;
//   }
//   50% {
//     transform: scale(1.05);
//   }
//   70% {
//     transform: scale(0.9);
//   }
//   100% {
//     transform: scale(1);
//     opacity: 1;
//   }
// `;

// Removed unused slideInAnimation - can be re-added if needed for future features

export const shimmerAnimation = keyframes`
  0% {
    background-position: -1000px 0;
  }
  100% {
    background-position: 1000px 0;
  }
`;

export const fadeInScale = keyframes`
  from {
    opacity: 0;
    transform: scale(0.95) translateY(-10px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
`;

export const iconRotate = keyframes`
  0% {
    transform: rotate(0deg) scale(0.8);
  }
  50% {
    transform: rotate(180deg) scale(1.1);
  }
  100% {
    transform: rotate(360deg) scale(1);
  }
`;

export const getColorFromTheme = (theme: Theme, variant: string) => {
  const colorMap: Record<string, { main: string; light?: string; dark?: string }> = {
    info: theme.palette.info,
    success: theme.palette.success,
    warning: theme.palette.warning,
    danger: theme.palette.error,
    primary: theme.palette.primary,
    secondary: theme.palette.secondary,
    neutral: {
      main: theme.palette.grey[500] || '#9E9E9E',
      light: theme.palette.grey[300] || '#E0E0E0',
      dark: theme.palette.grey[700] || '#616161',
    },
  };

  return colorMap[variant] || theme.palette.info;
};

export const getVariantIcon = (variant: string) => {
  const iconMap: Record<string, React.ReactNode> = {
    info: <Info />,
    success: <CheckCircle />,
    warning: <Warning />,
    danger: <Error />,
  };

  return iconMap[variant];
};

// The palette shape getColorFromTheme returns — a main plus optional light/dark,
// which is narrower than MUI's PaletteColor.
export type AlertPalette = { main: string; light?: string; dark?: string };

/** The four semantic variants, which differ only in which palette they read. */
const SEMANTIC_VARIANTS = new Set(['info', 'success', 'warning', 'danger']);

/**
 * The room the message is given — padding, the stack's rhythm, and where the
 * icon and the close button sit relative to it.
 *
 * Extracted for the same reason {@link alertVariantStyles} and
 * {@link alertEmphasisStyles} were: `styled()`'s callback is one function, and
 * every block written inline is counted against its length by the complexity
 * gate. Keeping the layout here means the callback assembles four named pieces
 * instead of carrying all of them.
 */
export const alertLayoutStyles = (
  theme: Theme,
  colorPalette: AlertPalette,
  animate: boolean | undefined,
): CSSObject => ({
  // ROOM TO READ.
  //
  // MUI's `6px 16px` is sized for one line of text and nothing else. This Alert
  // routinely carries three things stacked — a sentence, a smaller explanation,
  // then a control — and at 6px they touched top and bottom and ran together
  // vertically, so the whole card read as one dense block instead of as a
  // message with parts. The generosity is what makes the structure legible; it
  // is not decoration.
  //
  // Padding stays overridable by an `sx` (a full-bleed strip legitimately wants
  // it tight), because this is a default rather than a rule.
  padding: theme.spacing(1.75, 2),

  '.MuiAlert-message': {
    display: 'flex',
    flexDirection: 'column',
    // 0.5 put a title, its explanation and a button 4px apart, which reads as a
    // spacing bug rather than as a group. 1 separates the lines; the extra
    // margin below goes to whatever CONTROL sits at the end, because the gap
    // between prose and a thing you press has to be bigger than the gap between
    // two lines of prose or the button looks like part of the text.
    gap: theme.spacing(1),
    fontSize: '0.95rem',
    lineHeight: 1.5,
    // No padding of its own — the root's is now doing that job, and MUI's
    // default `8px 0` on top of it would double the vertical space.
    padding: 0,
    // A CONTROL ON A TINTED PANEL NEEDS AN EDGE.
    //
    // `ghost` and `text` paint no background and no border — bare labels, which
    // works on white where the surrounding page is obviously not clickable.
    // Inside a coloured Alert it stops working: the label is one more coloured
    // phrase among several, and a "Cancelar" beside two lines of prose reads as
    // part of the prose.
    //
    // Only the BORDER is set, never the background or the colour, and that is
    // what makes it safe to apply to every button rather than just the bare
    // ones: a `solid` keeps its fill and its light label and gains a hairline
    // in the same hue, while a `ghost` gains the whole affordance.
    '.MuiButton-root': {
      marginTop: theme.spacing(0.5),
      border: `1px solid ${alpha(colorPalette.main, 0.45)}` },
  },

  '.MuiAlert-icon': {
    transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    alignItems: 'center',
    // Clear of the words rather than nearly touching them, and aligned to the
    // FIRST line instead of centred on the whole block — an icon floating
    // halfway down a three-line message points at nothing.
    alignSelf: 'flex-start',
    marginRight: theme.spacing(1.75),
    paddingTop: theme.spacing(0.25),
    animation: animate ? `${iconRotate} 0.6s ease-out` : 'none' },

  // The close button, kept off the text it sits beside.
  '.MuiAlert-action': {
    alignItems: 'flex-start',
    paddingLeft: theme.spacing(2) },
});

/**
 * A semantic Alert's surface and ink.
 *
 * ## Why this is not `alpha(main, 0.1)`
 *
 * It used to be, four times over, with `color: main` for the text. Both halves
 * were wrong, and independently so.
 *
 * The fill was TRANSLUCENT. A 10% wash only reads as a banner when something
 * opaque is behind it, so the component silently depended on where a consumer
 * put it. Placed over content — a floating notice, an invite anchored above a
 * catalogue — the page came straight through and the sentence interleaved with
 * whatever it was over. That is not a faint banner; it is an unreadable one,
 * and nothing in the component said so.
 *
 * The ink was the SEVERITY HUE at body size. `#0288d1`, this library's info
 * blue, is 3.03:1 on white — under the 4.5:1 WCAG AA floor before any wash is
 * involved. So the text failed on a plain white page too, where the fill was
 * behaving exactly as intended.
 *
 * ## Why `lighten`/`darken` rather than a hand-picked pair
 *
 * These are the same transforms MUI's own `standard` Alert uses, at the same
 * ratios — the recipe this component overrode. Reusing it means an OPAQUE tint
 * with a dark ink of the same hue, contrast that holds on any surface because
 * it no longer depends on one, and a pairing already proven across MUI's
 * palette rather than eyeballed here. Both modes are handled: on a dark theme
 * the tint darkens and the ink lightens, which an alpha wash could never do
 * because it carries the seed's own lightness through unchanged.
 *
 * The border keeps an alpha — it is a hairline over the tint it belongs to, so
 * translucency there costs nothing and lets the edge follow the fill.
 */
const semanticSurface = (theme: Theme, colorPalette: AlertPalette): CSSObject => {
  const dark = theme.palette.mode === 'dark';
  return {
    backgroundColor: dark ? darken(colorPalette.main, 0.8) : lighten(colorPalette.main, 0.9),
    color: dark ? lighten(colorPalette.main, 0.6) : darken(colorPalette.main, 0.6),
    border: `1px solid ${alpha(colorPalette.main, 0.35)}`,
    '.MuiAlert-icon': {
      color: colorPalette.main,
    },
  };
};

// The six visual variants. Each block is spread in only when it matches, which
// is how the original inline version read; keeping that shape here means the
// styled() callback carries one branch instead of six. The four semantics were
// four IDENTICAL copies of the same block — they now share one, so the next
// change to a banner's surface cannot land on three of them.
export const alertVariantStyles = (
  theme: Theme,
  customVariant: string | undefined,
  colorPalette: AlertPalette,
): CSSObject => ({
...(customVariant !== undefined &&
  SEMANTIC_VARIANTS.has(customVariant) &&
  semanticSurface(theme, colorPalette)),

...(customVariant === 'glass' && {
  // 85%, not 10%. This is the variant that is MEANT to be see-through, and it
  // was the same mistake in a costume: at 0.1 the blur had almost nothing to
  // sit on, so `glass` was not frosted, it was a window. A frosted pane has to
  // be mostly pane — the backdrop should be legible AS texture behind the
  // text, never as competition with it.
  backgroundColor: alpha(theme.palette.background.paper, 0.85),
  backdropFilter: 'blur(20px) saturate(180%)',
  WebkitBackdropFilter: 'blur(20px) saturate(180%)',
  border: `1px solid ${alpha(theme.palette.divider, 0.4)}`,
  color: theme.palette.text.primary,
  '.MuiAlert-icon': {
    color: theme.palette.primary.main,
  },
  // Safari before 18 and Firefox with the filter disabled paint the declared
  // alpha with nothing blurred behind it — the see-through banner this is
  // fixing. There is no degraded frost to fall back to, so it falls back to an
  // opaque pane: less pretty, still readable.
  '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))': {
    backgroundColor: theme.palette.background.paper,
  },
}),

...(customVariant === 'gradient' && {
  background: `linear-gradient(135deg, ${alpha(colorPalette.light || colorPalette.main, 0.9)}, ${alpha(colorPalette.dark || colorPalette.main, 0.9)})`,
  color: theme.palette.getContrastText(colorPalette.main),
  border: 'none',
  position: 'relative',
  overflow: 'hidden',
  '.MuiAlert-icon': {
    color: theme.palette.getContrastText(colorPalette.main),
  },
  '&::before': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: '-1000px',
    width: '100%',
    height: '100%',
    background: `linear-gradient(90deg, transparent, ${alpha(theme.palette.common.white, 0.2)}, transparent)`,
    animation: `${shimmerAnimation} 3s infinite`,
  },
  '&:hover': {
    filter: 'brightness(1.1)',
    transform: 'translateY(-2px) scale(1.01)',
  },
}),
});

// glow and pulse combine into three distinct looks, so the combinations are
// spelled out rather than layered — layering them would let the glow-only shadow
// leak into the glow+pulse case.
export const alertEmphasisStyles = (
  colorPalette: AlertPalette,
  glow: boolean,
  pulse: boolean,
): CSSObject => ({
...(glow &&
  !pulse && {
    boxShadow: `0 0 20px 5px ${alpha(colorPalette.main, 0.3)} !important`,
    filter: 'brightness(1.05)',
  }),

// Pulse animation
...(pulse &&
  !glow && {
    position: 'relative',
    '&::after': {
      content: '""',
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      borderRadius: 'inherit',
      backgroundColor: colorPalette.main,
      opacity: 0.2,
      animation: `${pulseAnimation} 2s infinite`,
      pointerEvents: 'none',
      zIndex: -1,
    },
  }),

// Both glow and pulse
...(glow &&
  pulse && {
    position: 'relative',
    boxShadow: `0 0 20px 5px ${alpha(colorPalette.main, 0.3)} !important`,
    filter: 'brightness(1.05)',
    '&::after': {
      content: '""',
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      borderRadius: 'inherit',
      backgroundColor: colorPalette.main,
      opacity: 0.2,
      animation: `${pulseAnimation} 2s infinite`,
      pointerEvents: 'none',
      zIndex: -1,
    },
  }),
});
