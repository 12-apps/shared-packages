import * as React from 'react';
import {
  Platform,
  StyleSheet,
  TextInput,
  View,
  type LayoutChangeEvent,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { useNativeOtpDigits } from './InputOTP.hooks.native';
import {
  OTP_BORDER,
  OTP_FIT_GAP_PX,
  OTP_FIT_MIN_HEIGHT_PX,
  OTP_FIT_MIN_WIDTH_PX,
  OTP_FONT_PX,
  OTP_GAP_PX,
  otpFitBox,
} from './InputOTP.metrics';
import type { InputOTPProps } from './InputOTP.types.native';
import { webAria, webDisabled } from '../../../platform/aria';
import { resolveFieldEdge } from '../../../tokens/field-edge.core';
import { fieldHeightPx } from '../../../tokens/field-height.core';
import type { UiPaletteKey, UiTheme } from '../../../tokens/theme';
import type { SizeValue } from '../../../tokens/vocabulary';
import { useUiTheme } from '../../../provider/use-ui-theme.native';

const PALETTE_KEYS: readonly UiPaletteKey[] = ['primary', 'secondary', 'success', 'warning', 'info', 'danger', 'neutral'];

/** The palette slot a `color` names; anything else is `primary`, as on the web. */
function accentOf(theme: UiTheme, color: string): string {
  const key = PALETTE_KEYS.find((candidate) => candidate === color) ?? 'primary';
  return theme.palette[key].main;
}

/**
 * The keypad and the one-time-code fill, the web's `keypadProps` in React
 * Native's words: digits only for `numeric`, and on the FIRST box the hint that
 * lets the phone offer the code from an SMS — `oneTimeCode` on iOS,
 * `sms-otp` on Android.
 */
function keypadProps(variant: string, index: number): Partial<TextInputProps> {
  // A code is not prose: no capital on the first letter, no autocorrect.
  if (variant !== 'numeric') return { autoCapitalize: 'none', autoCorrect: false, spellCheck: false };
  const fill: Partial<TextInputProps> =
    index === 0
      ? Platform.select<Partial<TextInputProps>>({
          ios: { textContentType: 'oneTimeCode', autoComplete: 'one-time-code' },
          android: { autoComplete: 'sms-otp' },
          default: { autoComplete: 'one-time-code' },
        })
      : {};
  return { keyboardType: 'number-pad', inputMode: 'numeric', ...fill };
}

/** The first box takes a whole code in one change (see the web's `slotMaxLength`), except `masked`'s. */
const boxMaxLength = (variant: string, index: number, length: number): number =>
  variant !== 'masked' && index === 0 ? length + 1 : 1;

interface BoxState {
  focused: boolean;
  error: boolean;
  disabled: boolean;
}

/**
 * A box's footprint under `fit="width"`: the measured share of the row once
 * the row has been laid out, and until then a flex share bounded by the same
 * limits, so the first frame already fits the row.
 */
function fitFootprint(side: number, length: number, rowWidth: number | null): TextStyle {
  if (rowWidth !== null) return otpFitBox(rowWidth, side, length);
  const height = Math.max(side, OTP_FIT_MIN_HEIGHT_PX);
  return { height, flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: OTP_FIT_MIN_WIDTH_PX, maxWidth: height };
}

/**
 * `fit="width"`'s state: the row's width once laid out (the row stretches to
 * its parent's), the boxes' footprint from it, and the row's `onLayout`.
 * Without the option, nothing: the boxes keep their square.
 */
function useFitWidth(fit: InputOTPProps['fit'], side: number, length: number) {
  const [rowWidth, setRowWidth] = React.useState<number | null>(null);
  if (fit !== 'width') return { fitsWidth: false, footprint: undefined, onLayout: undefined };
  return {
    fitsWidth: true,
    footprint: fitFootprint(side, length, rowWidth),
    onLayout: (event: LayoutChangeEvent) => setRowWidth(event.nativeEvent.layout.width),
  };
}

/** One box's paint: the web slot's square, border and type, from the same numbers. */
function boxStyle(theme: UiTheme, size: SizeValue, accent: string, state: BoxState, footprint?: TextStyle): TextStyle {
  const side = fieldHeightPx(theme.fieldHeight, size);
  const edge = resolveFieldEdge(theme.palette.divider, theme.palette.background.paper);
  // Error and disabled outrank focus, as in MUI's outlined input (and the native `Input`).
  const borderColor = state.error
    ? theme.palette.danger.main
    : state.disabled
      ? theme.palette.action.disabled
      : state.focused
        ? accent
        : edge;
  return {
    ...(footprint ?? { width: side, height: side }),
    borderRadius: theme.radius.field,
    borderWidth: state.focused ? OTP_BORDER.focused : OTP_BORDER.rest,
    borderColor,
    backgroundColor: theme.palette.background.paper,
    color: state.disabled ? theme.palette.text.disabled : theme.palette.text.primary,
    fontFamily: theme.typography.fontFamily,
    fontSize: OTP_FONT_PX[size],
    fontWeight: '600',
    textAlign: 'center',
    padding: 0,
  };
}

/**
 * The native `InputOTP`: one row of boxes, one character each, that moves
 * forward as it is typed, steps back on Backspace in an empty box, and spreads
 * a code the phone fills (or a paste) across every box from the first.
 *
 * The same props as the web one; the row is a `group` named by `aria-label`,
 * each box is `${dataTestId}-slot-${index}`. Gaps against the web:
 * `NATIVE-NOTES.md`.
 */
export const InputOTP = React.forwardRef<View, InputOTPProps>((props, ref) => {
  const {
    variant = 'numeric',
    color = 'primary',
    size = 'md',
    length = 6,
    value = '',
    onChange,
    onComplete,
    autoFocus = false,
    error = false,
    disabled = false,
    dataTestId,
    fit,
    style,
    'aria-label': ariaLabel,
  } = props;

  const theme = useUiTheme();
  const accent = accentOf(theme, color);
  const [focusedIndex, setFocusedIndex] = React.useState<number | null>(null);
  const { fitsWidth, footprint, onLayout } = useFitWidth(fit, fieldHeightPx(theme.fieldHeight, size), length);
  const { digits, boxRefs, handleChangeText, handleKey } = useNativeOtpDigits({
    variant,
    length,
    value,
    onChange,
    onComplete,
  });

  return (
    <View
      ref={ref}
      testID={dataTestId}
      role="group"
      aria-label={ariaLabel}
      onLayout={onLayout}
      style={[styles.row, fitsWidth && styles.fitRow, style]}
    >
      {digits.map((digit, index) => (
        <TextInput
          key={index}
          ref={(element) => {
            boxRefs.current[index] = element;
          }}
          testID={dataTestId ? `${dataTestId}-slot-${index}` : undefined}
          value={variant === 'masked' ? (digit ? '•' : '') : digit}
          onChangeText={(text) => handleChangeText(index, text)}
          onKeyPress={(event) => handleKey(index, event.nativeEvent.key)}
          onFocus={() => setFocusedIndex(index)}
          onBlur={() => setFocusedIndex((current) => (current === index ? null : current))}
          autoFocus={autoFocus && index === 0}
          editable={!disabled}
          aria-disabled={disabled}
          {...webAria({ 'aria-invalid': error })}
          maxLength={boxMaxLength(variant, index, length)}
          style={boxStyle(theme, size, accent, { focused: focusedIndex === index && !disabled, error, disabled }, footprint)}
          {...webDisabled(disabled)}
          {...keypadProps(variant, index)}
        />
      ))}
    </View>
  );
});

InputOTP.displayName = 'InputOTP';

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: OTP_GAP_PX,
  },
  /** `fit="width"`: the parent's whole width, shared by the boxes at the prototype's gap. */
  fitRow: {
    alignSelf: 'stretch',
    gap: OTP_FIT_GAP_PX,
  } satisfies ViewStyle,
});
