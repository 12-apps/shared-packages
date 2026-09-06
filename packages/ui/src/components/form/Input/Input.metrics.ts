import type { InputVariant } from './Input.base';
import { decomposeColor, recomposeColor } from '../../../tokens/color';
import type { UiTheme } from '../../../tokens/theme';
import { SIZE_VALUES, type SizeValue } from '../../../tokens/vocabulary';

/**
 * THE NUMBERS BOTH `Input` RENDERERS DRAW WITH.
 *
 * `Input.styles.ts` (web, emotion over MUI's `TextField`) and
 * `Input.native.tsx` (React Native) read this one table. The web turns the px
 * into the padding shorthands and rem it has always emitted; native uses the
 * numbers as they are.
 *
 * Two kinds of number live here, and the difference matters:
 *
 *  - the ones `Input.styles.ts` writes itself — the size overrides, the glow,
 *    the pulse, the glass and gradient alphas, the filled wash;
 *  - the ones MUI supplies UNDER those overrides — `OutlinedInput`'s
 *    `16.5px 14px`, `InputBase`'s 23px line box, `FormHelperText`'s 3px lift.
 *    The web never writes them, but it draws them, so a native field that
 *    wants the same box has to know them. They are MUI 6.5's own values,
 *    copied with their source named; a host that re-themes MUI's components
 *    moves the web only, which the parity ledger records.
 */

export interface InputInset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** MUI gives a text field two heights; the house scale has five. */
export type MuiInputSize = 'small' | 'medium';
export type MuiInputVariant = 'outlined' | 'filled' | 'standard';

/** Our five variants map onto MUI's three; `glass` and `gradient` restyle an outline. */
export const muiVariantFor = (variant: InputVariant): MuiInputVariant => {
  switch (variant) {
    case 'underline':
      return 'standard';
    case 'glass':
    case 'gradient':
      return 'outlined';
    default:
      return variant;
  }
};

/** Which of MUI's two heights each step of the house scale asks for. */
export const INPUT_MUI_SIZE: Record<SizeValue, MuiInputSize> = {
  xs: 'small',
  sm: 'small',
  md: 'medium',
  lg: 'medium',
  xl: 'medium',
};

/**
 * The three steps MUI has no height for, as `padding` on the input itself.
 *
 * `sm` and `md` are absent on purpose — they ARE MUI's two heights, so they
 * fall through to {@link MUI_INPUT_PADDING} below rather than restating it.
 * (`lg`'s 16px is a hair under `md`'s 16.5px: the override is a round number
 * where MUI's is derived from a 56px box. Kept as written — this table is what
 * the web draws, not what it ought to draw.)
 */
export const INPUT_SIZE_OVERRIDES: Partial<Record<SizeValue, { vertical: number; horizontal: number }>> = {
  xs: { vertical: 6, horizontal: 10 },
  lg: { vertical: 16, horizontal: 14 },
  xl: { vertical: 20, horizontal: 16 },
};

/**
 * MUI's own input padding per variant and height (`OutlinedInput`,
 * `FilledInput`, `InputBase`). The filled insets are lopsided because the
 * floating label sits inside the box on the web.
 */
export const MUI_INPUT_PADDING: Record<MuiInputVariant, Record<MuiInputSize, InputInset>> = {
  outlined: {
    small: { top: 8.5, right: 14, bottom: 8.5, left: 14 },
    medium: { top: 16.5, right: 14, bottom: 16.5, left: 14 },
  },
  filled: {
    small: { top: 21, right: 12, bottom: 4, left: 12 },
    medium: { top: 25, right: 12, bottom: 8, left: 12 },
  },
  standard: {
    small: { top: 1, right: 0, bottom: 5, left: 0 },
    medium: { top: 4, right: 0, bottom: 5, left: 0 },
  },
};

/** The inset the value is drawn at: the size override where there is one, MUI's otherwise. */
export function inputPadding(variant: InputVariant, size: SizeValue): InputInset {
  const override = INPUT_SIZE_OVERRIDES[size];
  if (override) {
    return {
      top: override.vertical,
      right: override.horizontal,
      bottom: override.vertical,
      left: override.horizontal,
    };
  }
  return MUI_INPUT_PADDING[muiVariantFor(variant)][INPUT_MUI_SIZE[size]];
}

/** `theme.typography.body1` and `InputBase`'s `lineHeight: '1.4375em'`, in px. */
export const INPUT_FONT_SIZE = 16;
export const INPUT_LINE_HEIGHT = 23;

/** MUI's `::placeholder` opacity, which multiplies the ink's own alpha. */
export const PLACEHOLDER_OPACITY = { light: 0.42, dark: 0.5 } as const;

