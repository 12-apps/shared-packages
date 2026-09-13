import type { TextStyle, ViewStyle } from 'react-native';

import type { SwitchBaseProps } from './Switch.base';
import {
  DISABLED,
  IOS_THUMB_SHADOW,
  MUI_SHADOWS,
  NEUTRAL_CONTRAST,
  RESTING_THUMB,
  NEUTRAL_FALLBACK,
  NEUTRAL_GREY,
  SWITCH_BLACK,
  SWITCH_DESCRIPTION,
  SWITCH_GLASS,
  SWITCH_GLOW,
  SWITCH_GRADIENT,
  SWITCH_HELPER,
  SWITCH_LABEL,
  THUMB_ELEVATION,
  TRACK_RADIUS,
  thumbRadius,
  trackColor,
  type SwitchGeometry,
  type SwitchLook,
} from './Switch.metrics';
import { alpha } from '../../../tokens/color';
import { inkOver } from '../../../tokens/theme';
import type { UiTheme } from '../../../tokens/theme';
import type { ColorValue } from '../../../tokens/vocabulary';

/**
 * WHAT A NATIVE `Switch` PAINTS.
 *
 * The web hands MUI's `Switch` a style object and MUI draws the track and the
 * thumb; React Native has no such control at this size, so the native half
 * draws both itself — from this file, off the same table.
 */
export interface SwitchPalette {
  main: string;
  dark: string;
  light: string;
  contrastText: string;
}

export interface SwitchState {
  checked: boolean;
  disabled: boolean;
}

/** The web's `getColorFromTheme`: `danger` is the error palette, `neutral` three greys. */
export function switchPalette(theme: UiTheme, color: ColorValue): SwitchPalette {
  if (color === 'neutral') {
    return {
      main: theme.palette.grey[NEUTRAL_GREY.main] || NEUTRAL_FALLBACK.main,
      dark: theme.palette.grey[NEUTRAL_GREY.dark] || NEUTRAL_FALLBACK.dark,
      light: theme.palette.grey[NEUTRAL_GREY.light] || NEUTRAL_FALLBACK.light,
      contrastText: NEUTRAL_CONTRAST,
    };
  }
  const palette = theme.palette[color];
  return {
    main: palette.main,
    dark: palette.dark,
    light: palette.light,
    contrastText: palette.contrastText || NEUTRAL_CONTRAST,
  };
}

/** Which of the switch's own flags change how it paints. */
export type SwitchFlagKeys = 'glow' | 'glass' | 'gradient' | 'loading' | 'pulse';
export type SwitchPaint = Pick<SwitchBaseProps, SwitchFlagKeys>;

/**
 * The bar behind the thumb.
 *
 * `gradient` paints the gradient's FIRST stop flat — React Native core has no
 * gradient fill — and `glass` its paper wash without the blur.
 */
export function trackStyle(
  theme: UiTheme,
  paint: SwitchPaint,
  palette: SwitchPalette,
  geometry: SwitchGeometry,
  look: SwitchLook,
  state: SwitchState,
): ViewStyle {
  const base: ViewStyle = {
    ...StyleSheetAbsoluteFill,
    borderRadius: TRACK_RADIUS[look](geometry.height),
    backgroundColor: state.checked
      ? palette.main
      : trackColor({ black: SWITCH_BLACK, disabled: theme.palette.action.disabled }, look),
    opacity: disabledTrackOpacity(state),
  };

  if (paint.glass) {
    return {
      ...base,
      backgroundColor: alpha(theme.palette.background.paper, SWITCH_GLASS.trackAlpha),
      borderWidth: 1,
      borderColor: alpha(theme.palette.divider, SWITCH_GLASS.borderAlpha),
    };
  }
  if (paint.gradient) {
    return { ...base, backgroundColor: gradientFirstStop(palette, state.checked) };
  }
  if (paint.glow && state.checked) {
    return {
      ...base,
      boxShadow: `0 0 ${SWITCH_GLOW.blur}px ${alpha(palette.main, SWITCH_GLOW.alpha)}, inset 0 0 ${SWITCH_GLOW.insetBlur}px ${alpha(palette.main, SWITCH_GLOW.insetAlpha)}`,
    };
  }
  return base;
}

