import type { ChipSize } from './Chip.base';

/**
 * THE NUMBERS BOTH `Chip` RENDERERS DRAW WITH.
 *
 * Most of them are MUI's own `Chip` geometry rather than anything this package
 * writes — the 32px pill, the 13px label, the 5px/-6px icon tuck — because the
 * web half hands the drawing to `MuiChip` and the native half has to draw it.
 * Restated here once, read by both, so the two cannot disagree about a chip's
 * height. What THIS package adds (`Chip.styles.tsx`'s hover lift, its shadow
 * and its transition) is at the bottom, and the web derives its CSS from it.
 */

/** MUI draws two chip sizes; ours are the house abbreviations for them. */
export type ChipMuiSize = 'small' | 'medium';

export const chipMuiSize = (size: ChipSize): ChipMuiSize =>
  size === 'xs' || size === 'sm' ? 'small' : 'medium';

export interface ChipSizeMetrics {
  height: number;
  /** The label's own side padding, filled and outlined (outlined is 1px tighter). */
  labelPadding: number;
  labelPaddingOutlined: number;
  /** The leading icon's box, and how far it tucks under the label. */
  iconSize: number;
  iconMarginLeft: number;
  iconMarginLeftOutlined: number;
  iconMarginRight: number;
  /** The avatar's round box and the type inside it. */
  avatarSize: number;
  avatarFontSize: number;
  avatarMarginLeft: number;
  avatarMarginLeftOutlined: number;
  avatarMarginRight: number;
  /** The delete glyph's box and its own tuck. */
  deleteSize: number;
  deleteMarginLeft: number;
  deleteMarginRight: number;
  deleteMarginRightOutlined: number;
}

export const CHIP_SIZES: Record<ChipMuiSize, ChipSizeMetrics> = {
  medium: {
    height: 32,
    labelPadding: 12,
    labelPaddingOutlined: 11,
    iconSize: 24,
    iconMarginLeft: 5,
    iconMarginLeftOutlined: 4,
    iconMarginRight: -6,
    avatarSize: 24,
    avatarFontSize: 12,
    avatarMarginLeft: 5,
    avatarMarginLeftOutlined: 4,
    avatarMarginRight: -6,
    deleteSize: 22,
    deleteMarginLeft: -6,
    deleteMarginRight: 5,
    deleteMarginRightOutlined: 5,
  },
  small: {
    height: 24,
    labelPadding: 8,
    labelPaddingOutlined: 7,
    iconSize: 18,
    iconMarginLeft: 4,
    iconMarginLeftOutlined: 2,
    iconMarginRight: -4,
    avatarSize: 18,
    avatarFontSize: 10,
    avatarMarginLeft: 4,
    avatarMarginLeftOutlined: 2,
    avatarMarginRight: -4,
    deleteSize: 16,
    deleteMarginLeft: -4,
    deleteMarginRight: 4,
    deleteMarginRightOutlined: 3,
  },
};

/** MUI's `borderRadius: 32 / 2` — a pill at either height, since the box clamps it. */
export const CHIP_RADIUS = 16;
/** The label's type, in px. MUI sets it on the root and the small size keeps it. */
export const CHIP_FONT_SIZE = 13;
/** MUI's `palette.action.disabledOpacity`. */
export const CHIP_DISABLED_OPACITY = 0.38;
/** An outlined chip's hairline: the hue at 0.7, or the grey ramp for `neutral`. */
export const OUTLINED_BORDER_ALPHA = 0.7;
/** The delete glyph over an unaccented chip, and over a coloured one. */
export const DELETE_ICON_ALPHA = 0.26;
export const DELETE_ICON_ON_COLOR_ALPHA = 0.7;
/** MUI's `action.hoverOpacity`, the wash a clickable outlined chip takes. */
export const OUTLINED_HOVER_ALPHA = 0.04;

/* ── What this package adds on top of MUI's chip ──────────────────────────── */

/** The lift a clickable chip takes on hover, and the shadow under it. */
export const HOVER_LIFT_PX = 1;
export const HOVER_SHADOW = { offsetY: 4, blur: 12, alphaLight: 0.15, alphaDark: 0.3 } as const;
export const CHIP_TRANSITION_MS = 200;
export const CHIP_TRANSITION_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
