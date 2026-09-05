import * as React from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text as RNText,
  TextInput as RNTextInput,
  View,
  type GestureResponderEvent,
  type InputModeOptions,
  type StyleProp,
  type TextInputProps as RNTextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { resolveInputProps } from './Input.helpers';
import { FieldPulse } from '../field-pulse.native';
import { fieldLook, helperStyle, labelStyle, type FieldState } from './Input.look.native';
import { ADORNMENT_GAP, INPUT_GLOW, INPUT_LOADING, INPUT_PULSE } from './Input.metrics';
import type { InputProps } from './Input.types.native';
import { webAria, webClick, webDisabled } from '../../../platform/aria';
import { childTestId, resolveTestId, withoutTestIdProps } from '../../../platform/test-id';
import { useUiTheme } from '../../../provider/use-ui-theme.native';

/**
 * The keyboard an HTML input `type` asks for.
 *
 * `password` is the only one that is not a keyboard at all — it is React
 * Native's `secureTextEntry`, which react-native-web turns back into
 * `type="password"`. Everything the map does not name (`date`, `file`, `color`)
 * has no React Native equivalent and falls through to a plain text field.
 */
const INPUT_MODE_FOR: Record<string, InputModeOptions> = {
  text: 'text',
  search: 'search',
  email: 'email',
  tel: 'tel',
  url: 'url',
  number: 'numeric',
};

export function typeProps(type: string | undefined): {
  inputMode?: InputModeOptions;
  secureTextEntry?: boolean;
} {
  if (type === 'password') return { secureTextEntry: true };
  const mode = type === undefined ? undefined : INPUT_MODE_FOR[type];
  return mode === undefined ? {} : { inputMode: mode };
}

/** MUI's `0 0 15px` halo, 20px and stronger once the field is focused. */
function glowStyle(color: string, focused: boolean): ViewStyle {
  const glow = focused ? INPUT_GLOW.focused : INPUT_GLOW.rest;
  return Platform.select<ViewStyle>({
    android: { elevation: glow.blur / 2 },
    default: {
      shadowColor: color,
      shadowOpacity: glow.alpha,
      shadowRadius: glow.blur,
      shadowOffset: { width: 0, height: 0 },
    },
  });
}

/**
 * An adornment in its own slot, 8px from the value as `InputAdornment` puts it.
 *
 * No `testID`: the web field names ONE element, the `<input>` itself, so the
 * native one names the same element and nothing else. A shared story that
 * counts fields by a test-id prefix (`getAllByTestId(/perf-input-/)`) counts
 * the same number on both renderers only if this holds — the two decorations
 * below keep an id because they exist only while asked for.
 */
function Slot({
  children,
  side,
}: {
  children: React.ReactNode;
  side: 'start' | 'end';
}): React.JSX.Element | null {
  if (children == null) return null;
  return (
    <View style={[styles.slot, side === 'start' ? { marginRight: ADORNMENT_GAP } : { marginLeft: ADORNMENT_GAP }]}>
      {children}
    </View>
  );
}

/** One line of text under or over the field, or nothing at all. */
function Line({
  text,
  style,
}: {
  text: string | undefined;
  style: StyleProp<TextStyle>;
}): React.JSX.Element | null {
  if (text === undefined) return null;
  return <RNText style={style}>{text}</RNText>;
}

/** MUI's 20px `CircularProgress` in the end slot; the platform's own arc on a device. */
function Spinner({ color, testID }: { color: string; testID: string }): React.JSX.Element {
  return (
    <ActivityIndicator
      testID={testID}
      size={Platform.OS === 'ios' ? 'small' : INPUT_LOADING.spinnerSize}
      color={color}
      accessibilityLabel="loading"
    />
  );
}

/** MUI's `FormLabel` appends an asterisk to a required field's label. */
function labelText(label: string | undefined, required: boolean): string | undefined {
  if (label === undefined) return undefined;
  return required ? `${label} *` : label;
}

