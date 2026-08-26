import { alpha } from '@mui/material/styles';
import type { CSSObject, Theme } from '@mui/material/styles';

import {
  bounceAnimation,
  glowAnimation,
  pulseAnimation,
  rippleAnimation,
  shimmerAnimation,
  spinAnimation,
} from './Switch.animations';

interface ColorPalette {
  main: string;
  dark?: string;
  light?: string;
  contrastText?: string;
}

/**
 * `neutral` is not a MUI palette entry, so it is built from the grey ramp. The
 * literal fallbacks cover a theme whose grey ramp omits these steps.
 */
const neutralPalette = (theme: Theme): ColorPalette => ({
  main: theme.palette.grey?.[700] || '#616161',
  dark: theme.palette.grey?.[800] || '#424242',
  light: theme.palette.grey?.[500] || '#9e9e9e',
  contrastText: '#fff',
});

/** `danger` is this component's name for the error palette; the rest map straight through. */
const namedPalette = (theme: Theme, color: string): ColorPalette => {
  const colorMap: Record<string, ColorPalette> = {
    primary: theme.palette.primary,
    secondary: theme.palette.secondary,
    success: theme.palette.success,
    warning: theme.palette.warning,
    info: theme.palette.info,
    danger: theme.palette.error,
  };

  return colorMap[color] || theme.palette.primary;
};

/**
 * Resolves a colour name to a full palette, filling any step the theme leaves
 * out from `main` and then from the primary palette.
 */
const getColorFromTheme = (theme: Theme, color: string): ColorPalette => {
  if (color === 'neutral') {
    return neutralPalette(theme);
  }

  const palette = namedPalette(theme, color);
  const { primary } = theme.palette;

  return {
    main: palette.main || primary.main,
    dark: palette.dark || palette.main || primary.dark,
    light: palette.light || palette.main || primary.light,
    contrastText: palette.contrastText || '#fff',
  };
};

type SizeKey = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface SwitchGeometry {
  width: number;
  height: number;
  padding: number;
  thumbSize: number;
}

const SIZES: Record<SizeKey, SwitchGeometry> = {
  xs: { width: 34, height: 18, padding: 1, thumbSize: 14 },
  sm: { width: 42, height: 22, padding: 1, thumbSize: 18 },
  md: { width: 50, height: 26, padding: 1, thumbSize: 22 },
  lg: { width: 58, height: 30, padding: 2, thumbSize: 24 },
  xl: { width: 66, height: 34, padding: 2, thumbSize: 28 },
};

export interface SwitchFlags {
  customVariant?: string;
  customColor?: string;
  customSize?: string;
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

/**
 * The four platform looks. Each names one row of the tables below, so the
 * borderRadius/shadow/colour choices stop being nested ternaries repeated per
 * DOM part.
 */
type Look = 'ios' | 'android' | 'material' | 'default';

const lookOf = (customVariant?: string): Look => {
  if (customVariant === 'ios') return 'ios';
  if (customVariant === 'android') return 'android';
  if (customVariant === 'material') return 'material';
  return 'default';
};

/** Track geometry once the caller's overrides and the size preset are combined. */
const geometryOf = (flags: SwitchFlags) => {
  const preset = SIZES[flags.customSize as SizeKey] ?? SIZES.md;

  return {
    ...preset,
    width: flags.trackWidth || preset.width,
    height: flags.trackHeight || preset.height,
  };
};

const THUMB_RADIUS: Record<Look, (thumbSize: number) => number | string> = {
  ios: () => '50%',
  android: () => 4,
  material: (thumbSize) => thumbSize / 3,
  default: () => '50%',
};

const TRACK_RADIUS: Record<Look, (height: number) => number> = {
  ios: (height) => height / 2,
  android: (height) => height / 3,
  material: (height) => height / 2.5,
  default: (height) => height / 2,
};

const thumbShadow = (theme: Theme, look: Look) => {
  if (look === 'ios') {
    return `0 3px 1px 0 ${alpha('#000', 0.04)}, 0 3px 8px 0 ${alpha('#000', 0.12)}, 0 1px 0 0 ${alpha('#000', 0.08)}`;
  }
  return look === 'android' ? theme.shadows[3] : theme.shadows[2];
};

const trackColor = (theme: Theme, look: Look) => {
  if (look === 'ios') return alpha(theme.palette.common.black, 0.1);
  if (look === 'android') return alpha(theme.palette.action.disabled, 0.2);
  return alpha(theme.palette.action.disabled, 0.3);
};

/** The ripple that expands from the thumb on hover. */
const rippleOverlay = (palette: ColorPalette): CSSObject => ({
  content: '""',
  position: 'absolute',
  top: '50%',
  left: '50%',
  width: '100%',
  height: '100%',
  borderRadius: '50%',
  background: alpha(palette.main, 0.2),
  animation: `${rippleAnimation} 0.6s ease-out`,
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
    animation: `${glowAnimation} 2s ease-in-out infinite`,
    boxShadow: `0 0 10px ${alpha(palette.main, 0.6)}, inset 0 0 10px ${alpha(palette.main, 0.2)}`,
  }),
  ...(flags.gradient && {
    background: `linear-gradient(90deg, ${palette.light || palette.main} 0%, ${palette.main} 50%, ${palette.dark || palette.main} 100%)`,
    backgroundSize: '200% 100%',
    animation: `${shimmerAnimation} 3s ease infinite`,
  }),
});

