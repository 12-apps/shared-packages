import * as React from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  View,
  useWindowDimensions,
  type ViewStyle,
} from 'react-native';

import {
  displayLabel,
  resolveSelectProps,
  selectItems,
  selectTestIds,
  type SelectItem,
} from './Select.helpers';
import { menuStyle, optionStyle, optionTextStyle, selectLook, type SelectLook } from './Select.look.native';
import {
  SELECT_GLOW,
  SELECT_ICON,
  SELECT_MENU,
  SELECT_PULSE,
  inputVariantFor,
  selectInputSize,
} from './Select.metrics';
import type { SelectProps, SelectValue } from './Select.types.native';
import { Icon } from '../../../icons/Icon.native';
import { webAria, webKeyDown, webRole, type WebKeyEvent } from '../../../platform/aria';
import { resolveTestId, withoutTestIdProps } from '../../../platform/test-id';
import { useUiTheme } from '../../../provider/use-ui-theme.native';
import { FieldPulse } from '../field-pulse.native';
import { helperStyle, labelStyle, type FieldState } from '../Input/Input.look.native';

/** MUI's halo on the outlined input, painted as a shadow. */
function glowStyle(color: string): ViewStyle {
  return Platform.select<ViewStyle>({
    android: { elevation: SELECT_GLOW.rest.blur / 2 },
    default: {
      shadowColor: color,
      shadowOpacity: SELECT_GLOW.rest.alpha,
      shadowRadius: SELECT_GLOW.rest.blur,
      shadowOffset: { width: 0, height: 0 },
    },
  });
}

interface MenuProps {
  items: SelectItem[];
  value: SelectValue;
  testIdFor: (value: SelectValue) => string;
  onPick: (item: SelectItem) => void;
}

