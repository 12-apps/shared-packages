import CircularProgress from '@mui/material/CircularProgress/index.js';
import InputAdornment from '@mui/material/InputAdornment/index.js';
import { styled } from '@mui/material/styles/index.js';
import React from 'react';

import { TextFieldSlim } from './text-field-slim';

import {
  filledStyles,
  floatingLabelStyles,
  glowStyles,
  inputBaseStyles,
  muiVariantFor,
  outlinedStyles,
  pulseStyles,
  SIZE_MAP,
} from './Input.styles';
import type { InputProps } from './Input.types';

/**
 * `TextFieldSlim`, not `TextField` — see `text-field-slim.tsx`. MUI's own
 * `TextField` imports `Select` unconditionally, and through it `Menu`,
 * `Popover`, `Modal` and seven more component modules, so every screen with one
 * text box shipped a dropdown it can never render. Same composition, same DOM,
 * same prop routing; the select branch is the only thing missing.
 */
const StyledTextField = styled(TextFieldSlim, {
  shouldForwardProp: (prop) =>
    !['customVariant', 'floating', 'glow', 'pulse', 'loading'].includes(prop as string),
})<{
  customVariant?: InputProps['variant'];
  floating?: boolean;
  glow?: boolean;
  pulse?: boolean;
  loading?: boolean;
}>(({ theme, customVariant, floating, glow, pulse, loading }) => ({
  position: 'relative',
  opacity: loading ? 0.7 : 1,

  ...(glow ? glowStyles(theme) : {}),
  ...(pulse ? pulseStyles(theme) : {}),
  ...(floating ? floatingLabelStyles(theme) : {}),

  '& .MuiInputBase-root': {
    transition: 'all 0.3s ease',
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
  if (loading) {
    return (
      <InputAdornment position="end">
        <CircularProgress size={20} />
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
      'data-testid': dataTestId,
      'aria-label': ariaLabel,
      ...props
    },
    ref,
  ) => (
    <StyledTextField
      ref={ref}
      variant={muiVariantFor(variant)}
      customVariant={variant}
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
       */
      inputProps={{
        'data-testid': dataTestId,
        ...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel }),
      }}
      InputProps={{
        startAdornment: startAdornment && (
          <InputAdornment position="start">{startAdornment}</InputAdornment>
        ),
        endAdornment: <EndAdornment loading={loading} endAdornment={endAdornment} />,
      }}
      {...SIZE_MAP[size]}
      {...props}
    />
  ),
);

Input.displayName = 'Input';