const switchBaseSx = (
  theme: Theme,
  flags: SwitchFlags,
  palette: ColorPalette,
  geometry: SwitchGeometry,
  look: Look,
): CSSObject => {
  const { width, thumbSize, padding } = geometry;
  const isIos = look === 'ios';

  return {
    padding,
    margin: 0,
    transitionDuration: '300ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
    ...(isIos && { transform: 'translateX(2px)' }),
    '&:hover': {
      '& .MuiSwitch-thumb': {
        transform: flags.loading ? 'none' : 'scale(1.05)',
        boxShadow: `${theme.shadows[4]}, 0 0 12px ${alpha(palette.main, 0.2)}`,
      },
      ...(flags.ripple && { '&::after': rippleOverlay(palette) }),
    },
    '&.Mui-checked': {
      // The thumb travels the track minus its own width and both paddings; the
      // iOS look insets differently, so it gets its own distance.
      transform: `translateX(${width - thumbSize - padding * 2}px)`,
      color: '#fff',
      '& .MuiSwitch-thumb': {
        animation: flags.loading ? 'none' : `${bounceAnimation} 0.3s ease-out`,
      },
      '& + .MuiSwitch-track': checkedTrack(flags, palette),
      '&.Mui-disabled + .MuiSwitch-track': { opacity: 0.5 },
      ...(isIos && { transform: `translateX(${width - thumbSize - 4}px)` }),
    },
    '&.Mui-focusVisible .MuiSwitch-thumb': {
      color: palette.main,
      border: `6px solid ${alpha(palette.main, 0.2)}`,
    },
    '&.Mui-disabled .MuiSwitch-thumb': { color: theme.palette.grey[100] },
    '&.Mui-disabled + .MuiSwitch-track': { opacity: 0.3 },
  };
};

const thumbSx = (
  theme: Theme,
  flags: SwitchFlags,
  palette: ColorPalette,
  thumbSize: number,
  look: Look,
): CSSObject => ({
  width: thumbSize,
  height: thumbSize,
  borderRadius: THUMB_RADIUS[look](thumbSize),
  backgroundColor: '#fff',
  boxShadow: thumbShadow(theme, look),
  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  ...(flags.glass && {
    backgroundColor: alpha(theme.palette.background.paper, 0.9),
    backdropFilter: 'blur(10px)',
    border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
  }),
  ...(flags.pulse && { animation: `${pulseAnimation} 2s ease-in-out infinite` }),
  ...(flags.loading && {
    // A spinner drawn inside the thumb rather than over the whole control.
    '&::after': {
      content: '""',
      position: 'absolute',
      width: thumbSize * 0.6,
      height: thumbSize * 0.6,
      border: `2px solid ${palette.main}`,
      borderTop: `2px solid transparent`,
      borderRadius: '50%',
      animation: `${spinAnimation} 1s linear infinite`,
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
  paddingLeft: theme.spacing(1),
  paddingRight: theme.spacing(1),
  fontSize: '0.75rem',
  fontWeight: 500,
  color: theme.palette.text.secondary,
  '&::before, &::after': {
    content: '""',
    position: 'absolute',
    fontSize: '0.75rem',
    fontWeight: 500,
    top: '50%',
    transform: 'translateY(-50%)',
    zIndex: 1,
  },
  ...(onText && {
    '&::before': { content: `"${onText}"`, left: theme.spacing(1), color: '#fff' },
  }),
  ...(offText && {
    '&::after': {
      content: `"${offText}"`,
      right: theme.spacing(1),
      color: theme.palette.text.secondary,
    },
  }),
});

const trackSx = (
  theme: Theme,
  flags: SwitchFlags,
  palette: ColorPalette,
  height: number,
  look: Look,
): CSSObject => {
  const { glass, gradient, onText, offText, customVariant } = flags;
  const showsLabels = customVariant === 'label' && (onText || offText);

  return {
    borderRadius: TRACK_RADIUS[look](height),
    backgroundColor: trackColor(theme, look),
    opacity: 1,
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    position: 'relative',
    boxShadow:
      look === 'ios'
        ? `inset 0 0 0 0.5px ${alpha('#000', 0.1)}, inset 0 2px 3px ${alpha('#000', 0.12)}`
        : 'none',
    ...(glass && {
      backgroundColor: alpha(theme.palette.background.paper, 0.1),
      backdropFilter: 'blur(20px)',
      border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
    }),
    ...(gradient &&
      !glass && {
        background: `linear-gradient(135deg, ${alpha(palette.light || palette.main, 0.3)}, ${alpha(palette.main, 0.2)})`,
      }),
    ...(showsLabels && trackLabels(theme, onText, offText)),
  };
};

export const switchSx = (theme: Theme, flags: SwitchFlags): CSSObject => {
  const palette = getColorFromTheme(theme, flags.customColor ?? 'primary');
  const geometry = geometryOf(flags);
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