/** The focus flag the border and the label are drawn from, and the handlers that keep it. */
function useFocusState(
  onFocus: RNTextInputProps['onFocus'],
  onBlur: RNTextInputProps['onBlur'],
): {
  focused: boolean;
  handleFocus: NonNullable<RNTextInputProps['onFocus']>;
  handleBlur: NonNullable<RNTextInputProps['onBlur']>;
} {
  const [focused, setFocused] = React.useState(false);
  return {
    focused,
    handleFocus: (event) => {
      setFocused(true);
      onFocus?.(event);
    },
    handleBlur: (event) => {
      setFocused(false);
      onBlur?.(event);
    },
  };
}

/**
 * The native `Input`.
 *
 * The label sits ABOVE the field rather than floating into a notch in its
 * border, because React Native cannot cut a notch in a border — see
 * `NATIVE-NOTES.md`. Everything else is the web field's arithmetic:
 * `Input.look.native.ts` decides the paint, `Input.metrics.ts` holds the
 * numbers, and both renderers read the same table.
 */
export const Input = React.forwardRef<RNTextInput, InputProps>((rawProps, ref) => {
  const {
    variant, size, type, label, error, helperText, startAdornment, endAdornment,
    fullWidth, floating: _floating, glow, pulse, loading, disabled, required,
    style, inputStyle, onClick, onPress, onFocus, onBlur, ...others
  } = resolveInputProps(rawProps);

  const theme = useUiTheme();
  const { focused, handleFocus, handleBlur } = useFocusState(onFocus, onBlur);
  const inactive = disabled || loading;
  const state: FieldState = { focused: focused && !inactive, error, disabled: inactive };
  const look = fieldLook(theme, variant, size, state);

  const idFor = (suffix: string): string => childTestId(others, suffix, 'input');
  const handlePress = (event: GestureResponderEvent): void => {
    onClick?.(event);
    onPress?.(event);
  };

  return (
    <View
      style={[
        styles.root,
        fullWidth ? styles.fullWidth : styles.auto,
        loading ? styles.loading : null,
        style,
      ]}
    >
      {pulse ? (
        <FieldPulse
          color={theme.palette.primary.main}
          radius={theme.spacing(INPUT_PULSE.radiusUnits)}
          testID={idFor('pulse')}
        />
      ) : null}
      <Line text={labelText(label, required)} style={labelStyle(theme, variant, size, state)} />
      <View style={[look.box, glow ? glowStyle(theme.palette.primary.main, state.focused) : null]}>
        <Slot side="start">{startAdornment}</Slot>
        <RNTextInput
          ref={ref}
          testID={resolveTestId(others, 'input')}
          style={[look.value, inputStyle]}
          placeholderTextColor={look.placeholder}
          editable={!inactive}
          // The web input keeps focus on Enter (a form submits, the caret stays);
          // React Native dismisses the keyboard for a single-line field. A
          // caller wanting the platform behaviour passes its own.
          blurOnSubmit={false}
          aria-label={label}
          aria-disabled={inactive}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onPressIn={handlePress}
          {...webClick(handlePress)}
          {...webDisabled(inactive)}
          {...webAria({ 'aria-invalid': error, 'aria-required': required })}
          {...typeProps(type)}
          {...withoutTestIdProps(others)}
        />
        <Slot side="end">
          {loading ? <Spinner color={theme.palette.primary.main} testID={idFor('loading')} /> : endAdornment}
        </Slot>
      </View>
      <Line text={helperText} style={helperStyle(theme, variant, state)} />
    </View>
  );
});

Input.displayName = 'Input';

const styles = StyleSheet.create({
  root: {
    position: 'relative',
  },
  fullWidth: {
    alignSelf: 'stretch',
    width: '100%',
  },
  auto: {
    alignSelf: 'flex-start',
  },
  loading: {
    opacity: INPUT_LOADING.opacity,
  },
  slot: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