/** The option list: MUI's `Menu`, under the field rather than portalled over it. */
function SelectMenu({ items, value, testIdFor, onPick }: MenuProps): React.JSX.Element {
  const theme = useUiTheme();
  const { height } = useWindowDimensions();
  const textStyle = optionTextStyle(theme);

  return (
    <View style={menuStyle(theme, height - SELECT_MENU.maxHeightInset)} {...webRole('listbox')}>
      <ScrollView>
        {items.map((item) => {
          const selected = String(item.value) === String(value);
          return (
            <Pressable
              key={`${item.placeholder ? 'placeholder' : 'option'}-${item.value}`}
              role="option"
              aria-selected={selected}
              aria-disabled={item.disabled}
              disabled={item.disabled}
              testID={item.placeholder ? undefined : testIdFor(item.value)}
              onPress={() => onPick(item)}
              style={optionStyle(theme, selected, item.disabled)}
            >
              <RNText style={textStyle}>{item.label}</RNText>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

interface TriggerProps {
  testID: string;
  look: SelectLook;
  open: boolean;
  disabled: boolean;
  error: boolean;
  glow: boolean;
  display: string;
  labelId?: string;
  helperId?: string;
  onToggle: () => void;
  onKey: (event: WebKeyEvent) => void;
}

/**
 * The field itself: MUI's display slot and its arrow, under one `combobox`.
 *
 * `tabIndex` is spelled out because react-native-web only makes a handful of
 * roles focusable on its own, and `combobox` is not one of them — without it
 * the control would not be a tab stop. It goes to -1 when disabled, which is
 * what the web does by leaving the attribute off a disabled field entirely.
 */
function SelectTrigger(props: TriggerProps): React.JSX.Element {
  const theme = useUiTheme();
  const { testID, look, open, disabled, error, glow, display, labelId, helperId } = props;

  return (
    <Pressable
      testID={testID}
      role="combobox"
      tabIndex={disabled ? -1 : 0}
      aria-expanded={open}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={props.onToggle}
      style={[look.box, glow ? glowStyle(theme.palette.primary.main) : null]}
      {...webAria({
        'aria-haspopup': 'listbox',
        'aria-invalid': error,
        ...(labelId === undefined ? {} : { 'aria-labelledby': labelId }),
        ...(helperId === undefined ? {} : { 'aria-describedby': helperId }),
      })}
      {...webKeyDown(props.onKey)}
    >
      <RNText style={look.display} numberOfLines={1}>
        {display}
      </RNText>
      <Icon
        name="ArrowDropDown"
        size={SELECT_ICON.size}
        color={disabled ? theme.palette.action.disabled : theme.palette.action.active}
        testID={`${testID}-icon`}
        style={[
          { marginLeft: look.iconGap },
          open ? { transform: [{ rotate: `${SELECT_ICON.openRotateDeg}deg` }] } : null,
        ]}
      />
    </Pressable>
  );
}

/** The value the control shows, controlled by the caller or held here. */
function useSelectValue(
  value: SelectValue | undefined,
  defaultValue: SelectValue | undefined,
): [SelectValue, (next: SelectValue) => void] {
  const [own, setOwn] = React.useState<SelectValue>(defaultValue ?? '');
  return [value ?? own, setOwn];
}

/**
 * The native `Select`.
 *
 * The list is an absolutely positioned panel under the field rather than a
 * portal over the screen: React Native's `Modal` traps focus, which is right
 * for a dialog and wrong for a dropdown — and wrong for the shared stories,
 * which expect the trigger to keep focus while the list is open. The trade is
 * recorded in `NATIVE-NOTES.md`.
 */
export const Select = React.forwardRef<View, SelectProps>((rawProps, ref) => {
  const {
    variant, options, label, helperText, fullWidth, size, placeholder, error, glow, pulse,
    disabled, value, defaultValue, onChange, onOpen, onClose, style, ...others
  } = resolveSelectProps(rawProps);

  const theme = useUiTheme();
  const [open, setOpen] = React.useState(false);
  const [current, setCurrent] = useSelectValue(value, defaultValue);
  const labelId = React.useId();
  const helperId = React.useId();

  const items = selectItems(options, placeholder);
  const ids = selectTestIds(resolveTestId(others));
  const state: FieldState = { focused: open && !disabled, error, disabled };
  const look = selectLook(theme, variant, size, state);

  const setOpenState = (next: boolean): void => {
    if (next === open) return;
    setOpen(next);
    (next ? onOpen : onClose)?.();
  };

  const handleKey = (event: WebKeyEvent): void => {
    if (event.key === 'Escape') setOpenState(false);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') setOpenState(true);
  };

  const pick = (item: SelectItem): void => {
    setOpenState(false);
    if (item.option === undefined) return;
    setCurrent(item.value);
    onChange?.({ target: { value: item.value } }, item.option);
  };

  return (
    <View
      ref={ref}
      testID={ids.root}
      style={[styles.root, fullWidth ? styles.fullWidth : styles.auto, style]}
      {...withoutTestIdProps(others)}
    >
      {pulse ? (
        <FieldPulse
          color={theme.palette.primary.main}
          radius={theme.spacing(SELECT_PULSE.radiusUnits)}
          testID={`${ids.trigger}-pulse`}
        />
      ) : null}
      {label === undefined ? null : (
        <RNText id={labelId} style={labelStyle(theme, inputVariantFor(variant), size, state)}>
          {label}
        </RNText>
      )}
      <View style={[styles.anchor, open ? { zIndex: theme.zIndex.modal } : null]}>
        <SelectTrigger
          testID={ids.trigger}
          look={look}
          open={open}
          disabled={disabled}
          error={error}
          glow={glow}
          display={displayLabel(items, current)}
          labelId={label === undefined ? undefined : labelId}
          helperId={helperText === undefined ? undefined : helperId}
          onToggle={() => setOpenState(!open)}
          onKey={handleKey}
        />
        {open ? (
          <SelectMenu items={items} value={current} testIdFor={ids.option} onPick={pick} />
        ) : null}
      </View>
      {helperText === undefined ? null : (
        <RNText id={helperId} style={helperStyle(theme, inputVariantFor(variant), selectInputSize(size), state)}>
          {helperText}
        </RNText>
      )}
    </View>
  );
});

Select.displayName = 'Select';

const styles = StyleSheet.create({
  root: {
    position: 'relative',
  },
  anchor: {
    position: 'relative',
  },
  fullWidth: {
    alignSelf: 'stretch',
    width: '100%',
  },
  auto: {
    alignSelf: 'flex-start',
  },
});
