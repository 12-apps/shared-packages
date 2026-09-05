import type { TextStyle, ViewStyle } from 'react-native';

import type { InputVariant } from './Input.base';
import {
  FILLED_WASH,
  HELPER_TEXT,
  INPUT_BORDER,
  INPUT_FONT_SIZE,
  INPUT_GLASS,
  INPUT_GRADIENT,
  INPUT_LABEL,
  INPUT_LINE_HEIGHT,
  UNDERLINE_COLOR,
  inputPadding,
  placeholderInk,
} from './Input.metrics';
import { alpha } from '../../../tokens/color';
import { resolveFieldEdge } from '../../../tokens/field-edge.core';
import type { UiTheme } from '../../../tokens/theme';
import type { SizeValue } from '../../../tokens/vocabulary';

/**
 * WHAT A NATIVE `Input` PAINTS, AS ARITHMETIC.
 *
 * Kept out of `Input.native.tsx` so that file reads as structure — label, box,
 * value, helper — and this one reads as the decisions: which border, how thick,
 * what colour, and where the value sits inside it.
 */
export interface FieldState {
  focused: boolean;
  error: boolean;
  disabled: boolean;
}

/** Which edges a variant draws. `filled` and `underline` rule only the bottom. */
const BORDER_SIDES: Record<InputVariant, 'all' | 'bottom'> = {
  outlined: 'all',
  glass: 'all',
  gradient: 'all',
  filled: 'bottom',
  underline: 'bottom',
};

/**
 * Whether the web draws this border on an absolutely positioned element.
 *
 * MUI's `notchedOutline` fieldset and the `::before` / `::after` underlines
 * cost no height — the field is 56px tall WITH its border. `glass` and
 * `gradient` instead put a real `border` on the input root, which does add to
 * the box, so the web field is 2px and 4px taller respectively. React Native
 * has only the second kind, so the first three compensate below.
 */
const BORDER_IS_FREE: Record<InputVariant, boolean> = {
  outlined: true,
  filled: true,
  underline: true,
  glass: false,
  gradient: false,
};

/**
 * How thick. Only the outline family thickens on focus (MUI's `borderWidth: 2`
 * on `.Mui-focused .notchedOutline`); `glass` and `gradient` declare their own
 * constant border and change only its colour.
 */
export function borderWidthFor(variant: InputVariant, focused: boolean): number {
  if (variant === 'gradient') return INPUT_GRADIENT.borderWidth;
  if (variant === 'glass') return INPUT_BORDER.rest;
  return focused ? INPUT_BORDER.focused : INPUT_BORDER.rest;
}

/**
 * What colour. Error and disabled outrank focus, as they do in MUI's source
 * order; a resting `filled` keeps MUI's own underline grey because the web
 * override only replaces its background.
 */
function borderColorFor(theme: UiTheme, variant: InputVariant, state: FieldState): string {
  if (state.disabled) return theme.palette.action.disabled;
  if (state.error) return theme.palette.danger.main;
  if (variant === 'gradient') {
    return state.focused ? theme.palette.primary.dark : theme.palette.primary.main;
  }
  if (state.focused) return theme.palette.primary.main;
  if (variant === 'filled') {
    return theme.mode === 'dark' ? UNDERLINE_COLOR.dark : UNDERLINE_COLOR.light;
  }
  return resolveFieldEdge(theme.palette.divider, theme.palette.background.paper);
}

/** The fill behind the value. `outlined` and `underline` have none. */
function backgroundFor(theme: UiTheme, variant: InputVariant, state: FieldState): string | undefined {
  switch (variant) {
    case 'filled':
      return alpha(theme.palette.action.hover, state.focused ? FILLED_WASH.focused : FILLED_WASH.rest);
    case 'glass':
      return alpha(
        theme.palette.background.paper,
        state.focused ? INPUT_GLASS.background.focused : INPUT_GLASS.background.rest,
      );
    case 'gradient':
      // The first stop of the web's 135° fill; React Native core has no gradient.
      return alpha(
        theme.palette.primary.main,
        state.focused ? INPUT_GRADIENT.fill.focused : INPUT_GRADIENT.fill.rest,
      );
    default:
      return undefined;
  }
}

/** `filled` rounds its top two corners, `underline` none, the rest all four. */
function radiusFor(theme: UiTheme, variant: InputVariant): ViewStyle {
  if (variant === 'underline') return {};
  if (variant === 'filled') {
    return { borderTopLeftRadius: theme.radius.md, borderTopRightRadius: theme.radius.md };
  }
  return { borderRadius: theme.radius.md };
}

