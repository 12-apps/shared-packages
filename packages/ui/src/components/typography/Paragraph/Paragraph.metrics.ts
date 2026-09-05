import type { UiTypeStep } from '../../../tokens/theme';
import type { SizeValue } from '../../../tokens/vocabulary';

/**
 * THE NUMBERS BOTH `Paragraph` RENDERERS DRAW WITH.
 *
 * `Paragraph.tsx` used to hold these as rem strings inside its styled
 * callback, and `Paragraph.native.tsx` would have held them again as numbers.
 * Now there is one table, in px, and the web derives its rem from it (`px()`
 * in the theme). Ratios and `em` values stay relative; the native side
 * multiplies them out because React Native's `lineHeight`, `letterSpacing` and
 * margins are absolute.
 *
 * NOT `TYPE_SIZES`: a paragraph is set looser than `Text`'s body scale (1.6
 * against 1.5 at `md`), because it is read in runs of lines rather than as a
 * label. The font sizes are the same five steps.
 */
export const PARAGRAPH_SIZES: Record<SizeValue, UiTypeStep> = {
  xs: { fontSize: 12, lineHeight: 1.4 },
  sm: { fontSize: 14, lineHeight: 1.5 },
  md: { fontSize: 16, lineHeight: 1.6 },
  lg: { fontSize: 18, lineHeight: 1.6 },
  xl: { fontSize: 20, lineHeight: 1.7 },
};

export const PARAGRAPH_FONT_WEIGHT = 400;

/** `margin: 0 0 1em 0` — one line of its own type below each paragraph. */
export const PARAGRAPH_MARGIN_BOTTOM_EM = 1;

/** The `lead` variant: a step up at the default size, looser leading and tracking. */
export const LEAD_FONT_SIZE = 18;
export const LEAD_LINE_HEIGHT = 1.7;
export const LEAD_LETTER_SPACING_EM = 0.01;

/** The `muted` variant: the secondary ink, faded further. */
export const MUTED_OPACITY = 0.8;

/** The `small` variant: a step down at the default size, on the secondary ink. */
export const SMALL_FONT_SIZE = 14;
export const SMALL_LINE_HEIGHT = 1.5;
