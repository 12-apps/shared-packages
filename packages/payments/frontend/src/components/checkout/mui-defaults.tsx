/**
 * The raw-MUI fallback for every checkout slot (FUT-564, option 3).
 *
 * These are what a host gets when it fills nothing: functional, plain,
 * accessible — built only on `@mui/material`, which is already a peer. They
 * exist so the package works in a host with NO component library (the
 * second-host proof renders the whole flow through these), not to imitate any
 * particular design system's pixels.
 *
 * Test ids are preserved exactly — behavior tests and e2e selectors must find
 * the same hooks whichever side of the seam renders the pixels.
 */
import {
  Alert as MuiAlert,
  AlertTitle,
  Box,
  Button as MuiButton,
  Checkbox as MuiCheckbox,
  CircularProgress,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  InputLabel,
  OutlinedInput,
  Radio,
  RadioGroup as MuiRadioGroup,
  Step,
  StepLabel,
  Stepper as MuiStepper,
  Typography,
  styled,
  useThemeProps,
} from '@mui/material';
import type { TextFieldProps } from '@mui/material';
import { useId } from 'react';
import type { JSX } from 'react';

import type {
  CheckoutActionBarProps,
  CheckoutAlertProps,
  CheckoutButtonProps,
  CheckoutCheckboxProps,
  CheckoutComponents,
  CheckoutInputProps,
  CheckoutLoadingStateProps,
  CheckoutRadioGroupProps,
  CheckoutStepperProps,
  CheckoutTextProps,
} from './ui';

const TEXT_SIZE = { xs: '0.75rem', sm: '0.875rem', md: '1rem' } as const;
const TEXT_COLOR = {
  primary: 'primary.main',
  secondary: 'text.secondary',
  success: 'success.main',
  danger: 'error.main',
} as const;

function DefaultText({ variant, size = 'md', weight, color, as, style, children, ...rest }: CheckoutTextProps): JSX.Element {
  return (
    <Typography
      component={as ?? 'span'}
      data-testid={rest['data-testid']}
      style={style}
      sx={{
        fontSize: TEXT_SIZE[size],
        fontWeight: weight === 'bold' ? 700 : weight === 'semibold' ? 600 : variant === 'heading' ? 600 : 400,
        color: color ? TEXT_COLOR[color] : 'text.primary',
        fontFamily: variant === 'code' ? 'monospace' : undefined,
        opacity: variant === 'caption' ? 0.8 : undefined,
      }}
    >
      {children}
    </Typography>
  );
}

const BUTTON_VARIANT = { solid: 'contained', outline: 'outlined', text: 'text' } as const;
const BUTTON_SIZE = { sm: 'small', md: 'medium', lg: 'large' } as const;

function DefaultButton({ variant = 'solid', color = 'primary', size = 'md', fullWidth, disabled, loading, icon, iconPosition = 'left', onClick, dataTestId, children }: CheckoutButtonProps): JSX.Element {
  const adornment = loading ? <CircularProgress size={16} color="inherit" /> : icon;
  return (
    <MuiButton
      variant={BUTTON_VARIANT[variant]}
      color={color === 'neutral' ? 'inherit' : 'primary'}
      size={BUTTON_SIZE[size]}
      fullWidth={fullWidth}
      disabled={disabled || loading}
      startIcon={iconPosition === 'left' ? adornment : undefined}
      endIcon={iconPosition === 'right' ? adornment : undefined}
      onClick={onClick}
      data-testid={dataTestId}
      sx={{ textTransform: 'none' }}
    >
      {children}
    </MuiButton>
  );
}

type OwnerState = Record<string, unknown>;
type SlotProps = Record<string, unknown> | ((ownerState: OwnerState) => Record<string, unknown>) | undefined;

/**
 * `TextField`'s root, by name and with its `ownerState`: a theme's
 * `components.MuiTextField` (`styleOverrides`, including functions reading
 * `ownerState`, and `variants`) applies exactly as it did to `TextField`.
 */
const TextFieldRoot = styled(FormControl, {
  name: 'MuiTextField',
  slot: 'Root',
  overridesResolver: (_props, styles) => styles.root,
})<{ ownerState: OwnerState }>({});

/** A theme's slot props may be a function of `ownerState`, as `useSlot` allows. */
function slotPropsOf(slotProps: SlotProps, ownerState: OwnerState): Record<string, unknown> {
  return (typeof slotProps === 'function' ? slotProps(ownerState) : slotProps) ?? {};
}

