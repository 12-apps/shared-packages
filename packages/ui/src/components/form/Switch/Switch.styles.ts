import { alpha } from '@mui/material/styles/index.js';
import type { CSSObject, Theme } from '@mui/material/styles/index.js';

import {
  bounceAnimation,
  glowAnimation,
  pulseAnimation,
  rippleAnimation,
  shimmerAnimation,
  spinAnimation,
} from './Switch.animations';
import {
  DISABLED,
  IOS_BASE_OFFSET,
  IOS_THUMB_SHADOW,
  IOS_TRAVEL_INSET,
  SWITCH_GLASS,
  SWITCH_GLOW,
  NEUTRAL_CONTRAST,
  NEUTRAL_FALLBACK,
  NEUTRAL_GREY,
  SWITCH_FOCUS_RING,
  SWITCH_GRADIENT,
  SWITCH_HOVER,
  SWITCH_PULSE,
  SWITCH_RIPPLE,
  SWITCH_SPINNER,
  SWITCH_TRANSITION,
  THUMB_ELEVATION,
  THUMB_RADIUS,
  TRACK_LABEL,
  TRACK_RADIUS,
  geometryOf,
  iosTrackShadow,
  lookOf,
  seconds,
  showsTrackLabels,
  trackColor,
  type SwitchGeometry,
  type SwitchLook,
} from './Switch.metrics';
import type { SwitchVariant } from './Switch.base';

import { px } from '../../../tokens/theme';
import type { ColorValue, SizeValue } from '../../../tokens/vocabulary';

// Every number below comes from `./Switch.metrics`, which the native renderer
// reads too — see its header. The palette and the shadows stay on the MUI
// theme so a host that re-themes either keeps moving the web.
interface ColorPalette {
  main: string;
  dark?: string;
  light?: string;
  contrastText?: string;
}

/** `neutral` is not a MUI palette entry, so it is built from the grey ramp. */
const neutralPalette = (theme: Theme): ColorPalette => ({
  main: theme.palette.grey?.[NEUTRAL_GREY.main] || NEUTRAL_FALLBACK.main,
  dark: theme.palette.grey?.[NEUTRAL_GREY.dark] || NEUTRAL_FALLBACK.dark,
  light: theme.palette.grey?.[NEUTRAL_GREY.light] || NEUTRAL_FALLBACK.light,
  contrastText: NEUTRAL_CONTRAST,
});

/**
 * Resolves a colour name to a full palette, filling any step the theme leaves
 * out from `main` and then from the primary palette. `danger` is this
 * component's name for the error palette; the rest map straight through.
 */
const getColorFromTheme = (theme: Theme, color: string): ColorPalette => {
  if (color === 'neutral') {
    return neutralPalette(theme);
  }

  const colorMap: Record<string, ColorPalette | undefined> = {
    primary: theme.palette.primary,
    secondary: theme.palette.secondary,
    success: theme.palette.success,
    warning: theme.palette.warning,
    info: theme.palette.info,
    danger: theme.palette.error,
  };
  const palette = colorMap[color] ?? theme.palette.primary;
  const { primary } = theme.palette;

  return {
    main: palette.main || primary.main,
    dark: palette.dark || palette.main || primary.dark,
    light: palette.light || palette.main || primary.light,
    contrastText: palette.contrastText || NEUTRAL_CONTRAST,
  };
};

export interface SwitchFlags {
  customVariant?: SwitchVariant;
  customColor?: ColorValue;
  customSize?: SizeValue;
  glow?: boolean;
  glass?: boolean;
  gradient?: boolean;
  trackWidth?: number;
  trackHeight?: number;
  onText?: string;
  offText?: string;
  loading?: boolean;
  ripple?: boolean;
  pulse?: boolean;
}

const thumbShadow = (theme: Theme, look: SwitchLook): string =>
  look === 'ios' ? IOS_THUMB_SHADOW : (theme.shadows[THUMB_ELEVATION[look]] ?? 'none');

/** The ripple that expands from the thumb on hover. */
const rippleOverlay = (palette: ColorPalette): CSSObject => ({
  content: '""',
  position: 'absolute',
  top: '50%',
  left: '50%',
  width: '100%',
  height: '100%',
  borderRadius: '50%',
  background: alpha(palette.main, SWITCH_RIPPLE.alpha),
  animation: `${rippleAnimation} ${seconds(SWITCH_RIPPLE.ms)} ease-out`,
  transform: 'translate(-50%, -50%)',
  pointerEvents: 'none',
});

