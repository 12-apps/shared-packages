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
  FormLabel,
  Radio,
  RadioGroup as MuiRadioGroup,
  Step,
  StepLabel,
  Stepper as MuiStepper,
  TextField,
  Typography,
} from '@mui/material';
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

function DefaultInput({ label, type = 'text', inputMode, fullWidth, required, autoComplete, placeholder, maxLength, value, error, helperText, endAdornment, onChange, onBlur, ...rest }: CheckoutInputProps): JSX.Element {
  return (
    <TextField
      label={label}
      type={type}
      size="small"
      fullWidth={fullWidth}
      required={required}
      placeholder={placeholder}
      value={value}
      error={error}
      helperText={helperText}
      onChange={onChange}
      onBlur={onBlur}
      slotProps={{
        htmlInput: { inputMode, maxLength, autoComplete, 'data-testid': rest['data-testid'] },
        input: { endAdornment },
      }}
    />
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
