import type { TextStyle, ViewStyle } from 'react-native';

import {
  MUI_MENU_SHADOW,
  SELECT_DISPLAY_MIN_HEIGHT,
  SELECT_ICON,
  SELECT_ICON_GAP,
  SELECT_MENU,
  inputVariantFor,
  selectedWashAlpha,
} from './Select.metrics';
import type { SelectVariant } from './Select.base';
import { INPUT_FONT_SIZE, INPUT_LINE_HEIGHT } from '../Input/Input.metrics';
import { fieldLook, horizontalBorderInset, type FieldState } from '../Input/Input.look.native';
import { alpha } from '../../../tokens/color';
import type { UiTheme } from '../../../tokens/theme';
import type { SizeValue } from '../../../tokens/vocabulary';

/**
 * WHAT A NATIVE `Select` PAINTS.
 *
 * The box is the `Input`'s box: a select on the web is an `OutlinedInput` with
 * a display slot where the value would be typed, so `fieldLook` decides the
 * fill, the edges and the inset, and this file only says what a select adds —
 * room for the arrow, and the list under it.
 */
export interface SelectLook {
  box: ViewStyle;
  display: TextStyle;
  iconGap: number;
}

export function selectLook(
  theme: UiTheme,
  variant: SelectVariant,
  size: SizeValue,
  state: FieldState,
): SelectLook {
  const inputVariant = inputVariantFor(variant);
  const look = fieldLook(theme, inputVariant, size, state);
  const inset = horizontalBorderInset(inputVariant, state.focused);

  return {
    box: {
      ...look.box,
      // MUI's arrow is absolute at `right: 7`; laid out in flow it takes the
      // row's right inset instead, and {@link SELECT_ICON_GAP} makes up the
      // difference so the value still stops 32px from the edge.
      paddingRight: SELECT_ICON.right - inset,
    },
    display: {
      ...look.value,
      minHeight: SELECT_DISPLAY_MIN_HEIGHT,
      fontSize: INPUT_FONT_SIZE,
      lineHeight: INPUT_LINE_HEIGHT,
    },
    iconGap: SELECT_ICON_GAP,
  };
}

/** The option list's paper: MUI's `Menu`, at elevation 8 on the theme's radius. */
export function menuStyle(theme: UiTheme, maxHeight: number): ViewStyle {
  return {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    zIndex: theme.zIndex.modal,
    maxHeight,
    paddingVertical: SELECT_MENU.listPaddingVertical,
    backgroundColor: theme.palette.background.paper,
    borderRadius: theme.radius.md,
    boxShadow: MUI_MENU_SHADOW,
  };
}

/** One `MenuItem`: 48px tall at least, 6px by 16px of padding, washed when selected. */
export function optionStyle(theme: UiTheme, selected: boolean, disabled: boolean): ViewStyle {
  return {
    minHeight: SELECT_MENU.itemMinHeight,
    justifyContent: 'center',
    paddingVertical: SELECT_MENU.itemPaddingVertical,
    paddingHorizontal: SELECT_MENU.itemPaddingHorizontal,
    backgroundColor: selected
      ? alpha(theme.palette.primary.main, selectedWashAlpha(theme))
      : 'transparent',
    opacity: disabled ? SELECT_MENU.disabledOpacity : 1,
  };
}

/** A `MenuItem`'s label: MUI's `body1`, the same type the display slot sets. */
export function optionTextStyle(theme: UiTheme): TextStyle {
  return {
    color: theme.palette.text.primary,
    fontFamily: theme.typography.fontFamily,
    fontSize: INPUT_FONT_SIZE,
    lineHeight: INPUT_LINE_HEIGHT,
  };
}
