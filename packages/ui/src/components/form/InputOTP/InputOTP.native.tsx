import * as React from 'react';
import {
  Platform,
  StyleSheet,
  TextInput as RNTextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
  type TextInputProps as RNTextInputProps,
  type TextStyle,
} from 'react-native';

import { digitsOf, isComplete, keyMove, padTo, slotChange, slotMaxLength, type OtpChange } from './InputOTP.core';
import { OTP_BORDER, OTP_FONT_PX, OTP_FONT_WEIGHT, OTP_GAP_UNITS, OTP_GLASS_ALPHA } from './InputOTP.metrics';
import type { InputOTPProps } from './InputOTP.types.native';
import { EN_US_UI_LABELS } from '../../../en-US.labels';
import { webAria, webDisabled } from '../../../platform/aria';
import { resolveTestId } from '../../../platform/test-id';
import { alpha } from '../../../tokens/color';
import { resolveFieldEdge } from '../../../tokens/field-edge.core';
import { fieldHeightPx } from '../../../tokens/field-height.core';
import type { UiTheme } from '../../../tokens/theme';
import type { ColorValue, SizeValue } from '../../../tokens/vocabulary';
import { useUiTheme } from '../../../provider/use-ui-theme.native';
import { withDefaults } from '../../../utils/withDefaults';

/** How one slot is drawn: the states its border and ink are decided from. */
interface SlotLook {
  color: ColorValue;
  size: SizeValue;
  focused: boolean;
  error: boolean;
  disabled: boolean;
  glass: boolean;
}

/**
 * The border a slot draws. Disabled wins, then the error (every slot, focused
 * or not), then the focus ring in the accent; at rest, the field's own edge.
 * `gradient` focuses in the accent's `main` — its gradient's first stop.
 */
function borderOf(theme: UiTheme, look: SlotLook): { color: string; width: number } {
  const width = look.focused && !look.disabled ? OTP_BORDER.focused : OTP_BORDER.rest;
  if (look.disabled) return { color: theme.palette.action.disabled, width };
  if (look.error) return { color: theme.palette.danger.main, width };
  if (look.focused) return { color: theme.palette[look.color].main, width };
  return { color: resolveFieldEdge(theme.palette.divider, theme.palette.background.paper), width };
}

/**
 * One slot's style. Its side is the theme's field height for the size — the
 * web's square — but it may SHRINK: six `md` slots and their gaps are 280dp,
 * and inside a padded sheet on a 320dp phone that is more than the row has.
 * Shrinking keeps the code on ONE line at any width rather than wrapping it.
 */
function slotStyle(theme: UiTheme, look: SlotLook): TextStyle {
  const side = fieldHeightPx(theme.fieldHeight, look.size);
  const border = borderOf(theme, look);
  return {
    flexBasis: side,
    flexGrow: 0,
    flexShrink: 1,
    minWidth: 0,
    maxWidth: side,
    height: side,
    padding: 0,
    borderRadius: theme.radius.field,
    borderWidth: border.width,
    borderColor: border.color,
    borderStyle: 'solid',
    backgroundColor: look.glass ? alpha(theme.palette.background.paper, OTP_GLASS_ALPHA) : 'transparent',
    color: look.disabled ? theme.palette.text.disabled : theme.palette.text.primary,
    fontFamily: theme.typography.fontFamily,
    fontSize: OTP_FONT_PX[look.size],
    fontWeight: String(OTP_FONT_WEIGHT) as TextStyle['fontWeight'],
    textAlign: 'center',
  };
}

/**
 * What tells a phone a `numeric` code is digits: the number pad on every slot,
 * and on the FIRST the one-time-code fill (iOS `oneTimeCode`, Android's SMS
 * autofill `sms-otp`, `one-time-code` on the web) — the slot that takes a whole
 * code and spreads it. `alphanumeric` and `masked` keep the text keyboard.
 */
function keypadProps(variant: InputOTPProps['variant'], index: number): Partial<RNTextInputProps> {
  if (variant !== 'numeric') return {};
  if (index !== 0) return { inputMode: 'numeric' };
  return {
    inputMode: 'numeric',
    textContentType: 'oneTimeCode',
    autoComplete: Platform.OS === 'android' ? 'sms-otp' : 'one-time-code',
  };
}