/**
 * The placeholder's colour: the field's ink faded by MUI's opacity.
 *
 * `alpha()` REPLACES an alpha channel, and `text.primary` already carries one
 * (`rgba(0, 0, 0, 0.87)`), so `alpha(ink, 0.42)` would be a different grey from
 * the one the browser composites. React Native has no per-placeholder opacity —
 * only `placeholderTextColor` — so the multiplication happens here.
 */
export function placeholderInk(theme: UiTheme): string {
  const opacity = theme.mode === 'dark' ? PLACEHOLDER_OPACITY.dark : PLACEHOLDER_OPACITY.light;
  const { type, values } = decomposeColor(theme.palette.text.primary);
  const [first = 0, second = 0, third = 0, own = 1] = values;
  return recomposeColor({
    type: type.startsWith('hsl') ? 'hsla' : 'rgba',
    values: [first, second, third, own * opacity],
  });
}

/** The outline: 1px at rest, 2px focused, as MUI's `notchedOutline` draws it. */
export const INPUT_BORDER = { rest: 1, focused: 2 } as const;

/** `FilledInput`'s and `Input`'s resting underline, MUI's own two greys. */
export const UNDERLINE_COLOR = {
  light: 'rgba(0, 0, 0, 0.42)',
  dark: 'rgba(255, 255, 255, 0.7)',
} as const;

/**
 * The label. It floats into the border on the web and sits above the field on
 * native, but it is the SAME label: 16px body type at MUI's shrunk scale, and
 * left-aligned with the value it names ({@link inputPadding}'s `left`).
 *
 * The 4px gap is MUI's own: a standard field puts 16px between the control's
 * top and the input, and the shrunk label's 12px line box takes the first 12.
 */
export const INPUT_LABEL = { scale: 0.75, gap: 4 } as const;

/** `FormHelperText`: `theme.typography.caption` lifted 3px, inset 14px when contained. */
export const HELPER_TEXT = {
  fontSize: 12,
  lineHeight: 1.66,
  marginTop: 3,
  marginTopSmall: 4,
  marginHorizontal: 14,
} as const;

/** `InputAdornment`: 8px between the glyph and the value, on whichever side it is. */
export const ADORNMENT_GAP = 8;

/** `loading`: the field fades and MUI's 20px `CircularProgress` takes the end slot. */
export const INPUT_LOADING = { opacity: 0.7, spinnerSize: 20 } as const;

/** `glow`: a halo of the primary hue, wider and stronger while focused. */
export const INPUT_GLOW = {
  rest: { blur: 15, alpha: 0.3 },
  focused: { blur: 20, alpha: 0.5 },
} as const;

/** `pulse`: a 56px bar behind the field, fading outward every two seconds. */
export const INPUT_PULSE = {
  height: 56,
  radiusUnits: 0.5,
  opacity: 0.3,
  ms: 2000,
  spread: 10,
} as const;

/** `floating`: where the label rests and where it shrinks to, on the web. */
export const FLOATING_LABEL = {
  rest: { x: 14, y: 16 },
  shrink: { x: 14, y: -9 },
  scale: 0.75,
  paddingX: 4,
} as const;

/** `glass`: a wash of paper under a blur, brighter as the field is engaged. */
export const INPUT_GLASS = {
  background: { rest: 0.1, hover: 0.15, focused: 0.2 },
  blur: 20,
  hoverBorderAlpha: 0.3,
  focusRing: { width: 2, alpha: 0.1 },
} as const;

/** `gradient`: a 135° fill between the two brand hues, inside a 2px masked ring. */
export const INPUT_GRADIENT = {
  angleDeg: 135,
  fill: { rest: 0.1, hover: 0.15, focused: 0.2 },
  borderWidth: 2,
} as const;

/** `filled`: MUI's own grey replaced by a wash of `action.hover`. */
export const FILLED_WASH = { rest: 0.04, hover: 0.08, focused: 0.12 } as const;

/**
 * The `sx` the web spreads onto the `TextField` for a size: MUI's height, plus
 * the input padding for the three steps MUI has no height for.
 */
export interface InputSizeProps {
  size: MuiInputSize;
  sx?: { '& .MuiInputBase-input': { padding: string } };
}

const sizeProps = (size: SizeValue): InputSizeProps => {
  const override = INPUT_SIZE_OVERRIDES[size];
  return {
    size: INPUT_MUI_SIZE[size],
    ...(override
      ? { sx: { '& .MuiInputBase-input': { padding: `${override.vertical}px ${override.horizontal}px` } } }
      : {}),
  };
};

export const SIZE_MAP: Record<SizeValue, InputSizeProps> = Object.fromEntries(
  SIZE_VALUES.map((size) => [size, sizeProps(size)]),
) as Record<SizeValue, InputSizeProps>;
