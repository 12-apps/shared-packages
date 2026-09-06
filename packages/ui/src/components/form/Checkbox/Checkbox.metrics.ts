import type { CheckboxVariant } from './Checkbox.base';

/**
 * THE NUMBERS BOTH `Checkbox` RENDERERS DRAW WITH.
 *
 * `Checkbox.tsx` (web, emotion over MUI's `Checkbox`) and
 * `Checkbox.native.tsx` (React Native) read this one table. As with the other
 * fields, some of it is what the web writes itself — the two variants' corner
 * treatment, the glow and pulse keyframes, the helper text's inset — and some
 * is what MUI supplies underneath: `SwitchBase`'s 9px padding, `SvgIcon`'s
 * three sizes, and the ink a box is drawn in.
 */

/** MUI's `SwitchBase`: 9px of padding around the glyph, at every size. */
export const CHECKBOX_PADDING = 9;

/** `SvgIcon`'s own three steps. MUI passes the `size` prop straight to the glyph. */
export const CHECKBOX_GLYPH_SIZES = { small: 20, medium: 24, large: 35 } as const;
export type CheckboxSize = keyof typeof CHECKBOX_GLYPH_SIZES;

export const glyphSize = (size: CheckboxSize | undefined): number =>
  CHECKBOX_GLYPH_SIZES[size ?? 'medium'] ?? CHECKBOX_GLYPH_SIZES.medium;

/**
 * The three glyphs MUI draws, by state.
 *
 * `@12-apps/ui/icons` generates their paths from the same
 * `@mui/icons-material` package MUI's own `Checkbox` imports them from, so the
 * native box is the web box rather than a hand-drawn square.
 */
export const CHECKBOX_GLYPH = {
  checked: 'CheckBox',
  unchecked: 'CheckBoxOutlineBlank',
  indeterminate: 'IndeterminateCheckBox',
} as const;

/**
 * The corner each variant gives the glyph's box.
 *
 * `rounded` is a circle and `toggle` a 12px radius at 1.2 scale — both applied
 * to the SVG's own box on the web, where they show only through what the box
 * clips. Native gives them the same radius and the same scale.
 */
export const CHECKBOX_VARIANT: Record<CheckboxVariant, { radius?: number | string; scale?: number }> = {
  default: {},
  rounded: { radius: '50%' },
  toggle: { radius: 12, scale: 1.2 },
};

/** The wash a hovered box takes, and the 0.3s every state change runs over. */
export const CHECKBOX_HOVER_ALPHA = 0.1;
export const CHECKBOX_TRANSITION_MS = 300;

/** `loading`: MUI's 20px `CircularProgress`, centred over the box. */
export const CHECKBOX_SPINNER = { size: 20, offset: -10 } as const;

/**
 * `glow` and `pulse` are keyed to MUI's DEFAULT blue rather than the theme's
 * primary — the web writes the rgba out by hand — so both renderers do.
 */
export const CHECKBOX_EFFECT_INK = { r: 25, g: 118, b: 210 } as const;
export const CHECKBOX_GLOW = { blur: { from: 5, to: 20 }, alpha: { from: 0.5, to: 0.8 }, ms: 2000 } as const;
export const CHECKBOX_PULSE = { spread: 10, alpha: 0.7, ms: 2000 } as const;

/** MUI's default blue at an alpha, as the web's keyframes spell it. */
export const effectInk = (alphaValue: number): string =>
  `rgba(${CHECKBOX_EFFECT_INK.r}, ${CHECKBOX_EFFECT_INK.g}, ${CHECKBOX_EFFECT_INK.b}, ${alphaValue})`;

/** `FormControlLabel`: flush left, its label at MUI's `body2` size. */
export const CHECKBOX_LABEL = { marginLeft: 0, fontSize: 14 } as const;

/** `FormHelperText`: four spacing units in, half a unit down. */
export const CHECKBOX_HELPER = { marginLeftUnits: 4, marginTopUnits: 0.5, fontSize: 12, lineHeight: 1.66 } as const;
