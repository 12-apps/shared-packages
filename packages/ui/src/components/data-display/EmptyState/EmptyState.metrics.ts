import type { EmptyStateVariant } from './EmptyState.base';

/**
 * THE NUMBERS BOTH `EmptyState` RENDERERS DRAW WITH.
 *
 * `EmptyState.tsx` (MUI) and `EmptyState.native.tsx` (React Native) read
 * this one table. Spacing is in SPACING UNITS where the web writes
 * `theme.spacing(n)`; everything else is px or a ratio.
 */

/** The region: a centred column, `theme.spacing(6)` of padding, at least 200px tall, its parts 24px apart. */
export const EMPTY_STATE_PADDING_UNITS = 6;
export const EMPTY_STATE_MIN_HEIGHT = 200;
export const EMPTY_STATE_GAP_UNITS = 3;

/** The illustration: wider when it is the point, faded a little always, hidden in `minimal`. */
export const ILLUSTRATION_MAX_WIDTH = { illustrated: 240, other: 120 } as const;
export const ILLUSTRATION_OPACITY = { minimal: 0.6, other: 0.8 } as const;

export const illustrationMaxWidth = (variant: EmptyStateVariant): number =>
  variant === 'illustrated' ? ILLUSTRATION_MAX_WIDTH.illustrated : ILLUSTRATION_MAX_WIDTH.other;
export const illustrationOpacity = (variant: EmptyStateVariant): number =>
  variant === 'minimal' ? ILLUSTRATION_OPACITY.minimal : ILLUSTRATION_OPACITY.other;

/** Title, description, actions and link are 16px apart; the title wraps at 400px, the description at 480px on a 1.6 line height. */
export const CONTENT_GAP_UNITS = 2;
export const TITLE_MAX_WIDTH = 400;
export const DESCRIPTION_MAX_WIDTH = 480;
export const DESCRIPTION_LINE_HEIGHT = 1.6;

/** The action row: 16px below the text, buttons 16px apart, stacked below MUI's `sm` breakpoint. */
export const ACTIONS_MARGIN_TOP_UNITS = 2;
export const ACTIONS_GAP_UNITS = 2;
export const ACTIONS_ROW_FROM = 600;
export const ACTION_MIN_WIDTH = 120;
/**
 * The web actions ARE MUI's medium `contained` and `outlined` buttons: 6px
 * 16px, or 5px 15px inside a 1px border at half alpha, 14px type, the
 * theme's radius, a 20px start icon. The native side sizes the house
 * `Button` to these.
 */
export const ACTION_BUTTON = {
  contained: { paddingVertical: 6, paddingHorizontal: 16 },
  outlined: { paddingVertical: 5, paddingHorizontal: 15 },
  iconSize: 20,
  outlinedBorderAlpha: 0.5,
} as const;
/** MUI's `theme.shadows[2]`, the elevation a contained button rests at. */
export const MUI_CONTAINED_SHADOW =
  '0px 3px 1px -2px rgba(0,0,0,0.2), 0px 2px 2px 0px rgba(0,0,0,0.14), 0px 1px 5px 0px rgba(0,0,0,0.12)';

/** The help link: 8px below whatever precedes it, marked when it leaves the app. */
export const HELP_LINK_MARGIN_TOP_UNITS = 1;
export const EXTERNAL_LINK_MARK = ' ↗';
