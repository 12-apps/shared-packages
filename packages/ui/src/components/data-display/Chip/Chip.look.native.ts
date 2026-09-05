import type { ImageStyle, TextStyle, ViewStyle } from 'react-native';

import type { ChipColor, ChipVariant } from './Chip.base';
import {
  CHIP_DISABLED_OPACITY,
  CHIP_FONT_SIZE,
  CHIP_RADIUS,
  CHIP_SIZES,
  DELETE_ICON_ALPHA,
  DELETE_ICON_ON_COLOR_ALPHA,
  OUTLINED_BORDER_ALPHA,
  OUTLINED_HOVER_ALPHA,
  type ChipMuiSize,
  type ChipSizeMetrics,
} from './Chip.metrics';
import { alpha } from '../../../tokens/color';
import type { UiTheme } from '../../../tokens/theme';

/** MUI's `action.selectedOpacity`; its hover wash adds `OUTLINED_HOVER_ALPHA` on top. */
const SELECTED_OPACITY = 0.08;

export interface ChipPaint {
  container: ViewStyle;
  /** The web's `:hover` background, which touch has no equivalent of. */
  pressed: ViewStyle;
  label: TextStyle;
  deleteColor: string;
}

/** `neutral` is MUI's `default`: no accent, the ink and the ramp instead. */
const isAccented = (color: ChipColor): boolean => color !== 'neutral';

/** An unaccented chip's hairline, which follows the mode rather than a hue. */
const neutralBorder = (theme: UiTheme): string =>
  theme.mode === 'light' ? theme.palette.grey[400] : theme.palette.grey[700];

function filledPaint(theme: UiTheme, color: ChipColor): ChipPaint {
  if (!isAccented(color)) {
    return {
      container: { backgroundColor: theme.palette.action.selected },
      pressed: { backgroundColor: alpha(theme.palette.action.selected, SELECTED_OPACITY + OUTLINED_HOVER_ALPHA) },
      label: { color: theme.palette.text.primary },
      deleteColor: alpha(theme.palette.text.primary, DELETE_ICON_ALPHA),
    };
  }
  const accent = theme.palette[color];
  return {
    container: { backgroundColor: accent.main },
    pressed: { backgroundColor: accent.dark },
    label: { color: accent.contrastText },
    deleteColor: alpha(accent.contrastText, DELETE_ICON_ON_COLOR_ALPHA),
  };
}

function outlinedPaint(theme: UiTheme, color: ChipColor): ChipPaint {
  const border: ViewStyle = { backgroundColor: 'transparent', borderWidth: 1, borderStyle: 'solid' };
  if (!isAccented(color)) {
    return {
      container: { ...border, borderColor: neutralBorder(theme) },
      pressed: { backgroundColor: theme.palette.action.hover },
      label: { color: theme.palette.text.primary },
      deleteColor: alpha(theme.palette.text.primary, DELETE_ICON_ALPHA),
    };
  }
  const accent = theme.palette[color];
  return {
    container: { ...border, borderColor: alpha(accent.main, OUTLINED_BORDER_ALPHA) },
    pressed: { backgroundColor: alpha(accent.main, OUTLINED_HOVER_ALPHA) },
    label: { color: accent.main },
    deleteColor: alpha(accent.main, OUTLINED_BORDER_ALPHA),
  };
}

/**
 * What MUI's chip paints, as React Native styles. `selected` tints an OUTLINED
 * chip with `action.selected` — a filled one is already solid, which is what
 * `Chip.styles.ts` decided for the web.
 */
export function chipPaint(
  theme: UiTheme,
  variant: ChipVariant,
  color: ChipColor,
  selected: boolean,
): ChipPaint {
  const paint = variant === 'outlined' ? outlinedPaint(theme, color) : filledPaint(theme, color);
  if (variant !== 'outlined' || !selected) return paint;
  return {
    ...paint,
    container: { ...paint.container, backgroundColor: theme.palette.action.selected },
  };
}

/** The pill itself: MUI's height, its 16px radius, and the disabled fade. */
export function chipContainerStyle(metrics: ChipSizeMetrics, disabled: boolean): ViewStyle {
  return {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    maxWidth: '100%',
    height: metrics.height,
    borderRadius: CHIP_RADIUS,
    ...(disabled ? { opacity: CHIP_DISABLED_OPACITY } : {}),
  };
}

/** The label: MUI's 13px, padded by the variant, clipped rather than wrapped. */
export function chipLabelStyle(
  theme: UiTheme,
  metrics: ChipSizeMetrics,
  variant: ChipVariant,
): TextStyle {
  const padding = variant === 'outlined' ? metrics.labelPaddingOutlined : metrics.labelPadding;
  return {
    fontFamily: theme.typography.fontFamily,
    fontSize: CHIP_FONT_SIZE,
    paddingLeft: padding,
    paddingRight: padding,
    flexShrink: 1,
  };
}

/** The margins MUI gives the leading slot, tucking it under the label's padding. */
export function chipLeadingSlotStyle(
  metrics: ChipSizeMetrics,
  variant: ChipVariant,
  slot: 'icon' | 'avatar',
): ViewStyle {
  const outlined = variant === 'outlined';
  const marginLeft =
    slot === 'icon'
      ? (outlined ? metrics.iconMarginLeftOutlined : metrics.iconMarginLeft)
      : (outlined ? metrics.avatarMarginLeftOutlined : metrics.avatarMarginLeft);
  return {
    marginLeft,
    marginRight: slot === 'icon' ? metrics.iconMarginRight : metrics.avatarMarginRight,
    alignItems: 'center',
    justifyContent: 'center',
  };
}

/** The delete glyph's own tuck, one pixel tighter when the chip is outlined. */
export function chipDeleteSlotStyle(metrics: ChipSizeMetrics, variant: ChipVariant): ViewStyle {
  return {
    marginLeft: metrics.deleteMarginLeft,
    marginRight:
      variant === 'outlined' ? metrics.deleteMarginRightOutlined : metrics.deleteMarginRight,
    alignItems: 'center',
    justifyContent: 'center',
  };
}

/** The round avatar box MUI draws for an `avatarSrc`. */
export function chipAvatarStyle(metrics: ChipSizeMetrics): ImageStyle {
  return {
    width: metrics.avatarSize,
    height: metrics.avatarSize,
    borderRadius: metrics.avatarSize / 2,
    overflow: 'hidden',
  };
}

export const chipMetrics = (size: ChipMuiSize): ChipSizeMetrics => CHIP_SIZES[size];