/** `TextField`'s `ownerState`, for the outlined, non-select field this slot is. */
function ownerStateOf(props: TextFieldProps): OwnerState {
  return {
    ...props,
    autoFocus: false,
    color: props.color ?? 'primary',
    disabled: props.disabled ?? false,
    error: props.error ?? false,
    fullWidth: props.fullWidth ?? false,
    multiline: false,
    required: props.required ?? false,
    select: false,
    variant: 'outlined',
  };
}

/**
 * The slot's own props, run through the theme's `MuiTextField` defaults the way
 * `TextField` runs them (`useDefaultProps` is `useThemeProps` by another name).
 */
function useTextFieldProps({ label, type = 'text', inputMode, fullWidth, required, autoComplete, placeholder, maxLength, value, error, helperText, endAdornment, onChange, onBlur, ...rest }: CheckoutInputProps): TextFieldProps {
  return useThemeProps({
    name: 'MuiTextField',
    props: {
      label,
      type,
      size: 'small',
      fullWidth,
      required,
      placeholder,
      value,
      error,
      helperText,
      onChange,
      onBlur,
      slotProps: {
        htmlInput: { inputMode, maxLength, autoComplete, 'data-testid': rest['data-testid'] },
        input: { endAdornment },
      },
    } as TextFieldProps,
  });
}

/**
 * What `TextField` consumes by name rather than handing to its root. A key LIST
 * rather than a destructure, which would bind every one of them only to drop it.
 */
const CONSUMED_BY_FIELD: ReadonlySet<string> = new Set([
  'autoComplete', 'autoFocus', 'children', 'className', 'color', 'defaultValue', 'disabled', 'error',
  'FormHelperTextProps', 'fullWidth', 'helperText', 'id', 'InputLabelProps', 'inputProps', 'InputProps',
  'inputRef', 'label', 'maxRows', 'minRows', 'multiline', 'name', 'onBlur', 'onChange', 'onFocus',
  'placeholder', 'required', 'rows', 'select', 'SelectProps', 'slotProps', 'slots', 'type', 'value',
  'variant',
]);

/**
 * The slot props as `TextField` resolves them: the legacy `InputProps`,
 * `InputLabelProps`, `inputProps` and `FormHelperTextProps` first, then
 * `slotProps` over them.
 */
function slotPropsFor(props: TextFieldProps): Record<string, SlotProps> {
  return {
    input: props.InputProps as SlotProps,
    inputLabel: props.InputLabelProps as SlotProps,
    htmlInput: props.inputProps as SlotProps,
    formHelperText: props.FormHelperTextProps as SlotProps,
    ...((props.slotProps ?? {}) as Record<string, SlotProps>),
  };
}

/** The root: what `TextField` did not consume, then the props it hands the root by name. */
function rootPropsOf(props: TextFieldProps, ownerState: OwnerState): Record<string, unknown> {
  return {
    ...Object.fromEntries(Object.entries(props).filter(([key]) => !CONSUMED_BY_FIELD.has(key))),
    ownerState,
    className: ['MuiTextField-root', (props.classes as { root?: string } | undefined)?.root, props.className]
      .filter(Boolean)
      .join(' '),
    disabled: ownerState.disabled,
    error: ownerState.error,
    fullWidth: ownerState.fullWidth,
    required: ownerState.required,
    color: ownerState.color,
    variant: 'outlined',
  };
}

/** The input: the props `TextField` names, then the theme's and the slot's `input` slot props. */
function inputPropsOf(props: TextFieldProps, ownerState: OwnerState, ids: { id: string; helperTextId?: string }): Record<string, unknown> {
  const slots = slotPropsFor(props);
  const shrink = slotPropsOf(slots.inputLabel, ownerState).shrink;
  return {
    'aria-describedby': ids.helperTextId,
    autoComplete: props.autoComplete,
    autoFocus: ownerState.autoFocus,
    defaultValue: props.defaultValue,
    fullWidth: ownerState.fullWidth,
    name: props.name,
    inputRef: props.inputRef,
    onFocus: props.onFocus,
    type: props.type,
    value: props.value,
    id: ids.id,
    onBlur: props.onBlur,
    onChange: props.onChange,
    placeholder: props.placeholder,
    inputProps: slotPropsOf(slots.htmlInput, ownerState),
    label: props.label,
    ...(shrink === undefined ? {} : { notched: shrink }),
    ...slotPropsOf(slots.input, ownerState),
  };
}

/**
 * An outlined text field, composed from the parts MUI's `TextField` composes
 * (FUT-3402). `TextField` itself imports `Select` unconditionally, and through
 * it `Menu`, `MenuList`, `Popover` and `List`; this slot is in every host's
 * checkout bundle whether or not the host fills it, so it paid for a dropdown
 * it can never render.
 *
 * Same DOM and the same theme hooks — `defaultProps`, `styleOverrides`,
 * `variants`, slot props — pinned by `default-input-parity.test.tsx`, with two
 * deliberate exceptions: a theme default `variant` other than `outlined`, and
 * `slots` replacing a part, are not honoured. Either would need the very
 * components this slot exists to leave out; a host that wants them fills the
 * `Input` slot.
 */
