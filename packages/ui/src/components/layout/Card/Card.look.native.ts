import type { ViewStyle } from 'react-native';

import type { CardBorderRadius, CardVariant } from './Card.base';
import {
  CARD_BORDER_WIDTH,
  CARD_GLASS,
  CARD_GLOW,
  CARD_GRADIENT,
  CARD_LOADING,
  CARD_NEUMORPHIC,
  CARD_PAPER_SHADOW,
  CARD_RADIUS_FULL,
  CARD_RADIUS_UNITS,
  CARD_SECTION_BACKGROUND,
  neumorphicShadows,
} from './Card.metrics';
import { alpha } from '../../../tokens/color';
import type { UiShadow } from '../../../tokens/shadow';
import type { UiTheme } from '../../../tokens/theme';

/**
 * WHAT THE NATIVE `Card` PAINTS — the arithmetic, with no JSX in sight.
 *
 * The web builds one `sx` object by spreading base, `interactive`, `glow`,
 * `pulse` and finally the variant's own surface over each other; whichever
 * wrote a property last wins. The composition here spreads the SAME things in
 * the SAME order, which is why `glow` shows through an `elevated` card (whose
 * surface declares no shadow) and is buried by a `glass` one (whose surface
 * does) on both renderers.
 */

/**
 * MUI's `palette.common`, which `UiTheme` has no slot for: the neumorphic and
 * glass shadows are mixed from these two and nothing else reads them.
 */
const BLACK = '#000';
const WHITE = '#fff';

/** The named radius as a length. `full` stays a percentage of the box. */
export function cardRadius(theme: UiTheme, radius: CardBorderRadius): number | string {
  if (radius === 'full') return CARD_RADIUS_FULL;
  return theme.spacing(CARD_RADIUS_UNITS[radius] ?? CARD_RADIUS_UNITS.md);
}

/** A shadow with no offset — a halo all round, which is how `glow` reads. */
const halo = (blurRadius: number, color: string): UiShadow[] => [
  { offsetX: 0, offsetY: 0, blurRadius, spreadDistance: 0, color },
];

/** A dropped shadow straight down, which is how `glass` and `gradient` sit. */
const drop = (offsetY: number, blurRadius: number, color: string): UiShadow[] => [
  { offsetX: 0, offsetY, blurRadius, spreadDistance: 0, color },
];

interface Surface {
  surface: ViewStyle;
  /** What the web changes on `:hover`; native applies it while pressed. */
  hover: ViewStyle;
}

function glassSurface(theme: UiTheme, lifted: boolean): Surface {
  return {
    surface: {
      backgroundColor: alpha(theme.palette.background.paper, CARD_GLASS.backgroundAlpha.rest),
      borderWidth: CARD_BORDER_WIDTH,
      borderStyle: 'solid',
      borderColor: alpha(theme.palette.primary.main, CARD_GLASS.borderAlpha.rest),
      boxShadow: drop(
        CARD_GLASS.shadow.offsetY,
        CARD_GLASS.shadow.blurRadius,
        alpha(BLACK, CARD_GLASS.shadow.alpha),
      ),
    },
    hover: {
      backgroundColor: alpha(
        theme.palette.background.paper,
        lifted ? CARD_GLASS.backgroundAlpha.lifted : CARD_GLASS.backgroundAlpha.rest,
      ),
      borderColor: alpha(theme.palette.primary.main, CARD_GLASS.borderAlpha.lifted),
    },
  };
}

function neumorphicSurface(theme: UiTheme, lifted: boolean): Surface {
  const { dark, light } = CARD_NEUMORPHIC.alpha;
  const pair = (raised: boolean): UiShadow[] =>
    theme.mode === 'dark'
      ? neumorphicShadows(raised, alpha(BLACK, dark.near), alpha(WHITE, dark.far))
      : neumorphicShadows(
          raised,
          alpha(theme.palette.grey[400], raised ? light.near.lifted : light.near.rest),
          alpha(WHITE, raised ? light.far.lifted : light.far.rest),
        );

  return {
    surface: {
      backgroundColor: theme.mode === 'dark' ? theme.palette.grey[800] : theme.palette.grey[100],
      boxShadow: pair(false),
      borderWidth: 0,
    },
    hover: { boxShadow: pair(lifted) },
  };
}

