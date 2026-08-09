import {
  alpha,
  type CSSObject,
  FormControl,
  FormHelperText,
  InputLabel,
  keyframes,
  MenuItem,
  Select as MuiSelect,
  styled,
  type Theme,
} from '@mui/material';
import React from 'react';

import type { SelectProps } from './Select.types';

// Define pulse animation
const pulseAnimation = keyframes`
  0% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 1;
  }
  70% {
    box-shadow: 0 0 0 10px currentColor;
    opacity: 0;
  }
  100% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 0;
  }
`;

/** Glow ring on the outlined input, keyed off the `glow` prop. */
const glowStyles = (theme: Theme): CSSObject => ({
  '& .MuiOutlinedInput-root': {
    boxShadow: `0 0 15px ${alpha(theme.palette.primary.main, 0.3)}`,
    '&.Mui-focused': {
      boxShadow: `0 0 20px ${alpha(theme.palette.primary.main, 0.5)}`,
    },
  },
});

/** Pulsing halo behind the control, keyed off the `pulse` prop. */
const pulseStyles = (theme: Theme): CSSObject => ({
  '&::after': {
    content: '""',
    position: 'absolute',
    top: '50%',
    left: '0',
    right: '0',
    height: '56px',
    transform: 'translateY(-50%)',
    borderRadius: theme.spacing(0.5),
    backgroundColor: theme.palette.primary.main,
    opacity: 0.3,
    animation: `${pulseAnimation} 2s infinite`,
    pointerEvents: 'none',
    zIndex: -1,
  },
});

/** `glass` variant: translucent, blurred background. */
const glassVariant = (theme: Theme): CSSObject => ({
  backgroundColor: alpha(theme.palette.background.paper, 0.1),
  backdropFilter: 'blur(20px)',
  border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
  '& fieldset': { border: 'none' },
  '&:hover': {
    backgroundColor: alpha(theme.palette.background.paper, 0.15),
    borderColor: alpha(theme.palette.primary.main, 0.3),
  },
  '&.Mui-focused': {
    backgroundColor: alpha(theme.palette.background.paper, 0.2),
    borderColor: theme.palette.primary.main,
    boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.1)}`,
  },
});

/** `gradient` variant: gradient fill with a masked gradient border. */
const gradientVariant = (theme: Theme): CSSObject => ({
  background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)}, ${alpha(theme.palette.secondary.main, 0.1)})`,
  border: `2px solid transparent`,
  backgroundOrigin: 'border-box',
  backgroundClip: 'padding-box, border-box',
  position: 'relative',
  '& fieldset': { border: 'none' },
  '&::before': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 'inherit',
    background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
    mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
    maskComposite: 'exclude',
    padding: '2px',
    zIndex: -1,
  },
  '&:hover': {
    background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.15)}, ${alpha(theme.palette.secondary.main, 0.15)})`,
  },
  '&.Mui-focused': {
    background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.2)}, ${alpha(theme.palette.secondary.main, 0.2)})`,
    '&::before': {
      background: `linear-gradient(135deg, ${theme.palette.primary.dark}, ${theme.palette.secondary.dark})`,
    },
  },
});

/** `default` variant: standard outlined borders with hover/focus/error states. */
const defaultVariant = (theme: Theme): CSSObject => ({
  '& fieldset': { borderColor: alpha(theme.palette.divider, 0.23) },
  '&:hover fieldset': { borderColor: theme.palette.primary.main },
  '&.Mui-focused fieldset': { borderColor: theme.palette.primary.main, borderWidth: 2 },
  '&.Mui-error fieldset': { borderColor: theme.palette.error.main },
});

/** Pick the variant style block for the outlined input. */
const variantStyles = (theme: Theme, variant: SelectProps['variant']): CSSObject => {
  if (variant === 'glass') return glassVariant(theme);
  if (variant === 'gradient') return gradientVariant(theme);
  return defaultVariant(theme);
};

