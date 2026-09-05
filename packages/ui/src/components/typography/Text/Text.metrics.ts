import { FONT_WEIGHTS, TYPE_SIZES } from '../../../tokens/theme';

/**
 * THE NUMBERS BOTH `Text` RENDERERS DRAW WITH.
 *
 * `Text.tsx` used to hold these as rem strings and `Text.native.tsx` would have
 * held them again as numbers — two tables, one of which drifts. Now there is
 * one, in px, and the web derives its rem from it (see `px()` in the theme).
 * Ratios stay ratios; the native side multiplies them out because React
 * Native's `lineHeight` and `letterSpacing` are absolute.
 */
export const TEXT_SIZES = TYPE_SIZES;
export const TEXT_WEIGHTS = FONT_WEIGHTS;

/** The `heading` variant: heavier by default, tighter tracking. */
export const HEADING_DEFAULT_WEIGHT = 600;
export const HEADING_LETTER_SPACING_EM = -0.01;

/** The `caption` variant: a step down at the default size, faded and looser. */
export const CAPTION_FONT_SIZE = 12;
export const CAPTION_OPACITY = 0.8;
export const CAPTION_LETTER_SPACING_EM = 0.02;

/** The `code` variant: a step down, on a faint primary wash inside a hairline. */
export const CODE_FONT_SIZE = 14;
export const CODE_BACKGROUND_ALPHA = 0.08;
export const CODE_BORDER_ALPHA = 0.12;
export const CODE_PADDING = { vertical: 2, horizontal: 6 } as const;
/** Half the theme's `md` radius, as `Text.tsx` has always drawn it. */
export const CODE_RADIUS_FACTOR = 0.5;
