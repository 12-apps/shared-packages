import { COLOR_VALUES, type ColorValue } from '../tokens/vocabulary';
import type { UiTheme } from '../tokens/theme';

const isColorValue = (color: string): color is ColorValue =>
  (COLOR_VALUES as readonly string[]).includes(color);

/**
 * The fill for an icon's `color` prop, on either renderer.
 *
 * A house colour resolves to the palette slot's `main`; `inherit` is the
 * caller's problem (the web passes `currentColor`, native the text colour); any
 * other string is taken as a CSS colour and passed through.
 */
export function iconFill(theme: UiTheme, color: string | undefined, inherit: string): string {
  if (color === undefined || color === 'inherit') return inherit;
  if (isColorValue(color)) {
    return color === 'neutral' ? theme.palette.text.secondary : theme.palette[color].main;
  }
  return color;
}
