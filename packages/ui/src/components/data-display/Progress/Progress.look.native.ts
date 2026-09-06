import type { TextStyle, ViewStyle } from 'react-native';

import type { ProgressSize, ProgressVariant } from './Progress.base';
import {
  BAR_GLOW,
  CIRCULAR_GLOW,
  GLASS_BAR_ALPHA,
  GLASS_BAR_BORDER_ALPHA,
  LABEL_FONT_WEIGHT,
  PROGRESS_SIZES,
  SEGMENT_GLOW,
  TRACK_ALPHA,
  progressPalette,
} from './Progress.metrics';
import { MUI_TYPE } from '../../../tokens/mui-type';
import { alpha } from '../../../tokens/color';
import type { UiPaletteColor, UiTheme } from '../../../tokens/theme';
import type { ColorValue } from '../../../tokens/vocabulary';

/** `0 0 <blur>px <spread>px alpha(main, a)`, the string both renderers write. */
const glowShadow = (
  main: string,
  { blur, spread, alpha: a }: { blur: number; spread: number; alpha: number },
): string => `0 0 ${blur}px ${spread}px ${alpha(main, a)}`;

/** The unfilled track a linear bar runs in. */
export function trackStyle(theme: UiTheme, size: ProgressSize, color: ColorValue): ViewStyle {
  const { height } = PROGRESS_SIZES[size];
  return {
    width: '100%',
    height,
    borderRadius: height / 2,
    backgroundColor: alpha(progressPalette(theme, color).main, TRACK_ALPHA),
    // The bar inherits the track's radius on the web; here it is clipped to it.
    overflow: 'hidden',
  };
}

/**
 * What the web's `barVariantStyles` paint. `gradient` is the one honest gap:
 * React Native core has no gradient fill, so it takes the first stop.
 */
function barPaint(variant: ProgressVariant, palette: UiPaletteColor): ViewStyle {
  switch (variant) {
    case 'gradient':
      return { backgroundColor: palette.main };
    case 'glass':
      return {
        backgroundColor: alpha(palette.main, GLASS_BAR_ALPHA),
        borderWidth: 1,
        borderColor: alpha(palette.main, GLASS_BAR_BORDER_ALPHA),
      };
    default:
      return { backgroundColor: palette.main };
  }
}

/** The bar itself: the variant's paint, the glow, and the height of its track. */
export function barStyle(
  theme: UiTheme,
  a: { variant: ProgressVariant; size: ProgressSize; color: ColorValue; glow: boolean },
): ViewStyle {
  const palette = progressPalette(theme, a.color);
  const { height } = PROGRESS_SIZES[a.size];
  return {
    height: '100%',
    borderRadius: height / 2,
    ...barPaint(a.variant, palette),
    ...(a.glow ? { boxShadow: glowShadow(palette.main, BAR_GLOW) } : {}),
  };
}

/** One segment of the segmented variant: filled with the hue, or a tenth of it. */
export function segmentStyle(
  theme: UiTheme,
  a: { size: ProgressSize; color: ColorValue; filled: boolean; glow: boolean },
): ViewStyle {
  const palette = progressPalette(theme, a.color);
  const { height } = PROGRESS_SIZES[a.size];
  return {
    flex: 1,
    height,
    borderRadius: height / 2,
    backgroundColor: a.filled ? palette.main : alpha(palette.main, TRACK_ALPHA),
    ...(a.glow && a.filled ? { boxShadow: glowShadow(palette.main, SEGMENT_GLOW) } : {}),
  };
}

/** The circular arc's glow: the web's `drop-shadow`, as a box shadow round the dial. */
export function circularGlowStyle(theme: UiTheme, color: ColorValue): ViewStyle {
  const main = progressPalette(theme, color).main;
  return { boxShadow: `0 0 ${CIRCULAR_GLOW.blur}px ${alpha(main, CIRCULAR_GLOW.alpha)}` };
}

/**
 * The label: MUI's `caption` ratios at the size's own step, in semibold. The
 * circular variant sets it in the muted ink, as `color="text.secondary"` does.
 */
export function labelStyle(theme: UiTheme, size: ProgressSize, muted = false): TextStyle {
  const fontSize = PROGRESS_SIZES[size].fontSize;
  const caption = MUI_TYPE.caption;
  return {
    fontFamily: theme.typography.fontFamily,
    fontSize,
    lineHeight: fontSize * caption.lineHeight,
    letterSpacing: fontSize * caption.letterSpacingEm,
    fontWeight: String(LABEL_FONT_WEIGHT) as TextStyle['fontWeight'],
    textAlign: 'center',
    color: muted ? theme.palette.text.secondary : theme.palette.text.primary,
  };
}
