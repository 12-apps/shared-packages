import FormControl from '@mui/material/FormControl/index.js';
import FormHelperText from '@mui/material/FormHelperText/index.js';
import InputLabel from '@mui/material/InputLabel/index.js';
import MenuItem from '@mui/material/MenuItem/index.js';
import MuiSelect from '@mui/material/Select/index.js';
import { alpha, type CSSObject, keyframes, styled, type Theme } from '@mui/material/styles/index.js';
import React from 'react';

import {
  SELECT_BORDER,
  SELECT_GLASS,
  SELECT_GLOW,
  SELECT_GRADIENT,
  SELECT_PULSE,
  selectInputSize,
} from './Select.metrics';
import type { SelectProps } from './Select.types';

import { fieldEdge } from '../../../tokens/field-edge';

// Define pulse animation
const pulseAnimation = keyframes`
  0% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 1;
  }
  70% {
    box-shadow: 0 0 0 ${SELECT_PULSE.spread}px currentColor;
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
    boxShadow: `0 0 ${SELECT_GLOW.rest.blur}px ${alpha(theme.palette.primary.main, SELECT_GLOW.rest.alpha)}`,
    '&.Mui-focused': {
      boxShadow: `0 0 ${SELECT_GLOW.focused.blur}px ${alpha(theme.palette.primary.main, SELECT_GLOW.focused.alpha)}`,
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
    height: `${SELECT_PULSE.height}px`,
    transform: 'translateY(-50%)',
    borderRadius: theme.spacing(SELECT_PULSE.radiusUnits),
    backgroundColor: theme.palette.primary.main,
    opacity: SELECT_PULSE.opacity,
    animation: `${pulseAnimation} ${SELECT_PULSE.ms / 1000}s infinite`,
    pointerEvents: 'none',
    zIndex: -1,
  },
});

/** `glass` variant: translucent, blurred background. */
const glassVariant = (theme: Theme): CSSObject => ({
  backgroundColor: alpha(theme.palette.background.paper, SELECT_GLASS.background.rest),
  backdropFilter: `blur(${SELECT_GLASS.blur}px)`,
  border: `${SELECT_BORDER.rest}px solid ${fieldEdge(theme)}`,
  '& fieldset': { border: 'none' },
  '&:hover': {
    backgroundColor: alpha(theme.palette.background.paper, SELECT_GLASS.background.hover),
    borderColor: alpha(theme.palette.primary.main, SELECT_GLASS.hoverBorderAlpha),
  },
  '&.Mui-focused': {
    backgroundColor: alpha(theme.palette.background.paper, SELECT_GLASS.background.focused),
    borderColor: theme.palette.primary.main,
    boxShadow: `0 0 0 ${SELECT_GLASS.focusRing.width}px ${alpha(theme.palette.primary.main, SELECT_GLASS.focusRing.alpha)}`,
  },
});

/** `gradient` variant: gradient fill with a masked gradient border. */
const gradientFill = (theme: Theme, strength: number): string =>
  `linear-gradient(${SELECT_GRADIENT.angleDeg}deg, ${alpha(theme.palette.primary.main, strength)}, ${alpha(theme.palette.secondary.main, strength)})`;

const gradientVariant = (theme: Theme): CSSObject => ({
  background: gradientFill(theme, SELECT_GRADIENT.fill.rest),
  border: `${SELECT_GRADIENT.borderWidth}px solid transparent`,
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
    background: `linear-gradient(${SELECT_GRADIENT.angleDeg}deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
    mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
    maskComposite: 'exclude',
    padding: `${SELECT_GRADIENT.borderWidth}px`,
    zIndex: -1,
  },
  '&:hover': {
    background: gradientFill(theme, SELECT_GRADIENT.fill.hover),
  },
  '&.Mui-focused': {
    background: gradientFill(theme, SELECT_GRADIENT.fill.focused),
    '&::before': {
      background: `linear-gradient(${SELECT_GRADIENT.angleDeg}deg, ${theme.palette.primary.dark}, ${theme.palette.secondary.dark})`,
    },
  },
});

/** `default` variant: standard outlined borders with hover/focus/error states. */
const defaultVariant = (theme: Theme): CSSObject => ({
  '& fieldset': { borderColor: fieldEdge(theme) },
  '&:hover fieldset': { borderColor: theme.palette.primary.main },
  '&.Mui-focused fieldset': { borderColor: theme.palette.primary.main, borderWidth: SELECT_BORDER.focused },
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

/**
 * The house scale as a FormControl size.
 *
 * Not `muiSize`: that collapses five onto MUI's three, and a FormControl takes
 * only two. This component's scale is already narrowed to `sm | md`, so the map
 * is exact rather than lossy.
 */
const formControlSize = (size: SelectProps['size']): 'small' | 'medium' | undefined => {
  if (size === undefined) return undefined;
  return selectInputSize(size) === 'sm' ? 'small' : 'medium';
};

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
        size={formControlSize(size)}
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