/**
 * The ink on the CHECKED track — the thumb, and the `on` wording (FUT-1924).
 *
 * The web's `checkedInk`, over the fills THIS renderer paints: the checked
 * track is `palette.main`, or `light → main` under `gradient`. Both halves of
 * the component had a stated `#fff` here, and the checked track is the one
 * surface a tenant chooses — a pale brand got a white knob on a pale bar, which
 * reads as OFF while it is on.
 */
export function checkedInk(paint: SwitchPaint, palette: SwitchPalette): string {
  const fills = paint.gradient ? [palette.light || palette.main, palette.main] : [palette.main];

  return inkOver(fills, palette.contrastText || NEUTRAL_CONTRAST);
}

/** The web's two gradients, at the stop a flat fill can show. */
function gradientFirstStop(palette: SwitchPalette, checked: boolean): string {
  if (checked) return palette.light || palette.main;
  return alpha(palette.light || palette.main, SWITCH_GRADIENT.resting.lightAlpha);
}

const disabledTrackOpacity = (state: SwitchState): number => {
  if (!state.disabled) return 1;
  return state.checked ? DISABLED.checkedTrackOpacity : DISABLED.trackOpacity;
};

/** React Native has no `StyleSheet.absoluteFillObject` constant worth importing for four keys. */
const StyleSheetAbsoluteFill = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;

/** Disabled greys out; checked takes the track's ink; resting stays white. */
function thumbFill(
  paint: SwitchPaint,
  palette: SwitchPalette,
  state: SwitchState,
  theme: UiTheme,
): string {
  if (state.disabled) return theme.palette.grey[DISABLED.thumbGrey] ?? RESTING_THUMB;
  return state.checked ? checkedInk(paint, palette) : RESTING_THUMB;
}

/**
 * The knob: round for iOS and the default, squarer for Android and Material.
 * White while resting, the checked track's own ink once on — see
 * {@link RESTING_THUMB} and {@link checkedInk}.
 */
export function thumbStyle(
  theme: UiTheme,
  paint: SwitchPaint,
  palette: SwitchPalette,
  geometry: SwitchGeometry,
  look: SwitchLook,
  state: SwitchState,
): ViewStyle {
  const base: ViewStyle = {
    position: 'absolute',
    width: geometry.thumbSize,
    height: geometry.thumbSize,
    borderRadius: thumbRadius(look, geometry.thumbSize),
    backgroundColor: thumbFill(paint, palette, state, theme),
    boxShadow: look === 'ios' ? IOS_THUMB_SHADOW : (MUI_SHADOWS[THUMB_ELEVATION[look]] ?? 'none'),
    alignItems: 'center',
    justifyContent: 'center',
  };

  if (!paint.glass) return base;
  return {
    ...base,
    backgroundColor: alpha(theme.palette.background.paper, SWITCH_GLASS.thumbAlpha),
    borderWidth: 1,
    borderColor: alpha(theme.palette.divider, SWITCH_GLASS.borderAlpha),
  };
}

/** MUI's `body2` at 500, in the error hue when the row is in error. */
export function labelTextStyle(theme: UiTheme, error: boolean): TextStyle {
  return {
    color: error ? theme.palette.danger.main : theme.palette.text.primary,
    fontFamily: theme.typography.fontFamily,
    fontSize: SWITCH_LABEL.fontSize,
    lineHeight: SWITCH_LABEL.fontSize * SWITCH_LABEL.lineHeight,
    fontWeight: String(SWITCH_LABEL.fontWeight) as TextStyle['fontWeight'],
  };
}

/** MUI's `caption`, 4px under the label. */
export function descriptionTextStyle(theme: UiTheme, error: boolean): TextStyle {
  return {
    color: error ? theme.palette.danger.main : theme.palette.text.secondary,
    fontFamily: theme.typography.fontFamily,
    fontSize: SWITCH_DESCRIPTION.fontSize,
    lineHeight: SWITCH_DESCRIPTION.fontSize * SWITCH_DESCRIPTION.lineHeight,
    marginTop: theme.spacing(SWITCH_DESCRIPTION.marginTopUnits),
  };
}

/** `FormHelperText`, 8px under the whole control. */
export function helperTextStyle(theme: UiTheme, error: boolean): TextStyle {
  return {
    color: error ? theme.palette.danger.main : theme.palette.text.secondary,
    fontFamily: theme.typography.fontFamily,
    fontSize: SWITCH_HELPER.fontSize,
    lineHeight: SWITCH_HELPER.fontSize * SWITCH_HELPER.lineHeight,
    marginTop: theme.spacing(SWITCH_HELPER.marginTopUnits),
  };
}
