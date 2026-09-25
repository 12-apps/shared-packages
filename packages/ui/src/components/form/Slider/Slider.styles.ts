import { alpha } from '@mui/material/styles/index.js';
import type { CSSObject, Theme } from '@mui/material/styles/index.js';

import { glowAnimation, gradientShiftAnimation, pulseAnimation } from './Slider.animations';
import { rem } from '../../../tokens/relative';

import { absoluteInk, controlNeutral, onMedia, sheen } from '../../../tokens/ink';

interface ColorPalette {
  main: string;
  dark?: string;
  light?: string;
  contrastText?: string;
}

/** `neutral` is not a MUI palette entry, so it is built from the grey ramp. */
const neutralPalette = (theme: Theme): ColorPalette => controlNeutral(theme);

/** `danger` is this component's name for the error palette. */
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
    contrastText: palette.contrastText || absoluteInk(theme).white,
  };
};

type SizeKey = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/** Design px, converted through the type scale where each is read. */
interface Geometry {
  heightPx: number;
  thumbSizePx: number;
  markHeightPx: number;
}

const SIZES: Record<SizeKey, Geometry> = {
  xs: { heightPx: 4, thumbSizePx: 16, markHeightPx: 8 },
  sm: { heightPx: 6, thumbSizePx: 18, markHeightPx: 10 },
  md: { heightPx: 8, thumbSizePx: 20, markHeightPx: 12 },
  lg: { heightPx: 10, thumbSizePx: 24, markHeightPx: 14 },
  xl: { heightPx: 12, thumbSizePx: 28, markHeightPx: 16 },
};

/**
 * The value bubble and mark labels shrink at the two smallest sizes only. The
 * two fonts are design px, read through the type scale.
 */
const LABEL_SCALE: Record<string, { fontPx: number; boxPx: number; markFont: number }> = {
  xs: { fontPx: 10, boxPx: 28, markFont: 10.4 },
  sm: { fontPx: 11, boxPx: 30, markFont: 11.2 },
};
const LABEL_DEFAULT = { fontPx: 12, boxPx: 32, markFont: 12 };

export interface SliderFlags {
  customColor?: string;
  customSize?: string;
  glow?: boolean;
  glass?: boolean;
  gradient?: boolean;
  customVariant?: string;
}

interface PartInput {
  theme: Theme;
  flags: SliderFlags;
  palette: ColorPalette;
  geometry: Geometry;
}

const trackPart = ({ theme, flags, palette, geometry }: PartInput): CSSObject => {
  const { gradient, glow, glass, customVariant } = flags;
  const isGradientVariant = customVariant === 'gradient';

  return {
    border: 'none',
    height: rem(theme, geometry.heightPx),
    borderRadius: rem(theme, geometry.heightPx / 2),
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    position: 'relative',
    overflow: 'hidden',
    ...(gradient && {
      background: isGradientVariant
        ? `linear-gradient(90deg,
              ${palette.light} 0%,
              ${palette.main} 50%,
              ${palette.dark} 100%)`
        : `linear-gradient(90deg, ${palette.light}, ${palette.main})`,
      backgroundSize: '200% 100%',
      animation: isGradientVariant ? `${gradientShiftAnimation} 3s ease infinite` : 'none',
      // A sheen that travels the filled portion while the gradient shifts.
      '&::after': {
        content: '""',
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: `linear-gradient(90deg, transparent, ${sheen(theme, 0.2)}, transparent)`,
        animation: `${gradientShiftAnimation} 2s linear infinite`,
      },
    }),
    ...(glow && {
      animation: `${glowAnimation(theme)} 2s ease-in-out infinite`,
      boxShadow: `0 0 ${rem(theme, 10)} ${alpha(palette.main, 0.6)}, inset 0 0 ${rem(theme, 10)} ${alpha(palette.main, 0.2)}`,
    }),
    ...(glass && {
      backgroundColor: alpha(palette.main, 0.8),
      backdropFilter: `blur(${rem(theme, 10)})`,
      border: `1px solid ${alpha(palette.light || palette.main, 0.3)}`,
    }),
  };
};

const railPart = ({ theme, flags, geometry }: PartInput): CSSObject => ({
  color: alpha(theme.palette.action.disabled, 0.3),
  opacity: 1,
  height: rem(theme, geometry.heightPx),
  borderRadius: rem(theme, geometry.heightPx / 2),
  transition: 'all 0.3s ease',
  ...(flags.glass && {
    backgroundColor: alpha(theme.palette.background.paper, 0.1),
    backdropFilter: `blur(${rem(theme, 20)})`,
    border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
  }),
  ...(flags.customVariant === 'gradient' && {
    background: `linear-gradient(90deg,
          ${alpha(theme.palette.action.disabled, 0.2)},
          ${alpha(theme.palette.action.disabled, 0.3)},
          ${alpha(theme.palette.action.disabled, 0.2)})`,
  }),
});