interface OtpState {
  digits: string[];
  /** Applies a change; a refused one re-renders with the same digits, so the field drops what it showed. */
  apply: (change: OtpChange) => void;
  refs: React.MutableRefObject<(RNTextInput | null)[]>;
}

/**
 * The digits and the refs focus moves through. The rules are
 * `InputOTP.core.ts`, the same ones the web hook applies.
 */
function useOtpState(
  length: number,
  value: string,
  onChange: InputOTPProps['onChange'],
  onComplete: InputOTPProps['onComplete'],
): OtpState {
  const [digits, setDigits] = React.useState<string[]>(() => padTo([], length));
  const [, refuse] = React.useReducer((n: number) => n + 1, 0);
  const refs = React.useRef<(RNTextInput | null)[]>([]);

  React.useEffect(() => {
    setDigits(digitsOf(value, length));
  }, [value, length]);

  const apply = (change: OtpChange): void => {
    // React Native keeps what the keyboard typed unless the value it is given
    // changes or the field re-renders: a refused keystroke must re-render.
    if (change.kind === 'none') return refuse();
    setDigits(change.digits);
    onChange?.(change.value);
    if (isComplete(change.value, length)) onComplete?.(change.value);
    if (change.focus !== null) refs.current[change.focus]?.focus();
  };

  return { digits, apply, refs };
}

/**
 * The native `InputOTP`: one `TextInput` per slot in a row named by
 * `aria-label`. Typing moves forward, Backspace in an empty slot steps back,
 * and a whole code written into the first slot — an SMS fill or a paste —
 * spreads across all of them.
 */
const DEFAULTS = {
  variant: 'numeric',
  color: 'primary',
  size: 'md',
  length: 6,
  value: '',
  glass: false,
  autoFocus: false,
  error: false,
  disabled: false,
} satisfies Partial<InputOTPProps>;

type ResolvedProps = InputOTPProps & Required<Pick<InputOTPProps, keyof typeof DEFAULTS>>;

export const InputOTP = React.forwardRef<View, InputOTPProps>((props, ref) => {
  const {
    variant, color, size, length, value, onChange, onComplete,
    glass, autoFocus, error, disabled, labels, style, 'aria-label': ariaLabel,
  } = withDefaults(props, DEFAULTS) as ResolvedProps;

  const theme = useUiTheme();
  const testId = resolveTestId(props);
  const slotLabel = labels?.slot ?? EN_US_UI_LABELS.inputOtp.slot;
  const { digits, apply, refs } = useOtpState(length, value, onChange, onComplete);
  const [focusedIndex, setFocusedIndex] = React.useState<number | null>(null);

  const handleKeyPress = (index: number, event: NativeSyntheticEvent<TextInputKeyPressEventData>): void => {
    const target = keyMove(event.nativeEvent.key, index, length, digits);
    if (target !== null) refs.current[target]?.focus();
  };

  return (
    <View
      ref={ref}
      testID={testId}
      role="group"
      aria-label={ariaLabel}
      style={[styles.row, { gap: theme.spacing(OTP_GAP_UNITS) }, style]}
    >
      {digits.map((digit, index) => (
        <RNTextInput
          key={index}
          ref={(el) => {
            refs.current[index] = el;
          }}
          testID={testId ? `${testId}-slot-${index}` : undefined}
          // `masked` keeps the digit in state and shows a bullet in its place.
          value={variant === 'masked' ? (digit ? '•' : '') : digit}
          onChangeText={(text) => apply(slotChange({ variant, length, digits, index, inputValue: text }))}
          onKeyPress={(event) => handleKeyPress(index, event)}
          onFocus={() => setFocusedIndex(index)}
          onBlur={() => setFocusedIndex((current) => (current === index ? null : current))}
          maxLength={slotMaxLength(variant, index, length)}
          autoFocus={autoFocus && index === 0}
          editable={!disabled}
          aria-label={slotLabel(index + 1, length)}
          aria-disabled={disabled}
          {...webDisabled(disabled)}
          {...webAria({ 'aria-invalid': error })}
          {...keypadProps(variant, index)}
          style={slotStyle(theme, { color, size, focused: focusedIndex === index, error, disabled, glass })}
        />
      ))}
    </View>
  );
});

InputOTP.displayName = 'InputOTP';

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
