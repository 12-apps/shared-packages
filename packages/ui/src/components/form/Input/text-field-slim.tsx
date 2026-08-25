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
 * Measured on the Future Pay storefront, whose header search box is the eager
 * caller: taking that ONE box off `TextField` is worth 73.3 KiB raw / 16.9 KiB
 * brotli and 23 fewer `@mui/material` component modules on the critical path —
 * more than any other single item in that bundle.
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
import {
  FilledInput,
  FormControl,
  FormHelperText,
  Input as StandardInput,
  InputLabel,
  OutlinedInput,
  styled,
} from '@mui/material';
import type {
  FilledInputProps,
  FormControlProps,
  FormHelperTextProps,
  InputBaseComponentProps,
  InputLabelProps,
  InputProps as MuiInputProps,
  OutlinedInputProps,
} from '@mui/material';
import React from 'react';

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

export const TextFieldSlim = React.forwardRef<HTMLDivElement, TextFieldSlimProps>(
  function TextFieldSlim(props, ref) {
    const {
      // `children` is deliberately NOT destructured: `TextField` renders it only
      // inside the select branch, so for a text box it is dropped. Naming it
      // here would silently start rendering something MUI never did.
      autoComplete,
      autoFocus = false,
      className,
      color = 'primary',
      defaultValue,
      disabled = false,
      error = false,
      FormHelperTextProps: formHelperTextProps,
      fullWidth = false,
      helperText,
      id: idOverride,
      InputLabelProps: inputLabelProps,
      inputProps,
      InputProps: inputComponentProps,
      inputRef,
      label,
      maxRows,
      minRows,
      multiline = false,
      name,
      onBlur,
      onChange,
      onFocus,
      placeholder,
      required = false,
      rows,
      type,
      value,
      variant = 'outlined',
      ...other
    } = props;

    // `TextField` uses `@mui/utils`'s `useId`, which is React's with a fallback
    // for React 17. The peer here is React 19, so React's own is the same thing
    // without the dependency. The override still wins, exactly as it did.
    const generatedId = React.useId();
    const id = idOverride ?? generatedId;
    const helperTextId = helperText && id ? `${id}-helper-text` : undefined;
    const inputLabelId = label && id ? `${id}-label` : undefined;
    const InputComponent = VARIANT_COMPONENT[variant];

    // Outlined draws its own notch around the label, so it needs to know both
    // the label and whether the caller pinned it shrunk (FUT-729's `shrink`).
    const outlinedProps =
      variant === 'outlined'
        ? {
            label,
            ...(inputLabelProps?.shrink === undefined ? {} : { notched: inputLabelProps.shrink }),
          }
        : {};

    return (
      <TextFieldSlimRoot
        className={[TEXT_FIELD_ROOT_CLASS, className].filter(Boolean).join(' ')}
        ref={ref}
        disabled={disabled}
        error={error}
        fullWidth={fullWidth}
        required={required}
        color={color}
        variant={variant}
        {...other}
      >
        {label !== null && label !== undefined && label !== '' ? (
          <InputLabel htmlFor={id} id={inputLabelId} {...inputLabelProps}>
            {label}
          </InputLabel>
        ) : null}
        <InputComponent
          aria-describedby={helperTextId}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          defaultValue={defaultValue}
          fullWidth={fullWidth}
          multiline={multiline}
          name={name}
          rows={rows}
          maxRows={maxRows}
          minRows={minRows}
          type={type}
          value={value}
          id={id}
          inputRef={inputRef}
          onBlur={onBlur}
          onChange={onChange}
          onFocus={onFocus}
          placeholder={placeholder}
          inputProps={inputProps}
          {...outlinedProps}
          {...inputComponentProps}
        />
        {helperText ? (
          <FormHelperText id={helperTextId} {...formHelperTextProps}>
            {helperText}
          </FormHelperText>
        ) : null}
      </TextFieldSlimRoot>
    );
  },
);
