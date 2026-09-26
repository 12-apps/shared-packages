import CircularProgress from '@mui/material/CircularProgress/index.js';
import InputAdornment from '@mui/material/InputAdornment/index.js';
import { styled, useTheme } from '@mui/material/styles/index.js';
import React from 'react';

import { INPUT_LOADING } from './Input.metrics';
import { TextFieldSlim } from './text-field-slim';

import {
  filledStyles,
  floatingLabelStyles,
  glowStyles,
  inputBaseStyles,
  inputRadiusStyles,
  muiVariantFor,
  outlinedStyles,
  pulseStyles,
  SIZE_MAP,
} from './Input.styles';
import type { InputProps } from './Input.types';
import { splitTestId } from '../../../platform/test-id';
import { fieldControlStyles } from '../../../tokens/field-height';
import { rem } from '../../../tokens/relative';
import type { SizeValue } from '../../../tokens/vocabulary';

/**
 * `TextFieldSlim`, not `TextField` — see `text-field-slim.tsx`. MUI's own
 * `TextField` imports `Select` unconditionally, and through it `Menu`,
 * `Popover`, `Modal` and seven more component modules, so every screen with one
 * text box shipped a dropdown it can never render. Same composition, same DOM,
 * same prop routing; the select branch is the only thing missing.
 */
const StyledTextField = styled(TextFieldSlim, {
  shouldForwardProp: (prop) =>
    !['customVariant', 'fieldSize', 'floating', 'glow', 'pulse', 'loading'].includes(prop as string),
})<{
  customVariant?: InputProps['variant'];
  fieldSize: SizeValue;
  floating?: boolean;
  glow?: boolean;
  pulse?: boolean;
  loading?: boolean;
}>(({ theme, customVariant, fieldSize, floating, glow, pulse, loading }) => ({
  position: 'relative',
  // The theme's field height for this size (outlined family, one line).
  ...fieldControlStyles(theme, fieldSize),
  opacity: loading ? INPUT_LOADING.opacity : 1,

  ...(glow ? glowStyles(theme) : {}),
  ...(pulse ? pulseStyles(theme, fieldSize) : {}),
  ...(floating ? floatingLabelStyles(theme) : {}),

  '& .MuiInputBase-root': {
    transition: 'all 0.3s ease',
    ...inputRadiusStyles(theme, customVariant),
    ...inputBaseStyles(theme, customVariant),
  },

  '& .MuiOutlinedInput-root': outlinedStyles(theme),
  '& .MuiFilledInput-root': filledStyles(theme),
}));

/** Only one adornment shows at a time: the spinner replaces the caller's while loading. */
const EndAdornment: React.FC<{ loading: boolean; endAdornment?: React.ReactNode }> = ({
  loading,
  endAdornment,
}) => {
  const theme = useTheme();
  if (loading) {
    return (
      <InputAdornment position="end">
        <CircularProgress size={rem(theme, INPUT_LOADING.spinnerSize)} />
      </InputAdornment>
    );
  }

  if (!endAdornment) return null;

  return <InputAdornment position="end">{endAdornment}</InputAdornment>;
};

/** While loading the field is inert: no clicks, and disabled to assistive tech. */
const interactionProps = (
  loading: boolean,
  onClick: InputProps['onClick'],
  disabled?: boolean,
) => ({
  disabled: loading || disabled,
  onClick: loading ? undefined : onClick,
});

/**
 * The ARIA that describes the field has to sit on the `<input>`: the text
 * field puts every attribute it does not recognise on its root `FormControl`,
 * a `<div>` with no role, where a screen reader never reads it.
 *
 * `aria-label` has ridden `inputProps` since FUT-755. `aria-describedby` and
 * `aria-busy` fell through to the div until FUT-2619, so CepField's input
 * pointed at nothing while its lookup status lived in a live region beside it.
 *
 * `inputProps` are spread onto the `<input>` AFTER the `aria-describedby` MUI
 * writes for helper text, so a caller's ids REPLACE the helper text's: MUI's
 * `TextField` on its own keeps only one of the two. This joins both, helper
 * text first. The helper id is MUI's `<id>-helper-text` (the parity test pins
 * that spelling), which is why the field's id is fixed here rather than left
 * to the text field.
 */
function inputAriaOf(a: {
  id: string;
  helperText: React.ReactNode;
  label?: string;
  describedBy?: string;
  busy?: InputProps['aria-busy'];
}): Record<string, unknown> {
  const describedBy = [a.helperText ? `${a.id}-helper-text` : undefined, a.describedBy]
    .filter(Boolean)
    .join(' ');
  return {
    ...(a.label === undefined ? {} : { 'aria-label': a.label }),
    ...(a.describedBy === undefined ? {} : { 'aria-describedby': describedBy }),
    ...(a.busy === undefined ? {} : { 'aria-busy': a.busy }),
  };
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      variant = 'outlined',
      size = 'md',
      label,
      error,
      helperText,
      startAdornment,
      endAdornment,
      fullWidth = true,
      floating = false,
      glow = false,
      pulse = false,
      loading = false,
      onClick,
      onFocus,
      onBlur,
      'aria-label': ariaLabel,
      'aria-describedby': ariaDescribedBy,
      'aria-busy': ariaBusy,
      inputProps,
      ...rest
    },
    ref,
  ) => {
    const { testId: dataTestId, rest: props } = splitTestId(rest);
    const generatedId = React.useId();
    const id = props.id ?? generatedId;
    return (
      <StyledTextField
        ref={ref}
        variant={muiVariantFor(variant)}
        customVariant={variant}
        fieldSize={size}
        floating={floating}
        glow={glow}
        pulse={pulse}
        loading={loading}
        label={label}
        error={error}
        helperText={helperText}
        fullWidth={fullWidth}
        {...interactionProps(loading, onClick, props.disabled)}
        onFocus={onFocus}
        onBlur={onBlur}
        /*
         * `aria-label` has to ride `inputProps` to reach the `<input>` (FUT-755).
         * Spread with the rest it lands on the FormControl DIV that the text
         * field renders as its root, which carries no role — so the field kept
         * no accessible name, and a source grep saying "this input is labelled"
         * disagreed with the DOM. The reports search box and the block-title
         * inputs were both named in source and anonymous to a screen reader.
         * `aria-describedby` and `aria-busy` are the same case: `inputAriaOf`.
         */
        inputProps={{
          'data-testid': dataTestId,
          ...inputProps,
          ...inputAriaOf({ id, helperText, label: ariaLabel, describedBy: ariaDescribedBy, busy: ariaBusy }),
        }}
        InputProps={{
          startAdornment: startAdornment && (
            <InputAdornment position="start">{startAdornment}</InputAdornment>
          ),
          endAdornment: <EndAdornment loading={loading} endAdornment={endAdornment} />,
        }}
        {...SIZE_MAP[size]}
        {...props}
        id={id}
      />
    );
  },
);

Input.displayName = 'Input';