/** The checked track: the filled bar behind the thumb once the switch is on. */
const checkedTrack = (flags: SwitchFlags, palette: ColorPalette): CSSObject => ({
  backgroundColor: palette.main,
  opacity: 1,
  border: 0,
  position: 'relative',
  overflow: 'hidden',
  ...(flags.glow && {
    animation: `${glowAnimation} ${seconds(SWITCH_GLOW.ms)} ease-in-out infinite`,
    boxShadow: `0 0 ${SWITCH_GLOW.blur}px ${alpha(palette.main, SWITCH_GLOW.alpha)}, inset 0 0 ${SWITCH_GLOW.insetBlur}px ${alpha(palette.main, SWITCH_GLOW.insetAlpha)}`,
  }),
  ...(flags.gradient && {
    background: `linear-gradient(${SWITCH_GRADIENT.checked.angleDeg}deg, ${palette.light || palette.main} ${SWITCH_GRADIENT.checked.stops[0]}%, ${palette.main} ${SWITCH_GRADIENT.checked.stops[1]}%, ${palette.dark || palette.main} ${SWITCH_GRADIENT.checked.stops[2]}%)`,
    backgroundSize: '200% 100%',
    animation: `${shimmerAnimation} ${seconds(SWITCH_GRADIENT.shimmerMs)} ease infinite`,
  }),
});

const switchBaseSx = (
  theme: Theme,
  flags: SwitchFlags,
  palette: ColorPalette,
  geometry: SwitchGeometry,
  look: SwitchLook,
): CSSObject => {
  const { width, thumbSize, padding } = geometry;
  const isIos = look === 'ios';

  return {
    padding,
    margin: 0,
    transitionDuration: `${SWITCH_TRANSITION.ms}ms`,
    transitionTimingFunction: SWITCH_TRANSITION.easing,
    ...(isIos && { transform: `translateX(${IOS_BASE_OFFSET}px)` }),
    '&:hover': {
      '& .MuiSwitch-thumb': {
        transform: flags.loading ? 'none' : `scale(${SWITCH_HOVER.thumbScale})`,
        boxShadow: `${theme.shadows[SWITCH_HOVER.elevation]}, 0 0 ${SWITCH_HOVER.blur}px ${alpha(palette.main, SWITCH_HOVER.alpha)}`,
      },
      ...(flags.ripple && { '&::after': rippleOverlay(palette) }),
    },
    '&.Mui-checked': {
      // The thumb travels the track minus its own width and both paddings; the
      // iOS look insets differently, so it gets its own distance.
      transform: `translateX(${width - thumbSize - padding * 2}px)`,
      color: '#fff',
      '& .MuiSwitch-thumb': {
        animation: flags.loading ? 'none' : `${bounceAnimation} ${seconds(SWITCH_TRANSITION.ms)} ease-out`,
      },
      '& + .MuiSwitch-track': checkedTrack(flags, palette),
      '&.Mui-disabled + .MuiSwitch-track': { opacity: DISABLED.checkedTrackOpacity },
      ...(isIos && { transform: `translateX(${width - thumbSize - IOS_TRAVEL_INSET}px)` }),
    },
    '&.Mui-focusVisible .MuiSwitch-thumb': {
      color: palette.main,
      border: `${SWITCH_FOCUS_RING.width}px solid ${alpha(palette.main, SWITCH_FOCUS_RING.alpha)}`,
    },
    '&.Mui-disabled .MuiSwitch-thumb': { color: theme.palette.grey[DISABLED.thumbGrey] },
    '&.Mui-disabled + .MuiSwitch-track': { opacity: DISABLED.trackOpacity },
  };
};

