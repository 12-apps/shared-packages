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
  IOS_TRAVEL_INSET,
  SWITCH_GLASS,
  SWITCH_GLOW,
  NEUTRAL_CONTRAST,
  SWITCH_FOCUS_RING,
  SWITCH_GRADIENT,
  SWITCH_HOVER,
  SWITCH_PULSE,
  SWITCH_RIPPLE,
  SWITCH_SPINNER,
  SWITCH_TRANSITION,
  RESTING_THUMB,
  THUMB_ELEVATION,
  THUMB_RADIUS,
  TRACK_LABEL,
  TRACK_RADIUS,
  geometryOf,
  iosThumbShadow,
  iosTrackShadow,
  lookOf,
  seconds,
  showsTrackLabels,
  trackColor,
  type SwitchGeometry,
  type SwitchLook,
} from './Switch.metrics';
import type { SwitchVariant } from './Switch.base';

import { absoluteInk, controlNeutral, neutralTones } from '../../../tokens/ink';
import { rem } from '../../../tokens/relative';
import { inkOver } from '../../../tokens/theme';
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

/** `neutral` is not a MUI palette entry, so it is the controls' neutral tone. */
const neutralPalette = (theme: Theme): ColorPalette => controlNeutral(theme);

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

/** A metrics radius on the web: its px through the type scale, a percentage as-is. */
const lengthOrPercent = (theme: Theme, value: number | string): string =>
  typeof value === 'number' ? rem(theme, value) : value;

const thumbShadow = (theme: Theme, look: SwitchLook): string =>
  look === 'ios'
    ? iosThumbShadow((px) => rem(theme, px))
    : (theme.shadows[THUMB_ELEVATION[look]] ?? 'none');

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

/**
 * The ink on the CHECKED track — the thumb, the `on` wording and any on-icon
 * (FUT-1924).
 *
 * All three stated `#fff`, and the checked track is `palette.main`: the one
 * surface in this component the TENANT picks. A store with a pale brand got a
 * white thumb on a pale green bar, which does not read as a knob at all — the
 * switch looks OFF while it is on, so this is a state a user misreads rather
 * than a colour they dislike.
 *
 * The `gradient` flag paints the track `light → main → dark`, so the fills the
 * thumb travels over are handed over together and {@link inkOver} takes the
 * worst of them.
 *
 * The RESTING track is not here on purpose: it is `theme.palette.action.disabled`
 * washed over the page, which no tenant chooses, and a white thumb on it is the
 * conventional look in both modes.
 */
const checkedInk = (flags: SwitchFlags, palette: ColorPalette): string => {
  const fills = flags.gradient
    ? [palette.light || palette.main, palette.main, palette.dark || palette.main]
    : [palette.main];

  return inkOver(fills, palette.contrastText || NEUTRAL_CONTRAST);
};