const thumbPart = ({ theme, flags, palette, geometry }: PartInput): CSSObject => {
  const { gradient, glow, glass } = flags;

  return {
    height: rem(theme, geometry.thumbSizePx),
    width: rem(theme, geometry.thumbSizePx),
    backgroundColor: gradient ? palette.main : absoluteInk(theme).white,
    border: `${rem(theme, 2)} solid ${palette.main}`,
    boxShadow: `${theme.shadows[2]}, 0 0 0 0 ${alpha(palette.main, 0.2)}`,
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    position: 'relative',
    // Sits invisible until focus or hover runs the pulse keyframes over it.
    '&::before': {
      content: '""',
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: '100%',
      height: '100%',
      borderRadius: '50%',
      backgroundColor: palette.main,
      opacity: 0,
    },
    '&:focus, &:hover, &.Mui-active, &.Mui-focusVisible': {
      boxShadow: glow
        ? `${theme.shadows[4]}, 0 0 ${rem(theme, 20)} ${alpha(palette.main, 0.6)}, 0 0 0 ${rem(theme, 8)} ${alpha(palette.main, 0.15)}`
        : `${theme.shadows[4]}, 0 0 0 ${rem(theme, 8)} ${alpha(palette.main, 0.15)}`,
      transform: 'scale(1.15)',
      '&::before': { animation: `${pulseAnimation} 0.6s ease-out` },
    },
    '&:active': { transform: 'scale(1.05)' },
    ...(glass && {
      backgroundColor: alpha(theme.palette.background.paper, 0.9),
      backdropFilter: `blur(${rem(theme, 10)})`,
      border: `${rem(theme, 2)} solid ${alpha(palette.main, 0.8)}`,
    }),
    ...(gradient && {
      background: `linear-gradient(135deg, ${palette.light}, ${palette.main})`,
      border: 'none',
      color: onMedia(theme),
    }),
  };
};

/** Transparent under a gradient (the gradient itself paints it), else the accent. */
const bubbleBackground = (palette: ColorPalette, gradient: boolean, glass: boolean) => {
  if (gradient) return 'transparent';
  return glass ? alpha(palette.main, 0.9) : palette.main;
};

/** The bubble's closed and open transforms; only the scale differs between them. */
const bubbleTransformFor = (gradient: boolean) => {
  const base = gradient ? 'translate(50%, -150%)' : 'translate(50%, -100%) rotate(-45deg)';
  return { hidden: `${base} scale(0)`, shown: `${base} scale(1)` };
};

/**
 * The value bubble. Without `gradient` it is MUI's teardrop — a rotated square
 * with one square corner — so its contents are counter-rotated; the gradient
 * look is a plain rounded box and needs neither rotation.
 */
const valueLabelPart = ({ theme, flags, palette }: PartInput): CSSObject => {
  const { gradient, glass, customSize } = flags;
  const scale = LABEL_SCALE[customSize ?? ''] ?? LABEL_DEFAULT;
  const bubbleTransform = bubbleTransformFor(Boolean(gradient));

  return {
    lineHeight: 1.2,
    fontSize: rem(theme, scale.fontPx),
    padding: 0,
    width: rem(theme, scale.boxPx),
    height: rem(theme, scale.boxPx),
    borderRadius: gradient ? rem(theme, 8) : '50% 50% 50% 0',
    backgroundColor: bubbleBackground(palette, Boolean(gradient), Boolean(glass)),
    background: gradient
      ? `linear-gradient(135deg, ${palette.light}, ${palette.main})`
      : 'unset',
    backdropFilter: glass ? `blur(${rem(theme, 10)})` : 'none',
    transformOrigin: 'bottom left',
    transform: bubbleTransform.hidden,
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    boxShadow: `${theme.shadows[2]}, 0 0 ${rem(theme, 10)} ${alpha(palette.main, 0.2)}`,
    '&:before': { display: 'none' },
    '&.MuiSlider-valueLabelOpen': { transform: bubbleTransform.shown },
    '& > *': { transform: gradient ? 'none' : 'rotate(45deg)', fontWeight: 600 },
  };
};

const markPart = ({ theme, flags, palette, geometry }: PartInput): CSSObject => {
  const { gradient, glow, customVariant } = flags;
  const isMarksVariant = customVariant === 'marks';
  const { markHeightPx, heightPx } = geometry;

  return {
    backgroundColor: alpha(theme.palette.action.disabled, 0.5),
    height: rem(theme, markHeightPx),
    width: rem(theme, isMarksVariant ? 3 : 2),
    // Centred on the rail rather than hanging below it.
    marginTop: rem(theme, -(markHeightPx - heightPx) / 2),
    borderRadius: rem(theme, 1),
    transition: 'all 0.3s ease',
    '&.MuiSlider-markActive': {
      backgroundColor: gradient ? palette.light : palette.main,
      width: rem(theme, isMarksVariant ? 4 : 2),
      height: rem(theme, markHeightPx + 2),
      marginTop: rem(theme, -(markHeightPx + 2 - heightPx) / 2),
      ...(glow && { boxShadow: `0 0 ${rem(theme, 8)} ${alpha(palette.main, 0.5)}` }),
    },
  };
};

const markLabelPart = ({ theme, flags, palette }: PartInput): CSSObject => ({
  fontSize: rem(theme, (LABEL_SCALE[flags.customSize ?? ''] ?? LABEL_DEFAULT).markFont),
  color: theme.palette.text.secondary,
  marginTop: theme.spacing(1.5),
  fontWeight: 500,
  transition: 'all 0.3s ease',
  '&.MuiSlider-markLabelActive': {
    color: palette.main,
    fontWeight: 600,
    transform: 'scale(1.05)',
  },
});

export const sliderSx = (theme: Theme, flags: SliderFlags): CSSObject => {
  const palette = getColorFromTheme(theme, flags.customColor ?? 'primary');
  const geometry = SIZES[flags.customSize as SizeKey] ?? SIZES.md;
  const input: PartInput = { theme, flags, palette, geometry };

  return {
    color: palette.main,
    height: rem(theme, geometry.heightPx),
    '& .MuiSlider-track': trackPart(input),
    '& .MuiSlider-rail': railPart(input),
    '& .MuiSlider-thumb': thumbPart(input),
    '& .MuiSlider-valueLabel': valueLabelPart(input),
    '& .MuiSlider-mark': markPart(input),
    '& .MuiSlider-markLabel': markLabelPart(input),
  };
};