const StyledFormControl = styled(FormControl, {
  shouldForwardProp: (prop) => prop !== 'customVariant' && prop !== 'glow' && prop !== 'pulse',
})<{
  customVariant?: SelectProps['variant'];
  glow?: boolean;
  pulse?: boolean;
}>(({ theme, customVariant, glow, pulse }) => ({
  position: 'relative',
  ...(glow ? glowStyles(theme) : {}),
  ...(pulse ? pulseStyles(theme) : {}),
  '& .MuiOutlinedInput-root': {
    transition: 'all 0.3s ease',
    ...variantStyles(theme, customVariant),
  },
}));

/**
 * Build the placeholder item plus one MenuItem per option. Returns a flat ARRAY
 * (not a Fragment): MUI `Select` enumerates its children with `React.Children`,
 * which does not descend into Fragments — a Fragment would hide every option.
 */
function renderMenuItems(
  options: SelectProps['options'],
  placeholder: string | undefined,
  dataTestId: string | undefined,
): React.ReactNode[] {
  const optionTestId = (value: string | number): string =>
    dataTestId ? `${dataTestId}-option-${value}` : `option-${value}`;
  const items = options.map((option) => (
    <MenuItem
      key={option.value}
      value={option.value}
      disabled={option.disabled}
      data-testid={optionTestId(option.value)}
    >
      {option.label}
    </MenuItem>
  ));
  if (placeholder) {
    items.unshift(
      <MenuItem key="__placeholder__" value="" disabled>
        {placeholder}
      </MenuItem>,
    );
  }
  return items;
}

export const Select = React.forwardRef<HTMLDivElement, SelectProps>(
  (
    {
      // `variant`/`size`/`glow`/`pulse` intentionally have no defaults: undefined
      // resolves to the default variant, MUI's medium size, and no glow/pulse —
      // keeping this render function under the complexity budget.
      variant,
      options,
      label,
      helperText,
      fullWidth = true,
      size,
      error,
      placeholder,
      glow,
      pulse,
      'data-testid': dataTestId,
      value,
      'aria-label': ariaLabel,
      ...props
    },
    ref,
  ) => {
    const labelId = React.useId();
    const helperTextId = React.useId();
    const selectId = React.useId();

    return (
      <StyledFormControl
        fullWidth={fullWidth}
        size={size}
        error={error}
        customVariant={variant}
        glow={glow}
        pulse={pulse}
        ref={ref}
        data-testid={dataTestId}
      >
        {label && (
          <InputLabel id={labelId} htmlFor={selectId}>
            {label}
          </InputLabel>
        )}
        <MuiSelect
          id={selectId}
          labelId={label ? labelId : undefined}
          label={label}
          displayEmpty={Boolean(placeholder)}
          aria-describedby={helperText ? helperTextId : undefined}
          data-testid={dataTestId ? `${dataTestId}-select` : 'select'}
          value={value ?? ''}
          {...props}
          /*
           * `role="combobox"` sits on MUI's display DIV, not on the hidden
           * native input that `{...props}` reaches — so an `aria-label` passed
           * to this component never landed on the element carrying the role,
           * and MUI's `aria-labelledby` then fell back to that div's OWN id.
           * The control announced as its current value: a filter's field
           * select read "Status" instead of "Filtro 1 — campo".
           *
           * Forwarding it here names the right element. The explicit
           * `undefined` clears that self-referential `aria-labelledby`, which
           * would otherwise win — a labelledby always beats a label in the
           * accessible-name computation.
           */
          SelectDisplayProps={
            ariaLabel === undefined
              ? undefined
              : { 'aria-label': ariaLabel, 'aria-labelledby': undefined }
          }
        >
          {renderMenuItems(options, placeholder, dataTestId)}
        </MuiSelect>
        {helperText && (
          <FormHelperText id={helperTextId} error={error}>
            {helperText}
          </FormHelperText>
        )}
      </StyledFormControl>
    );
  },
);

Select.displayName = 'Select';
