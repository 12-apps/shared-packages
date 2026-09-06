import * as React from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text as RNText,
  View,
  type GestureResponderEvent,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { makeTestId, resolveCheckboxProps } from './Checkbox.helpers';
import {
  CHECKBOX_GLOW,
  CHECKBOX_GLYPH,
  CHECKBOX_HELPER,
  CHECKBOX_LABEL,
  CHECKBOX_PADDING,
  CHECKBOX_SPINNER,
  CHECKBOX_VARIANT,
  effectInk,
  glyphSize,
} from './Checkbox.metrics';
import type { CheckboxProps } from './Checkbox.types.native';
import { Icon } from '../../../icons/Icon.native';
import type { IconName } from '../../../icons/Icon.types';
import { webKeyDown } from '../../../platform/aria';
import { resolveTestId, withoutTestIdProps } from '../../../platform/test-id';
import { useUiTheme } from '../../../provider/use-ui-theme.native';
import { alpha } from '../../../tokens/color';
import type { UiTheme } from '../../../tokens/theme';

/** Which of MUI's three glyphs the box is in right now. */
function glyphFor(checked: boolean, indeterminate: boolean): IconName {
  if (indeterminate) return CHECKBOX_GLYPH.indeterminate;
  return checked ? CHECKBOX_GLYPH.checked : CHECKBOX_GLYPH.unchecked;
}

/**
 * The ink the box is drawn in.
 *
 * MUI's own rule paints a checked box in `palette[color].main`, but
 * `Checkbox.tsx` overrides `.Mui-checked` with `primary.main` and wins on
 * source order — so every colour checks blue on the web, and here too.
 */
function glyphInk(theme: UiTheme, checked: boolean, indeterminate: boolean, disabled: boolean): string {
  if (disabled) return theme.palette.action.disabled;
  if (checked || indeterminate) return theme.palette.primary.main;
  return theme.palette.text.secondary;
}

/** `glow` as a shadow; the web breathes it between two blurs, which needs keyframes. */
function glowStyle(): ViewStyle {
  return Platform.select<ViewStyle>({
    android: { elevation: CHECKBOX_GLOW.blur.to / 2 },
    default: {
      shadowColor: effectInk(1),
      shadowOpacity: CHECKBOX_GLOW.alpha.from,
      shadowRadius: CHECKBOX_GLOW.blur.from,
      shadowOffset: { width: 0, height: 0 },
    },
  });
}

/** The `rounded` and `toggle` variants' corner and scale, on the glyph's own box. */
function variantStyle(variant: keyof typeof CHECKBOX_VARIANT, size: number): ViewStyle {
  const treatment = CHECKBOX_VARIANT[variant];
  if (treatment.radius === undefined) return {};
  return {
    overflow: 'hidden',
    borderRadius: typeof treatment.radius === 'number' ? treatment.radius : size / 2,
    ...(treatment.scale === undefined ? {} : { transform: [{ scale: treatment.scale }] }),
  };
}

interface BoxProps {
  boxRef: React.ForwardedRef<View>;
  testID: string;
  checked: boolean;
  indeterminate: boolean;
  inactive: boolean;
  loading: boolean;
  glow: boolean;
  ripple: boolean;
  variant: keyof typeof CHECKBOX_VARIANT;
  size: number;
  label?: string;
  onToggle: (event?: GestureResponderEvent) => void;
  rest: Record<string, unknown>;
}

/** The box itself: MUI's glyph inside `SwitchBase`'s 9px of padding. */
function CheckboxBox(props: BoxProps): React.JSX.Element {
  const theme = useUiTheme();
  const { checked, indeterminate, inactive, size, variant } = props;
  const ink = glyphInk(theme, checked, indeterminate, inactive);

  return (
    <Pressable
      ref={props.boxRef}
      testID={props.testID}
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-disabled={inactive}
      aria-label={props.label}
      disabled={inactive}
      onPress={props.onToggle}
      android_ripple={
        props.ripple && !inactive
          ? { color: alpha(theme.palette.primary.main, 0.2), borderless: true }
          : undefined
      }
      {...webKeyDown((event) => {
        if (event.key === ' ' || event.key === 'Spacebar') props.onToggle();
      })}
      style={[styles.box, props.glow ? glowStyle() : null]}
      {...props.rest}
    >
      <View style={variantStyle(variant, size)}>
        <Icon name={glyphFor(checked, indeterminate)} size={size} color={ink} />
      </View>
      {props.loading ? (
        <ActivityIndicator
          style={styles.spinner}
          size={CHECKBOX_SPINNER.size}
          color={theme.palette.primary.main}
          accessibilityLabel="loading"
        />
      ) : null}
    </Pressable>
  );
}