function sectionSurface(theme: UiTheme, lifted: boolean): Surface {
  const wash = CARD_SECTION_BACKGROUND[theme.mode === 'dark' ? 'dark' : 'light'];
  return {
    surface: { backgroundColor: wash.rest, borderWidth: 0, boxShadow: undefined },
    hover: { backgroundColor: lifted ? wash.lifted : wash.rest },
  };
}

/**
 * Each variant's resting surface and whatever it changes on hover — the same
 * split `Card.styles.ts` makes, in React Native's property names.
 *
 * `gradient` is the one honest gap: React Native core has no gradient fill, so
 * it paints the gradient's FIRST stop. The parity ledger records it.
 */
export function cardSurface(theme: UiTheme, variant: CardVariant, lifted: boolean): Surface {
  switch (variant) {
    case 'outlined':
      return {
        surface: {
          borderWidth: CARD_BORDER_WIDTH,
          borderStyle: 'solid',
          borderColor: theme.palette.divider,
          boxShadow: undefined,
        },
        hover: { borderColor: lifted ? theme.palette.primary.main : theme.palette.divider },
      };
    case 'glass':
      return glassSurface(theme, lifted);
    case 'gradient':
      return {
        surface: {
          backgroundColor: theme.palette.primary.main,
          boxShadow: drop(
            CARD_GRADIENT.shadow.offsetY,
            CARD_GRADIENT.shadow.blurRadius,
            alpha(theme.palette.primary.main, CARD_GRADIENT.shadow.alpha),
          ),
        },
        hover: {
          backgroundColor: lifted ? theme.palette.primary.dark : theme.palette.primary.main,
        },
      };
    case 'neumorphic':
      return neumorphicSurface(theme, lifted);
    case 'section':
      return sectionSurface(theme, lifted);
    default:
      // `elevated` declares only MUI's inert `elevation`, so the paper shadow
      // the base laid down (or a `glow` over it) is what shows.
      return { surface: {}, hover: {} };
  }
}

/** The ink a card's own text inherits: `gradient` flips it, everything else is body ink. */
export const cardInk = (theme: UiTheme, variant: CardVariant): string =>
  variant === 'gradient' ? theme.palette.primary.contrastText : theme.palette.text.primary;

export interface CardLookArgs {
  variant: CardVariant;
  interactive: boolean;
  glow: boolean;
  pulse: boolean;
  loading: boolean;
  borderRadius: CardBorderRadius;
}

export interface CardLook {
  container: ViewStyle;
  /** Applied while pressed, standing in for the web's `:hover`. */
  pressed: ViewStyle;
  radius: number | string;
  ink: string;
}

/**
 * Everything the card paints, decided once per render.
 *
 * `overflow` is the one place native needs a rule the web does not. MUI's
 * `Card` clips its children, and the pulse ring has to reach 15px past the
 * edge — but a view's own shadow is clipped by its own overflow on a device,
 * so a `glow` the caller asked for would simply not paint. Both decorations
 * therefore turn the clip off, exactly as `Button.native.tsx` does.
 */
export function cardLook(theme: UiTheme, a: CardLookArgs): CardLook {
  const radius = cardRadius(theme, a.borderRadius);
  const chosen = cardSurface(theme, a.variant, a.interactive);

  const base: ViewStyle = {
    position: 'relative',
    borderRadius: radius,
    backgroundColor: theme.palette.background.paper,
    overflow: a.pulse || a.glow ? 'visible' : 'hidden',
    opacity: a.loading ? CARD_LOADING.opacity : 1,
    pointerEvents: a.loading ? 'none' : 'auto',
  };

  return {
    radius,
    ink: cardInk(theme, a.variant),
    container: {
      ...base,
      boxShadow: CARD_PAPER_SHADOW,
      ...(a.interactive ? { cursor: 'pointer' } : null),
      ...(a.glow
        ? { boxShadow: halo(CARD_GLOW.rest.blurRadius, alpha(theme.palette.primary.main, CARD_GLOW.rest.alpha)) }
        : null),
      ...chosen.surface,
    },
    pressed: {
      ...(a.glow
        ? { boxShadow: halo(CARD_GLOW.lifted.blurRadius, alpha(theme.palette.primary.main, CARD_GLOW.lifted.alpha)) }
        : null),
      ...chosen.hover,
    },
  };
}
