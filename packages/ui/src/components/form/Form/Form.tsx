import Box from '@mui/material/Box/index.js';
import Stack from '@mui/material/Stack/index.js';
import { styled } from '@mui/material/styles/index.js';
import React from 'react';

import type {
  FormControlProps,
  FormFieldProps,
  FormLabelProps,
  FormMessageProps,
  FormProps,
} from './Form.types';

const StyledForm = styled('form', {
  shouldForwardProp: (prop) => prop !== 'variant',
})<{ variant?: FormProps['variant'] }>(({ theme, variant }) => ({
  width: '100%',
  ...(variant === 'inline' && {
    display: 'flex',
    gap: theme.spacing(2),
    alignItems: 'flex-start',
  }),
}));

const spacingMap = {
  xs: 1,
  sm: 2,
  md: 3,
  lg: 4,
  xl: 5,
};

const maxWidthMap = {
  sm: '600px',
  md: '900px',
  lg: '1200px',
  xl: '1536px',
  full: '100%',
};

export const Form = React.forwardRef<HTMLFormElement, FormProps>(
  ({ variant = 'vertical', maxWidth = 'full', spacing = 'md', children, dataTestId, ...props }, ref) => (
      <StyledForm ref={ref} variant={variant} role="form" data-testid={dataTestId} {...props}>
        <Box sx={{ maxWidth: maxWidthMap[maxWidth], width: '100%' }}>
          {variant === 'inline' ? (
            children
          ) : (
            <Stack spacing={spacingMap[spacing]}>{children}</Stack>
          )}
        </Box>
      </StyledForm>
    ),
);

Form.displayName = 'Form';

/**
 * NO ROW GAP HERE, and that is the fix rather than an omission.
 *
 * `FormLabel` already carries `marginBottom: theme.spacing(0.5)` — 4px — and it
 * carries it because it has to: every OTHER user of it (`CepField`,
 * `CategorySelect`, `CreatableSelect`, the three `total-form` fields, five of
 * `@12-apps/discounts`' builders and the host's own `currency-field`) puts a
 * bare `FormLabel` straight inside a `FormControl`, which is a plain block box
 * with no gap of its own. There, the label's own margin is the ONLY thing
 * between the label and the control.
 *
 * A `gap: theme.spacing(1)` here was a second mechanism for that one job, and in
 * a column the two ADD: 8px + 4px put `FormField` at 12px where every one of
 * those siblings sits at 4px. Measured in Chromium at 320x568 on a consuming
 * app's six-field delivery address form, the 8px a row it added pushed the
 * submit button from 561px to 609px — 41px below the fold of the smallest
 * supported phone, i.e. a checkout whose primary action is off-screen.
 *
 * That claim is about `FormLabel`'s own callers, not about the whole package:
 * `Textarea` labels its control through MUI's `InputLabel` at
 * `theme.spacing(1)` and still draws 8px. It composes nothing out of
 * `FormLabel`, so it is a separate inconsistency rather than a reason to keep
 * a second spacing here.
 *
 * ## The `columnGap` is scaffolding, and currently unreachable
 *
 * `FormFieldProps` has no `variant` and `FormField` passes none, so `variant`
 * is ALWAYS undefined and every branch below resolves to the vertical shape.
 * `Form` accepts `variant="horizontal"` and `Form.md` documents it as "labels
 * beside inputs", but nothing carries that variant down to the field — so a
 * horizontal form draws vertical rows today. That gap is older than this
 * change and fixing it is a feature, not a spacing fix.
 *
 * The branch is kept, scoped to the COLUMN axis, so that whoever does wire it
 * up inherits the right answer: with the label beside the control, a horizontal
 * gap and a vertical margin are orthogonal and nothing double-counts. A `gap`
 * shorthand there would put the 8px back on the row axis the moment a field
 * wrapped.
 */
const StyledFormField = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'variant',
})<{ variant?: 'vertical' | 'horizontal' }>(
  ({ theme, variant }) => ({
    display: variant === 'horizontal' ? 'grid' : 'flex',
    flexDirection: variant === 'horizontal' ? undefined : 'column',
    gridTemplateColumns: variant === 'horizontal' ? '200px 1fr' : undefined,
    columnGap: variant === 'horizontal' ? theme.spacing(1) : undefined,
    alignItems: variant === 'horizontal' ? 'center' : undefined,
  }),
);

export const FormField: React.FC<FormFieldProps> = ({
  name,
  label,
  required,
  error,
  helperText,
  children,
  dataTestId,
}) => (
    <StyledFormField data-testid={dataTestId}>
      {label && (
        <FormLabel required={required} error={!!error} htmlFor={name} dataTestId={dataTestId ? `${dataTestId}-label` : undefined}>
          {label}
        </FormLabel>
      )}
      <FormControl fullWidth dataTestId={dataTestId ? `${dataTestId}-control` : undefined}>
        {children}
        {(error || helperText) && <FormMessage error={!!error} dataTestId={dataTestId ? `${dataTestId}-message` : undefined}>{error || helperText}</FormMessage>}
      </FormControl>
    </StyledFormField>
  );

const StyledFormLabel = styled('label', {
  shouldForwardProp: (prop) => prop !== 'error',
})<{ error?: boolean }>(({ theme, error }) => ({
  fontSize: '0.875rem',
  fontWeight: 500,
  color: error ? theme.palette.error.main : theme.palette.text.primary,
  marginBottom: theme.spacing(0.5),
  display: 'block',
  '&::after': {
    content: '" *"',
    color: theme.palette.error.main,
    display: 'var(--required-display, none)',
  },
}));

export const FormLabel: React.FC<FormLabelProps> = ({ required, error, children, htmlFor, dataTestId }) => (
    <StyledFormLabel
      error={error}
      htmlFor={htmlFor}
      data-testid={dataTestId}
      style={{ '--required-display': required ? 'inline' : 'none' } as React.CSSProperties}
    >
      {children}
    </StyledFormLabel>
  );

const StyledFormControl = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'fullWidth',
})<{ fullWidth?: boolean }>(({ fullWidth }) => ({
  width: fullWidth ? '100%' : 'auto',
  position: 'relative',
}));

export const FormControl: React.FC<FormControlProps> = ({ fullWidth = true, children, dataTestId }) =>
  // Don't pass error prop to the DOM element
   <StyledFormControl fullWidth={fullWidth} data-testid={dataTestId}>{children}</StyledFormControl>
;

const StyledFormMessage = styled('span', {
  shouldForwardProp: (prop) => prop !== 'error',
})<{ error?: boolean }>(({ theme, error }) => ({
  fontSize: '0.75rem',
  marginTop: theme.spacing(0.5),
  color: error ? theme.palette.error.main : theme.palette.text.secondary,
  display: 'block',
}));

export const FormMessage: React.FC<FormMessageProps> = ({ error, children, dataTestId }) => <StyledFormMessage error={error} data-testid={dataTestId}>{children}</StyledFormMessage>;