/** MUI's `FormControlLabel` label, in `body2` and the error hue when it errs. */
function labelStyle(theme: UiTheme, error: boolean): TextStyle {
  return {
    color: error ? theme.palette.danger.main : theme.palette.text.primary,
    fontFamily: theme.typography.fontFamily,
    fontSize: CHECKBOX_LABEL.fontSize,
    marginLeft: CHECKBOX_LABEL.marginLeft,
  };
}

/** `FormHelperText`, four spacing units in and half a unit down. */
function helperStyle(theme: UiTheme, error: boolean): TextStyle {
  return {
    color: error ? theme.palette.danger.main : theme.palette.text.secondary,
    fontFamily: theme.typography.fontFamily,
    fontSize: CHECKBOX_HELPER.fontSize,
    lineHeight: CHECKBOX_HELPER.fontSize * CHECKBOX_HELPER.lineHeight,
    marginLeft: theme.spacing(CHECKBOX_HELPER.marginLeftUnits),
    marginTop: theme.spacing(CHECKBOX_HELPER.marginTopUnits),
  };
}

/**
 * The native `Checkbox`.
 *
 * The box is the glyph MUI's own `Checkbox` draws — `@12-apps/ui/icons`
 * generates its path from the same `@mui/icons-material` — inside
 * `SwitchBase`'s 9px of padding, under a pressable carrying `role="checkbox"`
 * and `aria-checked`: the state the web's hidden `<input type="checkbox">`
 * carries. See `NATIVE-NOTES.md`.
 */
export const Checkbox = React.forwardRef<View, CheckboxProps>((rawProps, ref) => {
  const {
    variant, label, error, helperText, loading, ripple, glow, pulse: _pulse,
    indeterminate, disabled, size, checked, defaultChecked,
    onChange, onClick, onPress, style, ...others
  } = resolveCheckboxProps(rawProps);

  const theme = useUiTheme();
  // `Boolean()` rather than a destructuring default for each: every `= false`
  // is a branch, and there are enough of them here to cost the size gate.
  const [own, setOwn] = React.useState(Boolean(defaultChecked));
  const current = checked ?? own;
  const inactive = Boolean(disabled) || Boolean(loading);
  const testId = makeTestId(resolveTestId(others));

  const toggle = (event?: GestureResponderEvent): void => {
    const next = !current;
    setOwn(next);
    onChange?.({ target: { checked: next } }, next);
    if (event === undefined) return;
    onClick?.(event);
    onPress?.(event);
  };

  const box = (
    <CheckboxBox
      boxRef={ref}
      testID={resolveTestId(others, 'checkbox') ?? 'checkbox'}
      checked={current}
      indeterminate={Boolean(indeterminate)}
      inactive={inactive}
      loading={Boolean(loading)}
      glow={glow}
      ripple={ripple}
      variant={variant}
      size={glyphSize(size)}
      label={label}
      onToggle={toggle}
      rest={withoutTestIdProps(others) as Record<string, unknown>}
    />
  );

  if (label === undefined) return box;

  return (
    <View testID={testId('container')} style={style}>
      <View style={styles.row}>
        {box}
        <RNText style={labelStyle(theme, Boolean(error))}>{label}</RNText>
      </View>
      {helperText === undefined ? null : (
        <RNText testID={testId('helper')} style={helperStyle(theme, Boolean(error))}>
          {helperText}
        </RNText>
      )}
    </View>
  );
});

Checkbox.displayName = 'Checkbox';

const styles = StyleSheet.create({
  box: {
    padding: CHECKBOX_PADDING,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  spinner: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginTop: CHECKBOX_SPINNER.offset,
    marginLeft: CHECKBOX_SPINNER.offset,
  },
});
