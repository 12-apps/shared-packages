import { alpha } from '@mui/material/styles/index.js';
import type { CSSObject, Theme } from '@mui/material/styles/index.js';

import { fieldEdge } from '../../../tokens/field-edge';
import { fieldRadius } from '../../../tokens/field-radius';
import { asFieldSize, fieldHeight } from '../../../tokens/field-height';
import { absoluteInk, controlNeutral } from '../../../tokens/ink';
import { rem } from '../../../tokens/relative';

import { OTP_FIT_MIN_HEIGHT_PX, OTP_FIT_MIN_WIDTH_PX, OTP_FONT_PX } from './InputOTP.metrics';

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

type SizeKey = keyof typeof OTP_FONT_PX;

export interface OtpSlotFlags {
  customColor?: string;
  customSize?: string;
  glass?: boolean;
  gradient?: boolean;
  /** `fit="width"`: share the row's width instead of drawing a square (FUT-4585). */
  fitWidth?: boolean;
}

interface SlotBox {
  /** The slot's own footprint in the row. */
  outer: CSSObject;
  /** The outlined input inside it. */
  inner: CSSObject;
}

/**
 * A slot's box. By default a square of the field height, inside and out.
 *
 * Under `fit="width"` (FUT-4585), the native `otpFitBox` in CSS: the slot keeps
 * the field's height (never under the 40px touch floor) and takes an equal
 * share of the row, never wider than it is tall, never under 32px; the input
 * fills it.
 */
const slotBox = (theme: Theme, side: string, fitWidth: boolean | undefined): SlotBox => {
  if (!fitWidth) return { outer: { width: side, height: side }, inner: { width: side, height: side } };
  const height = `max(${side}, ${rem(theme, OTP_FIT_MIN_HEIGHT_PX)})`;
  return {
    outer: { flex: '1 1 0', minWidth: rem(theme, OTP_FIT_MIN_WIDTH_PX), maxWidth: height, height },
    inner: { width: '100%', height },
  };
};

export const otpSlotSx = (theme: Theme, flags: OtpSlotFlags): CSSObject => {
  const { customColor = 'primary', customSize = 'md', glass, gradient, fitWidth } = flags;
  const palette = getColorFromTheme(theme, customColor);
  const fontPx = OTP_FONT_PX[customSize as SizeKey] ?? OTP_FONT_PX.md;
  // A slot is a field: a square of the theme's field height for its size.
  const side = fieldHeight(theme, asFieldSize(customSize));

  const box = slotBox(theme, side, fitWidth);

  return {
    ...box.outer,
    '& .MuiOutlinedInput-root': {
      ...box.inner,
      fontSize: rem(theme, fontPx),
      fontWeight: 600,
      textAlign: 'center',
      borderRadius: fieldRadius(theme),
      ...(glass && {
        backgroundColor: alpha(theme.palette.background.paper, 0.1),
        backdropFilter: `blur(${rem(theme, 20)})`,
        '& fieldset': { border: `1px solid ${fieldEdge(theme)}` },
      }),
      ...(gradient && {
        '&.Mui-focused fieldset': {
          background: `linear-gradient(135deg, ${palette.main}, ${palette.light})`,
          borderWidth: rem(theme, 2),
        },
      }),
      '& input': { textAlign: 'center', padding: 0, fontWeight: 'inherit' },
      ...(!glass && { '& fieldset': { borderColor: fieldEdge(theme) } }),
      '&:hover fieldset': { borderColor: palette.main },
      '&.Mui-focused fieldset': { borderColor: palette.main, borderWidth: rem(theme, 2) },
    },
  };
};
