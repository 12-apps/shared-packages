'use client';

/**
 * `TextField`, minus the branch nobody in a text field takes.
 *
 * MUI's `TextField` is a small composition — a `FormControl` root, an optional
 * `InputLabel`, one of the three input variants, an optional `FormHelperText` —
 * around one branch: `select`. That branch is worth a fortune. `TextField`
 * imports `Select` unconditionally, and `Select` reaches `Menu`, `MenuList`,
 * `Popover`, `NativeSelect`, `List`, `Modal`, `Paper`, `Portal` and `Grow`. Every
 * one of those ships to anyone who renders one text box.
 *
 * Measured in one adopter's storefront, whose header search box is the eager
 * caller: taking that ONE box off `TextField` is worth 35.8 KiB raw and 13
 * fewer `@mui/material` component modules on the critical path — more than any
 * other single item in that bundle.
 *
 * `Input` has never supported `select`: its props are `InputHTMLAttributes`, so
 * no caller can even pass one. The branch was pure cost.
 *
 * ## This is a TRANSCRIPTION, not a redesign
 *
 * Every routing decision below is `TextField`'s, deliberately, down to which
 * props land on the ROOT rather than on the input — including the one that is
 * arguably wrong (an unrecognised HTML attribute goes to the root `div`, which
 * is why `Input` has to route `aria-label` through `inputProps`). Changing any
 * of that here would be a behaviour change wearing a performance change's
 * clothes. `__tests__/text-field-slim.test.tsx` renders this and the real
 * `TextField` side by side and compares the DOM they produce.
 *
 * What is NOT carried over: the `select` branch, the `slots`/`slotProps` API
 * (unreachable through `InputProps`, which is `InputHTMLAttributes`), and the
 * dev-only warning about `children` that only the select branch could emit.
 */
import FilledInput from '@mui/material/FilledInput';
import FormControl from '@mui/material/FormControl';
import FormHelperText from '@mui/material/FormHelperText';
import StandardInput from '@mui/material/Input';
import InputLabel from '@mui/material/InputLabel';
import OutlinedInput from '@mui/material/OutlinedInput';
import { styled } from '@mui/material/styles';
import type { FilledInputProps } from '@mui/material/FilledInput';
import type { FormControlProps } from '@mui/material/FormControl';
import type { FormHelperTextProps } from '@mui/material/FormHelperText';
import type { InputProps as MuiInputProps } from '@mui/material/Input';
import type { InputBaseComponentProps } from '@mui/material/InputBase';
import type { InputLabelProps } from '@mui/material/InputLabel';
import type { OutlinedInputProps } from '@mui/material/OutlinedInput';
import React from 'react';

import { withDefaults } from '../../../utils/withDefaults';

const VARIANT_COMPONENT = {
  standard: StandardInput,
  filled: FilledInput,
  outlined: OutlinedInput,
} as const;

/**
 * `MuiTextField-root`, by hand.
 *
 * `@mui/material` does not re-export `textFieldClasses` from its root barrel,
 * and the deep path that does would import `TextField` — the whole thing this
 * file exists to avoid. So the class name is written out, and the parity test
 * asserts it against a REAL `TextField`'s root rather than against itself.
 *
 * It has to be there at all because it is part of MUI's public surface: two of
 * this package's own suites reach for `.closest('.MuiTextField-root')`, and a
 * consumer's stylesheet may too.
 */
const TEXT_FIELD_ROOT_CLASS = 'MuiTextField-root';

/**
 * Named `MuiTextField` so a theme's `components.MuiTextField.styleOverrides`
 * keeps applying. Nothing in this repo sets one today; a consumer's theme is
 * not this package's to break.
 */
const TextFieldSlimRoot = styled(FormControl, {
  name: 'MuiTextField',
  slot: 'Root',
  overridesResolver: (_props, styles) => styles.root,
})({});

export interface TextFieldSlimProps
  extends Omit<FormControlProps, 'onChange' | 'onBlur' | 'onFocus' | 'defaultValue'> {
  autoComplete?: string;
  autoFocus?: boolean;
  defaultValue?: unknown;
  helperText?: React.ReactNode;
  label?: React.ReactNode;
  maxRows?: number | string;
  minRows?: number | string;
  multiline?: boolean;
  name?: string;
  placeholder?: string;
  rows?: number | string;
  type?: React.InputHTMLAttributes<HTMLInputElement>['type'];
  value?: unknown;
  inputRef?: React.Ref<unknown>;
  onBlur?: React.FocusEventHandler<HTMLInputElement | HTMLTextAreaElement>;
  onChange?: React.ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement>;
  onFocus?: React.FocusEventHandler<HTMLInputElement | HTMLTextAreaElement>;
  /** Props for the rendered input variant. */
  InputProps?: Partial<MuiInputProps & FilledInputProps & OutlinedInputProps>;
  /**
   * Props for the `<input>` itself — where an `aria-label` has to ride.
   *
   * MUI's own type, because it is deliberately open: a caller puts `data-*`
   * and `aria-*` here precisely because the root would swallow them, and
   * `InputHTMLAttributes` alone rejects both.
   */
  inputProps?: InputBaseComponentProps;
  InputLabelProps?: Partial<InputLabelProps>;
  FormHelperTextProps?: Partial<FormHelperTextProps>;
}

