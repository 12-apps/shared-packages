import type { ErrorStateSeverity } from './ErrorState.base';
import type { UiPaletteColor, UiTheme } from '../../../tokens/theme';

/**
 * THE NUMBERS BOTH `ErrorState` RENDERERS DRAW WITH.
 *
 * `ErrorState.tsx` (MUI) and `ErrorState.native.tsx` (React Native) read this
 * one table. Spacing is in SPACING UNITS where the web writes
 * `theme.spacing(n)`; everything else is px or a ratio.
 */

/** The region: a centred column, `theme.spacing(6)` of padding, at least 200px tall, its parts 16px apart. */
export const ERROR_STATE_PADDING_UNITS = 6;
export const ERROR_STATE_MIN_HEIGHT = 200;
export const ERROR_STATE_GAP_UNITS = 2;

/** The glyph sits in an 80px disc of the severity's `light` shade at 0.9 opacity. */
export const ERROR_ICON_BOX = 80;
export const ERROR_ICON_BOX_OPACITY = 0.9;
export const ERROR_ICON_SIZE = 48;

/** Title and message are 8px apart; the message wraps at 400px on a 1.6 line height. */
export const ERROR_TEXT_GAP_UNITS = 1;
export const ERROR_MESSAGE_MAX_WIDTH = 400;
export const ERROR_MESSAGE_LINE_HEIGHT = 1.6;

/** The retry button: 8px below the text, no narrower than 120px. */
export const RETRY_MARGIN_TOP_UNITS = 1;
export const RETRY_MIN_WIDTH = 120;
/**
 * The web retry IS MUI's medium outlined `Button`: 5px 15px inside its 1px
 * border, 14px type, the theme's radius, a 20px start icon. The native side
 * sizes the house `Button` to these.
 */
export const RETRY_BUTTON = {
  paddingVertical: 5,
  paddingHorizontal: 15,
  iconSize: 20,
} as const;

/** `error` is MUI's name for the `danger` slot; `warning` is its own. */
export function errorStatePalette(theme: UiTheme, severity: ErrorStateSeverity): UiPaletteColor {
  return severity === 'error' ? theme.palette.danger : theme.palette.warning;
}