/** The border as React Native writes it: a width per side, one colour, one style. */
function borderStyle(variant: InputVariant, width: number, color: string, state: FieldState): ViewStyle {
  // MUI draws a disabled `filled` or `standard` underline dotted.
  const style: ViewStyle['borderStyle'] =
    state.disabled && BORDER_SIDES[variant] === 'bottom' ? 'dotted' : 'solid';
  const sides: ViewStyle =
    BORDER_SIDES[variant] === 'bottom' ? { borderBottomWidth: width } : { borderWidth: width };
  return { ...sides, borderColor: color, borderStyle: style };
}

export interface FieldLook {
  /** The row the border is drawn on: fill, edges, corners and horizontal inset. */
  box: ViewStyle;
  /** The `TextInput` itself: type, ink and the vertical inset. */
  value: TextStyle;
  placeholder: string;
}

/**
 * The field, in absolute numbers.
 *
 * The horizontal inset sits on the ROW rather than on the `TextInput`, which is
 * what MUI does the moment an adornment appears (`paddingLeft: 14` moves to the
 * input root and the input's own goes to 0) — so one rule serves a field with
 * adornments and one without.
 *
 * Where the web's border costs no height, the inset gives the border back its
 * width, so the box is the height MUI draws (56px medium, 40px small) and the
 * value does not shift by a pixel when the focused border thickens.
 */
export function fieldLook(
  theme: UiTheme,
  variant: InputVariant,
  size: SizeValue,
  state: FieldState,
): FieldLook {
  const padding = inputPadding(variant, size);
  const width = borderWidthFor(variant, state.focused);
  const inset = BORDER_IS_FREE[variant] ? width : 0;
  const sides = BORDER_SIDES[variant];
  const horizontal = sides === 'all' ? inset : 0;

  return {
    box: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: padding.left - horizontal,
      paddingRight: padding.right - horizontal,
      backgroundColor: backgroundFor(theme, variant, state),
      ...radiusFor(theme, variant),
      ...borderStyle(variant, width, borderColorFor(theme, variant, state), state),
    },
    value: {
      flex: 1,
      minWidth: 0,
      fontFamily: theme.typography.fontFamily,
      fontSize: INPUT_FONT_SIZE,
      lineHeight: INPUT_LINE_HEIGHT,
      color: state.disabled ? theme.palette.text.disabled : theme.palette.text.primary,
      paddingTop: padding.top - (sides === 'all' ? inset : 0),
      paddingBottom: padding.bottom - inset,
      paddingHorizontal: 0,
    },
    placeholder: placeholderInk(theme),
  };
}

/**
 * The label's ink. MUI's `FormLabel` is `text.secondary`, the focus colour is
 * the palette's `main`, and error and disabled are declared after it and win.
 */
export function labelStyle(theme: UiTheme, variant: InputVariant, size: SizeValue, state: FieldState): TextStyle {
  const ink = state.disabled
    ? theme.palette.text.disabled
    : state.error
      ? theme.palette.danger.main
      : state.focused
        ? theme.palette.primary.main
        : theme.palette.text.secondary;

  return {
    color: ink,
    fontFamily: theme.typography.fontFamily,
    fontSize: INPUT_FONT_SIZE * INPUT_LABEL.scale,
    marginBottom: INPUT_LABEL.gap,
    // Aligned with the value it names: the web's floating label and the input
    // share one left inset (14px outlined, 12px filled, 0 standard).
    marginLeft: inputPadding(variant, size).left,
  };
}

/** `FormHelperText`: caption type, 3px below the field, inset 14px when contained. */
export function helperStyle(theme: UiTheme, variant: InputVariant, state: FieldState): TextStyle {
  return {
    color: state.disabled
      ? theme.palette.text.disabled
      : state.error
        ? theme.palette.danger.main
        : theme.palette.text.secondary,
    fontFamily: theme.typography.fontFamily,
    fontSize: HELPER_TEXT.fontSize,
    lineHeight: HELPER_TEXT.fontSize * HELPER_TEXT.lineHeight,
    marginTop: HELPER_TEXT.marginTop,
    marginHorizontal: variant === 'underline' ? 0 : HELPER_TEXT.marginHorizontal,
  };
}