/** The checked track: the filled bar behind the thumb once the switch is on. */
const checkedTrack = (theme: Theme, flags: SwitchFlags, palette: ColorPalette): CSSObject => ({
  backgroundColor: palette.main,
  opacity: 1,
  border: 0,
  position: 'relative',
  overflow: 'hidden',
  ...(flags.glow && {
    animation: `${glowAnimation(theme)} ${seconds(SWITCH_GLOW.ms)} ease-in-out infinite`,
    boxShadow: `0 0 ${rem(theme, SWITCH_GLOW.blur)} ${alpha(palette.main, SWITCH_GLOW.alpha)}, inset 0 0 ${rem(theme, SWITCH_GLOW.insetBlur)} ${alpha(palette.main, SWITCH_GLOW.insetAlpha)}`,
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
    padding: rem(theme, padding),
    margin: 0,
    transitionDuration: `${SWITCH_TRANSITION.ms}ms`,
    transitionTimingFunction: SWITCH_TRANSITION.easing,
    ...(isIos && { transform: `translateX(${rem(theme, IOS_BASE_OFFSET)})` }),
    '&:hover': {
      '& .MuiSwitch-thumb': {
        transform: flags.loading ? 'none' : `scale(${SWITCH_HOVER.thumbScale})`,
        boxShadow: `${theme.shadows[SWITCH_HOVER.elevation]}, 0 0 ${rem(theme, SWITCH_HOVER.blur)} ${alpha(palette.main, SWITCH_HOVER.alpha)}`,
      },
      ...(flags.ripple && { '&::after': rippleOverlay(palette) }),
    },
    '&.Mui-checked': {
      // The thumb travels the track minus its own width and both paddings; the
      // iOS look insets differently, so it gets its own distance.
      transform: `translateX(${rem(theme, width - thumbSize - padding * 2)})`,
      color: checkedInk(flags, palette),
      '& .MuiSwitch-thumb': {
        animation: flags.loading ? 'none' : `${bounceAnimation} ${seconds(SWITCH_TRANSITION.ms)} ease-out`,
        /*
          GLASS KEEPS ITS WASH AND GAINS AN OUTLINE (FUT-2067).

          It used to keep the wash and nothing else, on the argument that a
          translucent thumb MEANS to show the track through itself, so painting
          it opaque would be repainting the variant rather than fixing it. The
          first half of that is still true and this still does not touch the
          fill. The second half was doing more work than the number supports:
          `SWITCH_GLASS.thumbAlpha` is **0.9**, so nine parts in ten of the knob
          are `background.paper` and one part is the track. On a pale brand that
          composites to within about 1.1:1 of the bar it is sitting on — the
          same "reads as OFF while it is on" state FUT-1924 exists for, in the
          one variant whose own argument points AT the tenant-controlled
          surface.

          So the separation moves to the EDGE, which is the thing a glass
          surface is allowed to have. The colour is {@link checkedInk} — the
          same derivation the opaque thumb gets, so there is one rule for "what
          reads on this track" rather than two — at full strength rather than
          the `divider` hairline at `borderAlpha` 0.2 the resting thumb wears,
          which on a pale track is not an outline at all.

          Checked only. The resting track is `action.disabled` washed over the
          page, which no tenant chooses, so the quiet hairline stays right
          there — the same split {@link checkedInk}'s own docblock makes.
        */
        ...(flags.glass
          ? { borderColor: checkedInk(flags, palette) }
          : { backgroundColor: checkedInk(flags, palette) }),
      },
      '& + .MuiSwitch-track': checkedTrack(theme, flags, palette),
      '&.Mui-disabled + .MuiSwitch-track': { opacity: DISABLED.checkedTrackOpacity },
      ...(isIos && { transform: `translateX(${rem(theme, width - thumbSize - IOS_TRAVEL_INSET)})` }),
    },
    '&.Mui-focusVisible .MuiSwitch-thumb': {
      color: palette.main,
      border: `${rem(theme, SWITCH_FOCUS_RING.width)} solid ${alpha(palette.main, SWITCH_FOCUS_RING.alpha)}`,
    },
    '&.Mui-disabled .MuiSwitch-thumb': { color: neutralTones(theme).surface },
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
  width: rem(theme, thumbSize),
  height: rem(theme, thumbSize),
  borderRadius: lengthOrPercent(theme, THUMB_RADIUS[look](thumbSize)),
  // `.Mui-checked` above replaces this for the brand-filled track; see
  // {@link RESTING_THUMB} for why the resting one stays white.
  backgroundColor: RESTING_THUMB,
  boxShadow: thumbShadow(theme, look),
  transition: `all ${seconds(SWITCH_TRANSITION.ms)} ${SWITCH_TRANSITION.easing}`,
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  ...(flags.glass && {
    backgroundColor: alpha(theme.palette.background.paper, SWITCH_GLASS.thumbAlpha),
    backdropFilter: `blur(${rem(theme, SWITCH_GLASS.thumbBlur)})`,
    border: `1px solid ${alpha(theme.palette.divider, SWITCH_GLASS.borderAlpha)}`,
  }),
  ...(flags.pulse && { animation: `${pulseAnimation} ${seconds(SWITCH_PULSE.ms)} ease-in-out infinite` }),
  ...(flags.loading && {
    // A spinner drawn inside the thumb rather than over the whole control.
    '&::after': {
      content: '""',
      position: 'absolute',
      width: rem(theme, thumbSize * SWITCH_SPINNER.sizeRatio),
      height: rem(theme, thumbSize * SWITCH_SPINNER.sizeRatio),
      border: `${rem(theme, SWITCH_SPINNER.borderWidth)} solid ${palette.main}`,
      borderTop: `${rem(theme, SWITCH_SPINNER.borderWidth)} solid transparent`,
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
const trackLabels = (
  theme: Theme,
  flags: SwitchFlags,
  palette: ColorPalette,
  onText?: string,
  offText?: string,
): CSSObject => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingLeft: theme.spacing(TRACK_LABEL.insetUnits),
  paddingRight: theme.spacing(TRACK_LABEL.insetUnits),
  fontSize: rem(theme, TRACK_LABEL.fontSize),
  fontWeight: TRACK_LABEL.fontWeight,
  color: theme.palette.text.secondary,
  '&::before, &::after': {
    content: '""',
    position: 'absolute',
    fontSize: rem(theme, TRACK_LABEL.fontSize),
    fontWeight: TRACK_LABEL.fontWeight,
    top: '50%',
    transform: 'translateY(-50%)',
    zIndex: 1,
  },
  ...(onText && {
    '&::before': {
      content: `"${onText}"`,
      left: theme.spacing(TRACK_LABEL.insetUnits),
      // The `on` word sits at the end the thumb travels TO, which is the
      // filled half of the track once checked.
      color: checkedInk(flags, palette),
    },
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
    borderRadius: rem(theme, TRACK_RADIUS[look](height)),
    backgroundColor: trackColor(
      { black: absoluteInk(theme).black, disabled: theme.palette.action.disabled },
      look,
    ),
    opacity: 1,
    transition: `all ${seconds(SWITCH_TRANSITION.ms)} ${SWITCH_TRANSITION.easing}`,
    position: 'relative',
    boxShadow: look === 'ios' ? iosTrackShadow((px) => rem(theme, px)) : 'none',
    ...(glass && {
      backgroundColor: alpha(theme.palette.background.paper, SWITCH_GLASS.trackAlpha),
      backdropFilter: `blur(${rem(theme, SWITCH_GLASS.trackBlur)})`,
      border: `1px solid ${alpha(theme.palette.divider, SWITCH_GLASS.borderAlpha)}`,
    }),
    ...(gradient &&
      !glass && {
        background: `linear-gradient(${SWITCH_GRADIENT.resting.angleDeg}deg, ${alpha(palette.light || palette.main, SWITCH_GRADIENT.resting.lightAlpha)}, ${alpha(palette.main, SWITCH_GRADIENT.resting.mainAlpha)})`,
      }),
    ...(showsTrackLabels(customVariant, onText, offText) &&
      trackLabels(theme, flags, palette, onText, offText)),
  };
};

/**
 * The same checked-track ink, for the two ICONS the control overlays on the
 * track — which are drawn as components rather than styles, so they cannot
 * reach {@link checkedInk} directly.
 */
export const onTrackInk = (theme: Theme, flags: SwitchFlags): string =>
  checkedInk(flags, getColorFromTheme(theme, flags.customColor ?? 'primary'));

export const switchSx = (theme: Theme, flags: SwitchFlags): CSSObject => {
  const palette = getColorFromTheme(theme, flags.customColor ?? 'primary');
  const geometry = geometryOf(flags.customSize, flags.trackWidth, flags.trackHeight);
  const look = lookOf(flags.customVariant);

  return {
    width: rem(theme, geometry.width),
    height: rem(theme, geometry.height),
    padding: 0,
    overflow: 'visible',
    '& .MuiSwitch-switchBase': switchBaseSx(theme, flags, palette, geometry, look),
    '& .MuiSwitch-thumb': thumbSx(theme, flags, palette, geometry.thumbSize, look),
    '& .MuiSwitch-track': trackSx(theme, flags, palette, geometry.height, look),
  };
};
