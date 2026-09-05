import { darken, lighten } from '../../../tokens/color';
import type { ColorValue, SizeValue } from '../../../tokens/vocabulary';
import type { UiPaletteColor, UiTheme } from '../../../tokens/theme';

/**
 * THE NUMBERS BOTH `Button` RENDERERS DRAW WITH.
 *
 * `Button.styles.ts` (web, emotion) and `Button.native.tsx` (React Native)
 * read this one table. The web turns the px into rem and the padding into a
 * shorthand string; native uses the numbers as they are. Neither restates a
 * value, which is what keeps a native `md` button 16px tall of padding and
 * 16px of type exactly like the web one.
 */
export interface ButtonSizeMetrics {
  paddingVertical: number;
  paddingHorizontal: number;
  fontSize: number;
}

export const BUTTON_SIZES: Record<SizeValue, ButtonSizeMetrics> = {
  xs: { paddingVertical: 2, paddingHorizontal: 8, fontSize: 12 },
  sm: { paddingVertical: 6, paddingHorizontal: 12, fontSize: 14 },
  md: { paddingVertical: 8, paddingHorizontal: 16, fontSize: 16 },
  lg: { paddingVertical: 10, paddingHorizontal: 20, fontSize: 18 },
  xl: { paddingVertical: 12, paddingHorizontal: 24, fontSize: 20 },
};

/** A button that is only an icon is square: uniform padding, no min-width. */
export const ICON_ONLY_PADDING: Record<SizeValue, number> = {
  xs: 2,
  sm: 5,
  md: 7,
  lg: 9,
  xl: 11,
};

export const BUTTON_FONT_WEIGHT = 500;
/** `theme.spacing(1)`. */
export const BUTTON_RADIUS_UNITS = 1;
/** Between the icon and the label: `theme.spacing(0.5)`. */
export const BUTTON_ICON_GAP_UNITS = 0.5;
export const BUTTON_SPINNER_SIZE = 16;
/** MUI's `line-height` for button text. */
export const BUTTON_LINE_HEIGHT = 1.75;

/** The wash behind an outline, ghost or text button while it is hovered or pressed. */
export const BUTTON_WASH_ALPHA = 0.1;
export const GLASS_BACKGROUND_ALPHA = 0.1;
export const GLASS_BACKGROUND_ALPHA_PRESSED = 0.2;
export const GLASS_BORDER_ALPHA = 0.2;
export const GLOW_INNER_ALPHA = 0.6;
export const GLOW_OUTER_ALPHA = 0.3;
export const GLOW_RADIUS = 20;
export const PULSE_ALPHA = 0.3;
export const PULSE_DURATION_MS = 2000;
export const PULSE_SPREAD = 15;

/**
 * `neutral` has no palette slot of its own in MUI, so `Button.styles.ts` has
 * always drawn it from three greys. Same three greys here.
 */
export function buttonPalette(theme: UiTheme, color: ColorValue): UiPaletteColor {
  if (color === 'neutral') {
    return {
      main: theme.palette.grey[700],
      dark: theme.palette.grey[800],
      light: theme.palette.grey[500],
      contrastText: '#fff',
    };
  }
  return theme.palette[color];
}

/**
 * The label colour for `ghost` and `text`: one step darker than `main` in
 * light mode (lighter in dark), because `main` is chosen to sit UNDER white and
 * is not legible AS text on a tinted surface. See the web `quietInk`.
 */
export const quietInk = (theme: UiTheme, palette: UiPaletteColor): string =>
  theme.mode === 'dark' ? lighten(palette.main, 0.35) : darken(palette.main, 0.3);

/** Gradients run between two related hues; the named colours pick a specific pair. */
export function gradientStops(
  theme: UiTheme,
  color: ColorValue,
  palette: UiPaletteColor,
): [string, string] {
  switch (color) {
    case 'primary':
      return [theme.palette.primary.main, theme.palette.secondary.main];
    case 'secondary':
      return [theme.palette.secondary.main, theme.palette.primary.main];
    case 'success':
    case 'warning':
      return [theme.palette[color].light, theme.palette[color].dark];
    case 'danger':
      return [theme.palette.danger.light, theme.palette.danger.dark];
    default:
      return [palette.main, palette.dark];
  }
}
