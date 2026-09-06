import type { TextStyle, ViewStyle } from 'react-native';

import type { BadgePosition, BadgeSize, BadgeVariant } from './Badge.base';
import {
  BADGE_BORDER_WIDTH,
  BADGE_DESTRUCTIVE_FONT_WEIGHT,
  BADGE_FONT_WEIGHT,
  BADGE_LETTER_SPACING_EM,
  BADGE_SIZES,
  GLASS_BACKGROUND_ALPHA,
  GLASS_BORDER_ALPHA,
  GLOW,
  OUTLINE_BORDER_WIDTH,
  SECONDARY_BACKGROUND_ALPHA,
  SECONDARY_BORDER_ALPHA,
  badgeAnchor,
  badgePalette,
  type BadgeSizeMetrics,
} from './Badge.metrics';
import { alpha } from '../../../tokens/color';
import type { UiPaletteColor, UiTheme } from '../../../tokens/theme';
import type { ColorValue } from '../../../tokens/vocabulary';

export interface BadgePaint {
  box: ViewStyle;
  ink: string;
  fontWeight: number;
  /** `gradient` and `glass` shout; everything else is set as written. */
  uppercase: boolean;
}

/** The chip a variant paints, as React Native styles. */
function variantPaint(
  theme: UiTheme,
  variant: BadgeVariant,
  accent: UiPaletteColor,
): BadgePaint {
  const filled = (background: string, ink: string): BadgePaint => ({
    box: { backgroundColor: background },
    ink,
    fontWeight: BADGE_FONT_WEIGHT,
    uppercase: false,
  });
  switch (variant) {
    case 'gradient':
      // React Native core has no gradient fill: the 135° run takes its first stop.
      return { ...filled(accent.main, '#fff'), uppercase: true };
    case 'glass':
      return {
        box: {
          backgroundColor: alpha(accent.main, GLASS_BACKGROUND_ALPHA),
          borderWidth: 1,
          borderColor: alpha(accent.main, GLASS_BORDER_ALPHA),
        },
        ink: accent.main,
        fontWeight: BADGE_FONT_WEIGHT,
        uppercase: true,
      };
    case 'outline':
      return {
        box: {
          backgroundColor: 'transparent',
          borderWidth: OUTLINE_BORDER_WIDTH,
          borderColor: accent.main,
        },
        ink: accent.main,
        fontWeight: BADGE_FONT_WEIGHT,
        uppercase: false,
      };
    case 'secondary':
      return {
        box: {
          backgroundColor: alpha(accent.main, SECONDARY_BACKGROUND_ALPHA),
          borderWidth: 1,
          borderColor: alpha(accent.main, SECONDARY_BORDER_ALPHA),
        },
        ink: accent.main,
        fontWeight: BADGE_FONT_WEIGHT,
        uppercase: false,
      };
    case 'destructive':
      return {
        ...filled(theme.palette.danger.main, theme.palette.danger.contrastText),
        fontWeight: BADGE_DESTRUCTIVE_FONT_WEIGHT,
      };
    case 'success':
      return filled(theme.palette.success.main, theme.palette.success.contrastText);
    case 'warning':
      return filled(theme.palette.warning.main, theme.palette.warning.contrastText);
    default:
      return filled(accent.main, accent.contrastText || '#fff');
  }
}

export interface BadgeBoxArgs {
  variant: BadgeVariant;
  size: BadgeSize;
  color: ColorValue;
  glow: boolean;
}

/**
 * Where the chip hangs: MUI's `anchorOrigin` pins it to a corner and then
 * `translate(±50%, ∓50%)` puts its CENTRE there. It is its own node so the
 * chip's animations own `transform` outright — a React Native style array
 * replaces that property rather than composing it, as CSS would.
 */
export function badgeAnchorStyle(position: BadgePosition): ViewStyle {
  const anchor = badgeAnchor(position);
  return {
    position: 'absolute',
    [anchor.vertical]: 0,
    [anchor.horizontal]: 0,
    transform: [
      { translateX: anchor.horizontal === 'right' ? '50%' : '-50%' },
      { translateY: anchor.vertical === 'top' ? '-50%' : '50%' },
    ],
  };
}

/** The chip itself: MUI's paper ring, its size, and the variant's paint. */
export function badgeBoxStyle(theme: UiTheme, a: BadgeBoxArgs): ViewStyle {
  const metrics = BADGE_SIZES[a.size];
  const accent = badgePalette(theme, a.color);
  const paint = variantPaint(theme, a.variant, accent);
  const dot = a.variant === 'dot';

  return {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: BADGE_BORDER_WIDTH,
    borderColor: theme.palette.background.paper,
    ...(dot
      ? {
          width: metrics.dotSize,
          height: metrics.dotSize,
          minWidth: metrics.dotSize,
          borderRadius: metrics.dotSize / 2,
          backgroundColor: accent.main,
        }
      : {
          minWidth: metrics.minWidth,
          height: metrics.height,
          paddingHorizontal: metrics.paddingHorizontal,
          borderRadius: metrics.height / 2,
          ...paint.box,
        }),
    ...(a.glow
      ? { boxShadow: `0 0 ${GLOW.blur}px ${GLOW.spread}px ${alpha(accent.main, GLOW.alpha)}` }
      : {}),
  };
}

/** The chip's own type: the size's step, semibold, tracked a little wider. */
export function badgeTextStyle(
  theme: UiTheme,
  variant: BadgeVariant,
  size: BadgeSize,
  color: ColorValue,
): TextStyle {
  const metrics = BADGE_SIZES[size];
  const paint = variantPaint(theme, variant, badgePalette(theme, color));
  return {
    fontFamily: theme.typography.fontFamily,
    fontSize: metrics.fontSize,
    fontWeight: String(paint.fontWeight) as TextStyle['fontWeight'],
    letterSpacing: metrics.fontSize * BADGE_LETTER_SPACING_EM,
    color: paint.ink,
    ...(paint.uppercase ? { textTransform: 'uppercase' } : {}),
  };
}

export const badgeMetrics = (size: BadgeSize): BadgeSizeMetrics => BADGE_SIZES[size];
