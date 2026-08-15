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
  /**
   * What the last probe found about THIS credential, when it found anything.
   *
   * The adapter has always returned per-credential verdicts; the screen showed
   * them as a list under the form, which leaves the owner matching four
   * sentences to four boxes by eye. A verdict about a field belongs at the
   * field: "chave publicável de produção em conexão de teste" is unactionable
   * three boxes away from the box it is about.
   */
  check?: { status: 'PASS' | 'FAIL' | 'UNCHECKED'; message: string };
}

/** One schema-driven form field. Secrets are write-only: hint, never value. */
export function CredentialField({ spec, state, value, onChange, check }: CredentialFieldProps) {
  const presentation = fieldPresentation(spec, state, value);
  // Label ABOVE the box, not floating in it. Four credentials whose names are
  // the only thing distinguishing them (`sk_`, `pk_`, `whsec_`, `acct_`) are
  // read as a column, and a floating label disappears the moment a value is
  // pasted — exactly when the owner is checking they pasted into the right one.
  // `htmlFor`/`id` rather than a bare <label>: lifting the text out of
  // TextField also lifts it out of MUI's own labelling, and an input whose
  // label is merely ABOVE it is unlabelled to a screen reader and unfindable by
  // `getByLabelText`. The association has to be restated by hand.
  const inputId = `payments-credential-${spec.key}`;
  return (
    <Box>
      <Typography
        component="label"
        htmlFor={inputId}
        sx={{ display: 'block', fontSize: '12px', fontWeight: 650, color: T.ink2, mb: '5px' }}
      >
        {spec.label}
        {spec.advanced ? (
          <Box component="span" sx={{ fontWeight: 500, color: T.ink4 }}>
            {' · só para plataformas Connect'}
          </Box>
        ) : null}
      </Typography>
      <TextField
        size="small"
        fullWidth
        id={inputId}
        {...presentation}
        helperText={undefined}
        slotProps={
          spec.mono ? { htmlInput: { sx: MONO_INPUT, spellCheck: false } } : { htmlInput: {} }
        }
        sx={fieldSx(check?.status)}
        onChange={(e) => onChange(e.target.value)}
      />
      <FieldNote
        check={check}
        fallback={presentation.helperText ?? spec.helperText}
        testId={`payments-field-note-${spec.key}`}
      />
    </Box>
  );
}

/**
 * The box itself: 8px, hairline, brand focus ring — and the probe's verdict in
 * its border, so a wrong credential is visible before any sentence is read.
 */
function fieldSx(status?: 'PASS' | 'FAIL' | 'UNCHECKED') {
  const failed = status === 'FAIL';
  return {
    '& .MuiOutlinedInput-root': {
      borderRadius: '8px',
      fontSize: '13px',
      background: failed ? '#fffbfb' : undefined,
      '& fieldset': {
        borderColor: failed ? T.bad : status === 'PASS' ? T.okLine : T.line,
      },
      '&:hover fieldset': { borderColor: failed ? T.bad : T.ink4 },
      '&.Mui-focused fieldset': { borderColor: T.brand, borderWidth: '2px' },
    },
    '& .MuiOutlinedInput-input': { padding: '10px 12px' },
  } as const;
}

/** The line under a box: the probe's verdict when there is one, else the hint. */
function FieldNote({
  check,
  fallback,
  testId,
}: {
  check?: { status: 'PASS' | 'FAIL' | 'UNCHECKED'; message: string };
  fallback?: string;
  testId: string;
}) {
  const text = check?.message ?? fallback;
  if (!text) return null;
  const failed = check?.status === 'FAIL';
  const passed = check?.status === 'PASS';
  return (
    <Stack direction="row" gap="6px" alignItems="flex-start" sx={{ mt: '5px' }} data-testid={testId}>
      {check && check.status !== 'UNCHECKED' ? (
        <Box component="span" aria-hidden sx={{ fontWeight: 800, color: failed ? T.bad : T.ok }}>
          {failed ? '✕' : '✓'}
        </Box>
      ) : null}
      <Typography
        sx={{
          fontSize: '11.5px',
          lineHeight: 1.45,
          color: failed ? T.bad : passed ? T.ok : T.ink3,
          fontWeight: failed ? 500 : 400,
        }}
      >
        {text}
      </Typography>
    </Stack>
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