/**
 * `TextField`'s own defaults, as a table.
 *
 * One `= default` per destructured prop is one branch per prop, and eight of
 * them put this component over the complexity bar before it rendered anything —
 * which is the same reason `AppHeader` keeps its defaults in a table. The values
 * are `TextField`'s, unchanged; the parity test would fail if any drifted.
 */
const DEFAULTS: Partial<TextFieldSlimProps> = {
  autoFocus: false,
  color: 'primary',
  disabled: false,
  error: false,
  fullWidth: false,
  multiline: false,
  required: false,
  variant: 'outlined',
};

/** The two ids a labelled, described field needs, and the input's own. */
function idsOf(props: TextFieldSlimProps, generated: string): {
  id: string;
  helperTextId: string | undefined;
  inputLabelId: string | undefined;
} {
  const id = props.id ?? generated;
  return {
    id,
    helperTextId: props.helperText && id ? `${id}-helper-text` : undefined,
    inputLabelId: props.label && id ? `${id}-label` : undefined,
  };
}

/**
 * What only the OUTLINED variant needs: it draws its own notch around the
 * label, so it has to be told the label and whether the caller pinned it shrunk
 * (FUT-729's `shrink` case).
 */
function outlinedPropsOf(props: TextFieldSlimProps): Record<string, unknown> {
  if (props.variant !== 'outlined') return {};
  const shrink = props.InputLabelProps?.shrink;
  return { label: props.label, ...(shrink === undefined ? {} : { notched: shrink }) };
}

interface FieldIds {
  id: string;
  helperTextId: string | undefined;
  inputLabelId: string | undefined;
}

/**
 * Everything the input (or this component) consumes by name.
 *
 * A key LIST rather than the omit-by-destructuring idiom, which would name
 * twenty-four bindings only to leave every one of them unused — twenty-four
 * lint warnings, in a package that allows none.
 *
 * `fullWidth`, `disabled`, `error`, `required`, `color` and `variant` are
 * deliberately absent: `TextField` hands those to the root, and `fullWidth` to
 * both.
 */
const CONSUMED_BY_FIELD: ReadonlySet<string> = new Set([
  'autoComplete', 'autoFocus', 'children', 'className', 'defaultValue',
  'FormHelperTextProps', 'helperText', 'id', 'InputLabelProps', 'inputProps',
  'InputProps', 'inputRef', 'label', 'maxRows', 'minRows', 'multiline', 'name',
  'onBlur', 'onChange', 'onFocus', 'placeholder', 'rows', 'type', 'value',
]);

/**
 * What the ROOT `FormControl` gets: the props `TextField` hands it by name,
 * plus everything it did not recognise.
 *
 * That second half is `TextField`'s behaviour and not a choice made here: an
 * unrecognised HTML attribute lands on the root `div`, which is why `Input` has
 * to route `aria-label` through `inputProps`. The parity test pins it.
 */
function rootPropsOf(props: TextFieldSlimProps): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(props).filter(([key]) => !CONSUMED_BY_FIELD.has(key)),
  );
}

/** What the INPUT gets, by name, exactly as `TextField` names them. */
function fieldPropsOf(props: TextFieldSlimProps, ids: FieldIds): Record<string, unknown> {
  return {
    'aria-describedby': ids.helperTextId,
    autoComplete: props.autoComplete,
    autoFocus: props.autoFocus,
    defaultValue: props.defaultValue,
    fullWidth: props.fullWidth,
    multiline: props.multiline,
    name: props.name,
    rows: props.rows,
    maxRows: props.maxRows,
    minRows: props.minRows,
    type: props.type,
    value: props.value,
    id: ids.id,
    inputRef: props.inputRef,
    onBlur: props.onBlur,
    onChange: props.onChange,
    onFocus: props.onFocus,
    placeholder: props.placeholder,
    inputProps: props.inputProps,
    ...outlinedPropsOf(props),
    ...props.InputProps,
  };
}

export const TextFieldSlim = React.forwardRef<HTMLDivElement, TextFieldSlimProps>(
  function TextFieldSlim(rawProps, ref) {
    const props = withDefaults(rawProps, DEFAULTS);
    // `TextField` uses `@mui/utils`'s `useId`, which is React's with a fallback
    // for React 17. The peer here is React 19, so React's own is the same thing
    // without the dependency. The override still wins, exactly as it did — and
    // it is read from the RAW props, before `withDefaults` could supply one.
    const ids = idsOf(rawProps, React.useId());
    const InputComponent = VARIANT_COMPONENT[props.variant ?? 'outlined'];
    const { label, helperText } = props;

    return (
      <TextFieldSlimRoot
        className={[TEXT_FIELD_ROOT_CLASS, props.className].filter(Boolean).join(' ')}
        ref={ref}
        {...rootPropsOf(props)}
      >
        {label !== null && label !== undefined && label !== '' ? (
          <InputLabel htmlFor={ids.id} id={ids.inputLabelId} {...props.InputLabelProps}>
            {label}
          </InputLabel>
        ) : null}
        <InputComponent {...fieldPropsOf(props, ids)} />
        {helperText ? (
          <FormHelperText id={ids.helperTextId} {...props.FormHelperTextProps}>
            {helperText}
          </FormHelperText>
        ) : null}
      </TextFieldSlimRoot>
    );
  },
);
