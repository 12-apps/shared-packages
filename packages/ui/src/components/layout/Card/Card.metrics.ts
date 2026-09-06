import type { CardBorderRadius } from './Card.base';
import type { UiShadow } from '../../../tokens/shadow';

/**
 * THE NUMBERS BOTH `Card` RENDERERS DRAW WITH.
 *
 * `Card.styles.ts` (web, emotion over MUI) and `Card.native.tsx` /
 * `Card.look.native.ts` (React Native) read this one table. The web turns the
 * radii into `theme.spacing()` and the shadows into CSS strings (`shadowCss`
 * in `src/tokens/shadow.ts` writes exactly the text it always has); native
 * hands the same shadow objects to `boxShadow` and the same numbers to a
 * `StyleSheet`.
 *
 * Nothing here imports a renderer, a theme or a colour: a shadow's COLOUR is
 * the caller's, because the two sides reach for the same arithmetic through
 * different doors (`alpha` from `@mui/material/styles` on the web, from
 * `src/tokens/color` natively — a port of it, asserted equal).
 */

/* ── The envelope ─────────────────────────────────────────────────────────── */

/**
 * `theme.spacing(n)` per named radius. `none` is written as a bare `0` by the
 * web rather than `spacing(0)`, so it is spelled that way on both sides.
 */
export const CARD_RADIUS_UNITS: Record<Exclude<CardBorderRadius, 'full'>, number> = {
  none: 0,
  sm: 0.5,
  md: 1,
  lg: 2,
  xl: 3,
};

/** `full` is a percentage of the box, not a length. */
export const CARD_RADIUS_FULL = '50%';

/** The hairline `outlined` and `glass` draw. */
export const CARD_BORDER_WIDTH = 1;

/* ── Shadows ──────────────────────────────────────────────────────────────── */

/** A card's shadows are `UiShadow`s; `src/tokens/shadow.ts` says why they have a shape. */
export type CardShadow = UiShadow;

/**
 * MUI's `theme.shadows[1]` — the elevation a `Paper` paints and therefore the
 * shadow every `elevated` card on the web already has.
 *
 * It is restated here rather than derived because the web never names it: it
 * arrives through `MuiCard` -> `MuiPaper`, and React Native has no Paper to
 * inherit it from. (`variant="elevated"`'s own `elevation: 4` is not a CSS
 * property and paints nothing — see {@link CARD_ELEVATION}.)
 */
export const CARD_PAPER_SHADOW: readonly UiShadow[] = [
  { offsetX: 0, offsetY: 2, blurRadius: 1, spreadDistance: -1, color: 'rgba(0, 0, 0, 0.2)' },
  { offsetX: 0, offsetY: 1, blurRadius: 1, spreadDistance: 0, color: 'rgba(0, 0, 0, 0.14)' },
  { offsetX: 0, offsetY: 1, blurRadius: 3, spreadDistance: 0, color: 'rgba(0, 0, 0, 0.12)' },
];

/**
 * What `elevated` declares at rest and on hover.
 *
 * `elevation` is not a CSS property, so on the web these paint NOTHING and an
 * elevated card shows `MuiPaper`'s own elevation-1 shadow. Kept because they
 * are what the source says, and mirrored natively by leaving
 * {@link CARD_PAPER_SHADOW} in place for both states.
 */
export const CARD_ELEVATION = { rest: 4, lifted: 8 } as const;

/* ── Variant surfaces ─────────────────────────────────────────────────────── */

/** `glass`: a 0.1 wash of the paper behind a 20px blur, inside a primary hairline. */
export const CARD_GLASS = {
  backgroundAlpha: { rest: 0.1, lifted: 0.15 },
  borderAlpha: { rest: 0.2, lifted: 0.3 },
  blurPx: 20,
  shadow: { offsetY: 8, blurRadius: 32, alpha: 0.1 },
} as const;

