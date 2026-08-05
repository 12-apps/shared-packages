import { alpha } from '@mui/material';
import type { CSSObject, Theme } from '@mui/material';

import { glowAnimation, gradientShiftAnimation, pulseAnimation } from './Slider.animations';

export interface ColorPalette {
  main: string;
  dark?: string;
  light?: string;
  contrastText?: string;
}

/** `neutral` is not a MUI palette entry, so it is built from the grey ramp. */
const neutralPalette = (theme: Theme): ColorPalette => ({
  main: theme.palette.grey[700],
  dark: theme.palette.grey[800],
  light: theme.palette.grey[500],
  contrastText: '#fff',
});

/** `danger` is this component's name for the error palette. */
const namedPalette = (theme: Theme, color: string): ColorPalette => {
  const colorMap: Record<string, ColorPalette> = {
    primary: theme.palette.primary,
    secondary: theme.palette.secondary,
    success: theme.palette.success,
    warning: theme.palette.warning,
    danger: theme.palette.error,
  };

  return colorMap[color] || theme.palette.primary;
};

export const getColorFromTheme = (theme: Theme, color: string): ColorPalette => {
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

interface Geometry {
  height: number;
  thumbSize: number;
  markHeight: number;
}

const SIZES: Record<SizeKey, Geometry> = {
  xs: { height: 4, thumbSize: 16, markHeight: 8 },
  sm: { height: 6, thumbSize: 18, markHeight: 10 },
  md: { height: 8, thumbSize: 20, markHeight: 12 },
  lg: { height: 10, thumbSize: 24, markHeight: 14 },
  xl: { height: 12, thumbSize: 28, markHeight: 16 },
};

/** The value bubble and mark labels shrink at the two smallest sizes only. */
const LABEL_SCALE: Record<string, { fontSize: number; box: number; markFont: string }> = {
  xs: { fontSize: 10, box: 28, markFont: '0.65rem' },
  sm: { fontSize: 11, box: 30, markFont: '0.7rem' },
};
const LABEL_DEFAULT = { fontSize: 12, box: 32, markFont: '0.75rem' };

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

const trackPart = ({ flags, palette, geometry }: PartInput): CSSObject => {
  const { gradient, glow, glass, customVariant } = flags;
  const isGradientVariant = customVariant === 'gradient';

  return {
    border: 'none',
    height: geometry.height,
    borderRadius: geometry.height / 2,
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
        background: `linear-gradient(90deg, transparent, ${alpha('#fff', 0.2)}, transparent)`,
        animation: `${gradientShiftAnimation} 2s linear infinite`,
      },
    }),
    ...(glow && {
      animation: `${glowAnimation} 2s ease-in-out infinite`,
      boxShadow: `0 0 10px ${alpha(palette.main, 0.6)}, inset 0 0 10px ${alpha(palette.main, 0.2)}`,
    }),
    ...(glass && {
      backgroundColor: alpha(palette.main, 0.8),
      backdropFilter: 'blur(10px)',
      border: `1px solid ${alpha(palette.light || palette.main, 0.3)}`,
    }),
  };
};

const railPart = ({ theme, flags, geometry }: PartInput): CSSObject => ({
  color: alpha(theme.palette.action.disabled, 0.3),
  opacity: 1,
  height: geometry.height,
  borderRadius: geometry.height / 2,
  transition: 'all 0.3s ease',
  ...(flags.glass && {
    backgroundColor: alpha(theme.palette.background.paper, 0.1),
    backdropFilter: 'blur(20px)',
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
    height: geometry.thumbSize,
    width: geometry.thumbSize,
    backgroundColor: gradient ? palette.main : '#fff',
    border: `2px solid ${palette.main}`,
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
        ? `${theme.shadows[4]}, 0 0 20px ${alpha(palette.main, 0.6)}, 0 0 0 8px ${alpha(palette.main, 0.15)}`
        : `${theme.shadows[4]}, 0 0 0 8px ${alpha(palette.main, 0.15)}`,
      transform: 'scale(1.15)',
      '&::before': { animation: `${pulseAnimation} 0.6s ease-out` },
    },
    '&:active': { transform: 'scale(1.05)' },
    ...(glass && {
      backgroundColor: alpha(theme.palette.background.paper, 0.9),
      backdropFilter: 'blur(10px)',
      border: `2px solid ${alpha(palette.main, 0.8)}`,
    }),
    ...(gradient && {
      background: `linear-gradient(135deg, ${palette.light}, ${palette.main})`,
      border: 'none',
      color: '#fff',
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
    fontSize: scale.fontSize,
    padding: 0,
    width: scale.box,
    height: scale.box,
    borderRadius: gradient ? '8px' : '50% 50% 50% 0',
    backgroundColor: bubbleBackground(palette, Boolean(gradient), Boolean(glass)),
    background: gradient
      ? `linear-gradient(135deg, ${palette.light}, ${palette.main})`
      : 'unset',
    backdropFilter: glass ? 'blur(10px)' : 'none',
    transformOrigin: 'bottom left',
    transform: bubbleTransform.hidden,
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    boxShadow: `${theme.shadows[2]}, 0 0 10px ${alpha(palette.main, 0.2)}`,
    '&:before': { display: 'none' },
    '&.MuiSlider-valueLabelOpen': { transform: bubbleTransform.shown },
    '& > *': { transform: gradient ? 'none' : 'rotate(45deg)', fontWeight: 600 },
  };
};

const markPart = ({ theme, flags, palette, geometry }: PartInput): CSSObject => {
  const { gradient, glow, customVariant } = flags;
  const isMarksVariant = customVariant === 'marks';
  const { markHeight, height } = geometry;

  return {
    backgroundColor: alpha(theme.palette.action.disabled, 0.5),
    height: markHeight,
    width: isMarksVariant ? 3 : 2,
    // Centred on the rail rather than hanging below it.
    marginTop: -(markHeight - height) / 2,
    borderRadius: 1,
    transition: 'all 0.3s ease',
    '&.MuiSlider-markActive': {
      backgroundColor: gradient ? palette.light : palette.main,
      width: isMarksVariant ? 4 : 2,
      height: markHeight + 2,
      marginTop: -(markHeight + 2 - height) / 2,
      ...(glow && { boxShadow: `0 0 8px ${alpha(palette.main, 0.5)}` }),
    },
  };
};

const markLabelPart = ({ theme, flags, palette }: PartInput): CSSObject => ({
  fontSize: (LABEL_SCALE[flags.customSize ?? ''] ?? LABEL_DEFAULT).markFont,
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
    height: geometry.height,
    '& .MuiSlider-track': trackPart(input),
    '& .MuiSlider-rail': railPart(input),
    '& .MuiSlider-thumb': thumbPart(input),
    '& .MuiSlider-valueLabel': valueLabelPart(input),
    '& .MuiSlider-mark': markPart(input),
    '& .MuiSlider-markLabel': markLabelPart(input),
  };
};
