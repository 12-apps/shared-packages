'use client';

import { Box, Button, Stack, TextField, Typography } from '@mui/material';

import type { CredentialFieldSpec, MaskedFieldState } from '@12-apps/payments-backend';

/**
 * The schema-driven credential inputs, and the one-line summary a finished
 * step collapses into.
 *
 * Split out of `ProviderCredentialForm` so that file stays about the ACTIONS
 * (save, probe, confirm) rather than about rendering a field.
 */

interface FieldPresentation {
  type: 'text' | 'password';
  value: string;
  required: boolean;
  placeholder?: string;
  helperText?: string;
}

/** Write-only secret field: masked hint as placeholder, value never echoed. */
function secretPresentation(
  state: MaskedFieldState | undefined,
  value: string | undefined,
  required: boolean,
): FieldPresentation {
  const configured = state?.configured ?? false;
  return {
    type: 'password',
    value: value ?? '',
    required: required && !configured,
    placeholder: configured ? (state?.hint ?? '') : undefined,
    helperText: configured ? 'Configurado — deixe em branco para manter o valor atual.' : undefined,
  };
}

function fieldPresentation(
  spec: CredentialFieldSpec,
  state: MaskedFieldState | undefined,
  value: string | undefined,
): FieldPresentation {
  if (spec.secret) return secretPresentation(state, value, spec.required);
  const configured = state?.configured ?? false;
  return {
    type: 'text',
    value: value ?? state?.hint ?? '',
    required: spec.required && !configured,
    placeholder: spec.placeholder,
    helperText: spec.helperText,
  };
}

/**
 * A monospace, letter-spaced face for values that must be checked character by
 * character. The whole reason InfinitePay's handle carries `mono` is that a
 * wrong one is not rejected — it is a different person's account.
 */
const MONO_INPUT = {
  fontFamily: 'monospace',
  letterSpacing: '0.08em',
} as const;

interface CredentialFieldProps {
  spec: CredentialFieldSpec;
  state: MaskedFieldState | undefined;
  value: string | undefined;
  onChange: (value: string) => void;
}

/** One schema-driven form field. Secrets are write-only: hint, never value. */
export function CredentialField({ spec, state, value, onChange }: CredentialFieldProps) {
  const presentation = fieldPresentation(spec, state, value);
  return (
    <TextField
      size="small"
      label={spec.label}
      {...presentation}
      slotProps={spec.mono ? { htmlInput: { sx: MONO_INPUT, spellCheck: false } } : undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * What a completed step collapses to.
 *
 * A form that keeps every finished step expanded makes the owner re-read three
 * cards to find the one thing still outstanding, and — worse for this screen —
 * leaves the field that decides where the money goes sitting there editable,
 * one stray keystroke from being changed by someone who came back to check
 * something else. Collapsed, the value is still legible (that IS the check
 * they came for) and altering it is a deliberate act.
 */
/**
 * The parenthetical in a field label — "InfiniteTag ($usuario)" — tells you how
 * to TYPE the value. Beside the value itself it is answered by the thing it
 * sits next to, so the summary row shows the bare name.
 */
export function DoneRow({
  label,
  value,
  mono,
  onEdit,
  editLabel = 'Alterar',
  testId,
}: {
  label: string;
  value: string;
  mono?: boolean;
  onEdit: () => void;
  editLabel?: string;
  testId: string;
}) {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      alignItems="center"
      data-testid={testId}
      sx={{ border: 1, borderColor: 'divider', borderRadius: 1, px: 2, py: 1.25 }}
    >
      <Box aria-hidden sx={{ color: 'success.main', fontWeight: 700 }}>
        ✓
      </Box>
      <Typography variant="body2" color="text.secondary">
        {label.replace(/\s*\([^)]*\)\s*$/, '')}
      </Typography>
      <Typography variant="body2" sx={mono ? MONO_INPUT : undefined}>
        {value}
      </Typography>
      <Box sx={{ flexGrow: 1 }} />
      <Button
        size="small"
        onClick={onEdit}
        data-testid={`${testId}-edit`}
        sx={{ textTransform: 'none' }}
      >
        {editLabel}
      </Button>
    </Stack>
  );
}
