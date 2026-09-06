import type { TextStyle, ViewStyle } from 'react-native';

import type { AvatarSize, AvatarVariant } from './Avatar.base';
import {
  AVATAR_SIZES,
  BORDER_HALO_ALPHA,
  BORDER_WIDTH,
  GLOW,
  LOADING_OVERLAY,
  ROUNDED_RADIUS_UNITS,
  SPINNER,
  STATUS_DOT,
  avatarAccent,
} from './Avatar.metrics';
import { alpha } from '../../../tokens/color';
import type { UiTheme } from '../../../tokens/theme';
import type { ColorValue } from '../../../tokens/vocabulary';

/** `square` is sharp, `rounded` takes a spacing unit, `circle` and `status` are round. */
export function avatarRadius(theme: UiTheme, variant: AvatarVariant, box: number): number {
  if (variant === 'square') return 0;
  if (variant === 'rounded') return theme.spacing(ROUNDED_RADIUS_UNITS);
  return box / 2;
}

export interface AvatarSurfaceArgs {
  variant: AvatarVariant;
  size: AvatarSize;
  color: ColorValue;
  glow: boolean;
  bordered: boolean;
  interactive: boolean;
  hasError: boolean;
}

/** The avatar box: MUI's square, its radius, the accent behind the initials. */
export function avatarSurfaceStyle(theme: UiTheme, a: AvatarSurfaceArgs): ViewStyle {
  const { box } = AVATAR_SIZES[a.size];
  const accent = avatarAccent(theme, a.color);
  return {
    width: box,
    height: box,
    borderRadius: avatarRadius(theme, a.variant, box),
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: a.hasError ? theme.palette.danger.main : accent.main,
    cursor: a.interactive ? 'pointer' : 'auto',
    ...(a.bordered
      ? {
          borderWidth: BORDER_WIDTH,
          borderColor: theme.palette.background.paper,
          boxShadow: `0 0 0 1px ${alpha(theme.palette.divider, BORDER_HALO_ALPHA)}`,
        }
      : {}),
    ...(a.glow
      ? { boxShadow: `0 0 ${GLOW.blur}px ${GLOW.spread}px ${alpha(accent.main, GLOW.alpha)}` }
      : {}),
  };
}

/** The initials, in the accent's contrast ink at the size's own step. */
export function avatarTextStyle(
  theme: UiTheme,
  size: AvatarSize,
  color: ColorValue,
  hasError: boolean,
): TextStyle {
  const accent = avatarAccent(theme, color);
  return {
    fontFamily: theme.typography.fontFamily,
    fontSize: AVATAR_SIZES[size].fontSize,
    textAlign: 'center',
    color: hasError ? theme.palette.danger.contrastText : accent.contrastText,
  };
}

/** The wash over a loading avatar, and the ring spinning in it. */
export function avatarLoadingStyle(theme: UiTheme, size: AvatarSize, radius: number): ViewStyle {
  const { box } = AVATAR_SIZES[size];
  return {
    position: 'absolute',
    top: 0,
    left: 0,
    width: box,
    height: box,
    borderRadius: radius,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha(theme.palette.background.paper, LOADING_OVERLAY.paperAlpha),
  };
}

export function avatarSpinnerStyle(theme: UiTheme, size: AvatarSize): ViewStyle {
  const ring = AVATAR_SIZES[size].box * SPINNER.scale;
  return {
    width: ring,
    height: ring,
    borderRadius: ring / 2,
    borderWidth: SPINNER.ringWidth,
    borderColor: alpha(theme.palette.primary.main, SPINNER.trackAlpha),
    borderTopColor: theme.palette.primary.main,
  };
}

/** MUI's `Badge` dot, anchored bottom-right of a circular avatar. */
export function avatarStatusDotStyle(theme: UiTheme, size: AvatarSize, color: string): ViewStyle {
  const { box } = AVATAR_SIZES[size];
  const dot = Math.max(STATUS_DOT.min, box * STATUS_DOT.scale);
  // MUI's `overlap="circular"` puts the dot's centre 14% in from the corner.
  const inset = box * STATUS_DOT.anchor - dot / 2;
  return {
    position: 'absolute',
    right: inset,
    bottom: inset,
    width: dot,
    height: dot,
    borderRadius: dot / 2,
    backgroundColor: color,
    borderWidth: STATUS_DOT.borderWidth,
    borderColor: theme.palette.background.paper,
  };
}