function DefaultInput(slotProps: CheckoutInputProps): JSX.Element {
  const props = useTextFieldProps(slotProps);
  const ownerState = ownerStateOf(props);
  const generatedId = useId();
  const id = props.id ?? generatedId;
  const helperTextId = props.helperText ? `${id}-helper-text` : undefined;
  const slots = slotPropsFor(props);
  const { label, helperText } = props;
  return (
    <TextFieldRoot {...(rootPropsOf(props, ownerState) as { ownerState: OwnerState })}>
      {label != null && label !== '' ? (
        <InputLabel htmlFor={id} id={`${id}-label`} {...slotPropsOf(slots.inputLabel, ownerState)}>{label}</InputLabel>
      ) : null}
      <OutlinedInput {...inputPropsOf(props, ownerState, { id, helperTextId })} />
      {helperText ? (
        <FormHelperText id={helperTextId} {...slotPropsOf(slots.formHelperText, ownerState)}>{helperText}</FormHelperText>
      ) : null}
    </TextFieldRoot>
  );
}

function DefaultCheckbox({ checked, onChange, label, ...rest }: CheckoutCheckboxProps): JSX.Element {
  return (
    <FormControlLabel
      control={<MuiCheckbox checked={checked} onChange={onChange} data-testid={rest['data-testid']} />}
      label={label}
    />
  );
}

const ALERT_SEVERITY = { info: 'info', warning: 'warning', danger: 'error' } as const;

function DefaultAlert({ variant = 'info', title, description, showIcon, ...rest }: CheckoutAlertProps): JSX.Element {
  return (
    <MuiAlert severity={ALERT_SEVERITY[variant]} icon={showIcon ? undefined : false} data-testid={rest['data-testid']}>
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      {description}
    </MuiAlert>
  );
}

function DefaultLoadingState({ message, dataTestId }: CheckoutLoadingStateProps): JSX.Element {
  return (
    <Box data-testid={dataTestId} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, py: 2 }}>
      <CircularProgress size={28} />
      {message ? <Typography variant="body2" color="text.secondary">{message}</Typography> : null}
    </Box>
  );
}

function DefaultStepper({ steps, activeId, completed, ...rest }: CheckoutStepperProps): JSX.Element {
  const activeStep = steps.findIndex((step) => step.id === activeId);
  return (
    <MuiStepper activeStep={activeStep} alternativeLabel data-testid={rest['data-testid']}>
      {steps.map((step) => (
        <Step key={step.id} completed={completed?.has(step.id)}>
          <StepLabel>{step.label}</StepLabel>
        </Step>
      ))}
    </MuiStepper>
  );
}

function DefaultRadioGroup({ label, value, onChange, options, dataTestId }: CheckoutRadioGroupProps): JSX.Element {
  return (
    <FormControl data-testid={dataTestId}>
      {label ? <FormLabel>{label}</FormLabel> : null}
      <MuiRadioGroup value={value} onChange={onChange}>
        {options.map((option) => (
          <FormControlLabel
            key={option.value}
            value={option.value}
            control={<Radio />}
            label={
              <Box>
                <Typography variant="body2">{option.label}</Typography>
                {option.description ? (
                  <Typography variant="caption" color="text.secondary">{option.description}</Typography>
                ) : null}
              </Box>
            }
          />
        ))}
      </MuiRadioGroup>
    </FormControl>
  );
}

function DefaultActionBar({ children, dataTestId }: CheckoutActionBarProps): JSX.Element {
  return (
    <Box
      data-testid={dataTestId}
      sx={{
        position: 'sticky',
        bottom: 0,
        zIndex: 2,
        bgcolor: 'background.paper',
        borderTop: '1px solid',
        borderColor: 'divider',
        py: 1.5,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
      }}
    >
      {children}
    </Box>
  );
}

/** The complete raw-MUI slot set — what an empty `components` prop means. */
export const defaultCheckoutComponents: CheckoutComponents = {
  Text: DefaultText,
  Button: DefaultButton,
  Input: DefaultInput,
  Checkbox: DefaultCheckbox,
  Alert: DefaultAlert,
  LoadingState: DefaultLoadingState,
  Stepper: DefaultStepper,
  RadioGroup: DefaultRadioGroup,
  ActionBar: DefaultActionBar,
};
