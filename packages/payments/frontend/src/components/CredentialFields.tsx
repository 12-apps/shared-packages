'use client';

import { Box, Button, Stack, TextField, Typography } from '@mui/material';

import type { CredentialFieldSpec, MaskedFieldState } from '@12-apps/payments-backend';

import { LINKISH_SX, T } from './panel-tokens';

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
// Drops a trailing "(...)" qualifier from a field label. Done by scanning
// rather than with /\s*\([^)]*\)\s*$/, which is polynomial-time on labels made
// of many spaces or many open parens (CodeQL: polynomial regular expression
// used on uncontrolled data) — the label is supplied by the caller.
function stripTrailingParenthetical(label: string): string {
  const trimmed = label.trimEnd();
  if (!trimmed.endsWith(')')) return trimmed;

  const open = trimmed.lastIndexOf('(');
  if (open === -1) return trimmed;

  return trimmed.slice(0, open).trimEnd();
}

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
    // Green, not grey: a finished step reads as an achievement at a glance, and
    // the whole point of collapsing it is that the eye can skip it on the way to
    // the step still owed.
    <Stack
      direction="row"
      spacing={1.25}
      alignItems="center"
      data-testid={testId}
      sx={{
        border: `1px solid ${T.okLine}`,
        background: T.okSoft,
        borderRadius: '9px',
        px: '16px',
        py: '11px',
        mx: '20px',
        mb: '10px',
        fontSize: '13px',
      }}
    >
      <Box aria-hidden sx={{ color: T.ok, fontWeight: 800 }}>
        ✓
      </Box>
      <Typography sx={{ fontSize: '13px', fontWeight: 600, color: T.ink }}>
        {stripTrailingParenthetical(label)}
      </Typography>
      <Typography sx={{ fontSize: '13px', color: T.ink3, ...(mono ? MONO_INPUT : {}) }}>
        {value}
      </Typography>
      <Box sx={{ flexGrow: 1 }} />
      <Button size="small" onClick={onEdit} data-testid={`${testId}-edit`} sx={LINKISH_SX}>
        {editLabel}
      </Button>
    </Stack>
  );
}