const thumbSx = (
  theme: Theme,
  flags: SwitchFlags,
  palette: ColorPalette,
  thumbSize: number,
  look: SwitchLook,
): CSSObject => ({
  width: thumbSize,
  height: thumbSize,
  borderRadius: THUMB_RADIUS[look](thumbSize),
  backgroundColor: '#fff',
  boxShadow: thumbShadow(theme, look),
  transition: `all ${seconds(SWITCH_TRANSITION.ms)} ${SWITCH_TRANSITION.easing}`,
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  ...(flags.glass && {
    backgroundColor: alpha(theme.palette.background.paper, SWITCH_GLASS.thumbAlpha),
    backdropFilter: `blur(${SWITCH_GLASS.thumbBlur}px)`,
    border: `1px solid ${alpha(theme.palette.divider, SWITCH_GLASS.borderAlpha)}`,
  }),
  ...(flags.pulse && { animation: `${pulseAnimation} ${seconds(SWITCH_PULSE.ms)} ease-in-out infinite` }),
  ...(flags.loading && {
    // A spinner drawn inside the thumb rather than over the whole control.
    '&::after': {
      content: '""',
      position: 'absolute',
      width: thumbSize * SWITCH_SPINNER.sizeRatio,
      height: thumbSize * SWITCH_SPINNER.sizeRatio,
      border: `${SWITCH_SPINNER.borderWidth}px solid ${palette.main}`,
      borderTop: `${SWITCH_SPINNER.borderWidth}px solid transparent`,
      borderRadius: '50%',
      animation: `${spinAnimation} ${seconds(SWITCH_SPINNER.ms)} linear infinite`,
    },
  }),
  ...(look === 'material' && {
    '&::before': {
      content: '""',
      position: 'absolute',
      width: '100%',
      height: '100%',
      borderRadius: 'inherit',
      backgroundColor: palette.main,
      opacity: 0,
      transform: 'scale(0)',
      transition: 'all 0.3s ease',
    },
  }),
});

/** The on/off wording the `label` variant prints inside the track. */
const trackLabels = (theme: Theme, onText?: string, offText?: string): CSSObject => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingLeft: theme.spacing(TRACK_LABEL.insetUnits),
  paddingRight: theme.spacing(TRACK_LABEL.insetUnits),
  fontSize: px(TRACK_LABEL.fontSize),
  fontWeight: TRACK_LABEL.fontWeight,
  color: theme.palette.text.secondary,
  '&::before, &::after': {
    content: '""',
    position: 'absolute',
    fontSize: px(TRACK_LABEL.fontSize),
    fontWeight: TRACK_LABEL.fontWeight,
    top: '50%',
    transform: 'translateY(-50%)',
    zIndex: 1,
  },
  ...(onText && {
    '&::before': { content: `"${onText}"`, left: theme.spacing(TRACK_LABEL.insetUnits), color: '#fff' },
  }),
  ...(offText && {
    '&::after': {
      content: `"${offText}"`,
      right: theme.spacing(TRACK_LABEL.insetUnits),
      color: theme.palette.text.secondary,
    },
  }),
});

const trackSx = (
  theme: Theme,
  flags: SwitchFlags,
  palette: ColorPalette,
  height: number,
  look: SwitchLook,
): CSSObject => {
  const { glass, gradient, onText, offText, customVariant } = flags;

  return {
    borderRadius: TRACK_RADIUS[look](height),
    backgroundColor: trackColor(
      { black: theme.palette.common.black, disabled: theme.palette.action.disabled },
      look,
    ),
    opacity: 1,
    transition: `all ${seconds(SWITCH_TRANSITION.ms)} ${SWITCH_TRANSITION.easing}`,
    position: 'relative',
    boxShadow: look === 'ios' ? iosTrackShadow() : 'none',
    ...(glass && {
      backgroundColor: alpha(theme.palette.background.paper, SWITCH_GLASS.trackAlpha),
      backdropFilter: `blur(${SWITCH_GLASS.trackBlur}px)`,
      border: `1px solid ${alpha(theme.palette.divider, SWITCH_GLASS.borderAlpha)}`,
    }),
    ...(gradient &&
      !glass && {
        background: `linear-gradient(${SWITCH_GRADIENT.resting.angleDeg}deg, ${alpha(palette.light || palette.main, SWITCH_GRADIENT.resting.lightAlpha)}, ${alpha(palette.main, SWITCH_GRADIENT.resting.mainAlpha)})`,
      }),
    ...(showsTrackLabels(customVariant, onText, offText) && trackLabels(theme, onText, offText)),
  };
};

export const switchSx = (theme: Theme, flags: SwitchFlags): CSSObject => {
  const palette = getColorFromTheme(theme, flags.customColor ?? 'primary');
  const geometry = geometryOf(flags.customSize, flags.trackWidth, flags.trackHeight);
  const look = lookOf(flags.customVariant);

  return {
    width: geometry.width,
    height: geometry.height,
    padding: 0,
    overflow: 'visible',
    '& .MuiSwitch-switchBase': switchBaseSx(theme, flags, palette, geometry, look),
    '& .MuiSwitch-thumb': thumbSx(theme, flags, palette, geometry.thumbSize, look),
    '& .MuiSwitch-track': trackSx(theme, flags, palette, geometry.height, look),
  };
};
