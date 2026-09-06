import type { DialogBorderRadius, DialogSize } from './Dialog.base';
import type { UiShadow } from '../../../tokens/shadow';

/**
 * THE NUMBERS BOTH `Dialog` RENDERERS DRAW WITH.
 *
 * `Dialog.styles.ts` / `Dialog.tsx` (MUI) and `Dialog.look.native.ts` /
 * `Dialog.native.tsx` (React Native) read this one table. Spacing is in
 * SPACING UNITS wherever the web writes `theme.spacing(n)`; everything else is
 * px, a ratio or an alpha. Shadows are `UiShadow`s — see `src/tokens/shadow.ts`
 * for why they have a shape rather than a string.
 */

/* ── The paper ────────────────────────────────────────────────────────────── */

/** `theme.spacing(n)` per named radius; `lg` is the default. */
export const DIALOG_RADIUS_UNITS: Record<DialogBorderRadius, number> = {
  none: 0,
  sm: 0.5,
  md: 1,
  lg: 2,
  xl: 3,
};

/** How wide the paper may grow, per size, in px. Also the drawer's fixed width. */
export const DIALOG_MAX_WIDTH: Record<DialogSize, number> = {
  xs: 400,
  sm: 600,
  md: 800,
  lg: 1000,
  xl: 1200,
};

/** The paper is 90% of the viewport up to its max width, `theme.spacing(2)` clear of the edge. */
export const DIALOG_WIDTH_PERCENT = 90;
export const DIALOG_MARGIN_UNITS = 2;

/** The hairline `glass` draws. */
export const DIALOG_BORDER_WIDTH = 1;

/**
 * MUI's `theme.shadows[24]` — the elevation a `Dialog`'s Paper paints.
 *
 * Restated rather than derived because the web never names it: `MuiDialog`
 * passes `elevation={24}` to its Paper, and React Native has no Paper to
 * inherit that from.
 */
export const DIALOG_PAPER_SHADOW: readonly UiShadow[] = [
  { offsetX: 0, offsetY: 11, blurRadius: 15, spreadDistance: -7, color: 'rgba(0, 0, 0, 0.2)' },
  { offsetX: 0, offsetY: 24, blurRadius: 38, spreadDistance: 3, color: 'rgba(0, 0, 0, 0.14)' },
  { offsetX: 0, offsetY: 9, blurRadius: 46, spreadDistance: 8, color: 'rgba(0, 0, 0, 0.12)' },
];

/* ── Variants and decorations ─────────────────────────────────────────────── */

/** `glass`: a 0.1 wash of the paper behind a 20px blur, inside a primary hairline. */
export const DIALOG_GLASS = {
  backgroundAlpha: 0.1,
  blurPx: 20,
  borderAlpha: 0.2,
  shadow: { offsetY: 8, blurRadius: 32, alpha: 0.1 },
} as const;

/** `gradient`: a faint primary-into-secondary wash at 135°, over a 10px blur. */
export const DIALOG_GRADIENT = { angleDeg: 135, stopAlpha: 0.1, blurPx: 10 } as const;

/** `glow`: a 40px halo of the primary hue. */
export const DIALOG_GLOW = { blurRadius: 40, alpha: 0.3 } as const;

/**
 * `pulse`: a ring of the primary hue that grows 20px out of the paper's edge and
 * fades, every two seconds. The web draws it as an `::after` box-shadow spread
 * behind the paper (`z-index: -1`).
 */
export const DIALOG_PULSE = {
  alpha: 0.3,
  durationMs: 2000,
  spread: 20,
  /** The fraction of the cycle the ring is still visible for. */
  fadeAt: 0.7,
  zIndex: -1,
} as const;

/**
 * The scrim: half-black, or a fifth of it behind an 8px blur for `glass`.
 *
 * It paints on BOTH renderers whatever `backdrop` is set to. The web reads that
 * prop as `BackdropComponent={backdrop ? Backdrop : undefined}`, and `undefined`
 * is exactly what MUI falls back to `Backdrop` for — so the scrim is there
 * either way. Native mirrors that rather than inventing a difference; fixing it
 * is a web change, made once, for both.
 */
export const DIALOG_BACKDROP = { alpha: { plain: 0.5, glass: 0.2 }, blurPx: 8 } as const;

/* ── The slots ────────────────────────────────────────────────────────────── */

/** Raw children (no `DialogContent`/`DialogActions`) get this padding, in spacing units. */
export const DIALOG_BODY_PADDING_UNITS = {
  horizontal: 3,
  bottom: 2.5,
  top: 2.5,
  /** Tighter under a title, whose own bottom padding is most of the gap. */
  topUnderTitle: 0.5,
} as const;

/** A `DialogHeader` given raw `children` is a padded box over a hairline instead. */
export const DIALOG_HEADER_CHILDREN_PADDING_UNITS = 2;

/**
 * The title row: MUI's `DialogTitle` padding in px, and the bottom the web
 * overrides in spacing units — tighter when a subtitle follows it.
 */
export const DIALOG_TITLE = {
  padding: { top: 16, horizontal: 24 },
  paddingBottomUnits: { withSubtitle: 1, plain: 2 },
  subtitleGapUnits: 0.5,
} as const;

/**
 * The close button: MUI's `IconButton` at its default 8px padding around a
 * 24px glyph, on a circular hover wash.
 */
export const DIALOG_CLOSE_BUTTON = { padding: 8, iconSize: 24 } as const;

/** `DialogContent`: `theme.spacing(3)`, tightened by `dense`. */
export const DIALOG_CONTENT_PADDING_UNITS = { normal: 3, dense: 1.5 } as const;

/**
 * Top padding for a body that sits directly under the title.
 *
 * MUI zeroes it there, assuming the title's own bottom padding is the whole
 * gap. That assumption breaks for a body opening with an outlined field: a
 * filled field floats its label ABOVE the input's border box, and the body is a
 * clipping box, so the label gets sliced in half (FUT-544). 12px clears the
 * shrunk label's 9px overhang and leaves the gap visually tight.
 */
export const DIALOG_TITLED_BODY_PADDING_TOP_UNITS = 1.5;

/** `DialogActions`: `theme.spacing(2)` around, and one unit between by default. */
export const DIALOG_ACTIONS = { paddingUnits: 2, defaultSpacingUnits: 1 } as const;
