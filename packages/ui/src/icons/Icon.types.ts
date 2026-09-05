import type { IconName } from './paths.generated';
import type { ColorValue, SizeValue } from '../tokens/vocabulary';

export type { IconName };

/**
 * The glyph sizes, in px. `md` is MUI's `SvgIcon` default (24) and `sm` its
 * `small` (20); the rest continue the house scale in 4px steps either side.
 */
export const ICON_SIZES: Record<SizeValue, number> = {
  xs: 16,
  sm: 20,
  md: 24,
  lg: 32,
  xl: 40,
};

export interface IconBaseProps {
  /** Which glyph. The list is `src/icons/glyphs.json`; both renderers draw the same paths. */
  name: IconName;
  /** A step of the house scale, or an exact px size. */
  size?: SizeValue | number;
  /**
   * A house colour, `inherit` (the surrounding text's colour on the web, the
   * theme's primary text on native, which has no `currentColor`), or any CSS
   * colour string.
   */
  color?: ColorValue | 'inherit' | string;
  /**
   * The name a screen reader gives the glyph. Omit for a decorative icon: it
   * is then hidden from assistive technology on both renderers.
   */
  label?: string;
  testID?: string;
  dataTestId?: string;
}

/** The px size for either spelling of `size`. */
export const iconSize = (size: SizeValue | number | undefined): number =>
  typeof size === 'number' ? size : ICON_SIZES[size ?? 'md'];