/** `gradient`: primary into secondary at 135°, over a hue-tinted drop shadow. */
export const CARD_GRADIENT = {
  angleDeg: 135,
  shadow: { offsetY: 4, blurRadius: 20, alpha: 0.3 },
} as const;

/** `neumorphic`: two opposed shadows, blurred twice their offset. */
export const CARD_NEUMORPHIC = {
  spread: { rest: 8, lifted: 12 },
  blurFactor: 2,
  alpha: {
    dark: { near: 0.3, far: 0.1 },
    light: { near: { rest: 0.2, lifted: 0.3 }, far: { rest: 0.8, lifted: 0.9 } },
  },
} as const;

/**
 * The offset pair `neumorphic` paints, given the two colours the mode picked:
 * `near` down-right, `far` up-left, both blurred twice the offset.
 */
export function neumorphicShadows(lifted: boolean, near: string, far: string): UiShadow[] {
  const spread = lifted ? CARD_NEUMORPHIC.spread.lifted : CARD_NEUMORPHIC.spread.rest;
  const blurRadius = spread * CARD_NEUMORPHIC.blurFactor;
  return [
    { offsetX: spread, offsetY: spread, blurRadius, spreadDistance: 0, color: near },
    { offsetX: -spread, offsetY: -spread, blurRadius, spreadDistance: 0, color: far },
  ];
}

/**
 * `section`: a flat ink wash rather than a palette slot, so a section reads as
 * a recess in whatever surface it sits on.
 */
export const CARD_SECTION_BACKGROUND = {
  dark: { rest: 'rgba(0, 0, 0, 0.2)', lifted: 'rgba(0, 0, 0, 0.25)' },
  light: { rest: 'rgba(0, 0, 0, 0.02)', lifted: 'rgba(0, 0, 0, 0.04)' },
} as const;

/* ── Decorations ──────────────────────────────────────────────────────────── */

/** `glow`: a haloed primary shadow that widens under the pointer. */
export const CARD_GLOW = {
  rest: { blurRadius: 20, alpha: 0.3 },
  lifted: { blurRadius: 30, alpha: 0.4 },
} as const;

/**
 * `pulse`: a ring of the primary hue that grows 15px out of the card's edge and
 * fades, every two seconds. The web draws it as an `::after` box-shadow spread
 * behind the paper (`z-index: -1`).
 */
export const CARD_PULSE = {
  alpha: 0.3,
  durationMs: 2000,
  spread: 15,
  /** The fraction of the cycle the ring is still visible for. */
  fadeAt: 0.7,
  zIndex: -1,
} as const;

/** `interactive`: the card rises 2px under the pointer and settles while pressed. */
export const CARD_INTERACTIVE_LIFT = 2;

/** `loading`: the card dims, stops taking pointers and centres a spinner over itself. */
export const CARD_LOADING = { opacity: 0.6, spinnerZIndex: 10, spinnerSize: 40 } as const;

/* ── The slots ────────────────────────────────────────────────────────────── */

/** `CardContent`: `theme.spacing(2)`, halved by `dense`. */
export const CARD_CONTENT_PADDING_UNITS = { normal: 2, dense: 1 } as const;

/**
 * `CardHeader`, in MUI's own px: 16 all round, the avatar 16 from the content,
 * the action pulled back out of the padding on three sides.
 */
export const CARD_HEADER = {
  padding: 16,
  avatarGap: 16,
  action: { marginTop: -4, marginRight: -8, marginBottom: -4 },
} as const;

/** A `CardHeader` given raw `children` is a plain `theme.spacing(2)` box instead. */
export const CARD_HEADER_CHILDREN_PADDING_UNITS = 2;

/**
 * `CardActions`, in MUI's own px: 8 all round, and 8 between the actions unless
 * `disableSpacing` turns the run off.
 */
export const CARD_ACTIONS = { padding: 8, gap: 8 } as const;

/** `CardMedia`'s default height. */
export const CARD_MEDIA_HEIGHT = 200;
