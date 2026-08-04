'use client';

import { Alert, Button, CircularProgress, Stack, Typography } from '@mui/material';

import type { VerifiedProviderConfig } from '@12-apps/payments-backend';

import { ENVIRONMENT_LABELS } from './EnvironmentTabs';

/**
 * The credential step's alerts and its one button.
 *
 * Split from `ProviderCredentialForm` because that file is about the FORM's
 * state machine — what is typed, what is stored, what the probe last said —
 * while these three are about the sentences the owner reads when it goes
 * wrong, and each of those sentences was learned from a screen that got it
 * wrong in a way that cost somebody money.
 */

// Named for what it is here, not `ProbeResult` — the payments package already
// exports a different `ProbeResult` (failover classification).
export type VerifyProbe = VerifiedProviderConfig['probe'];

/**
 * What the probe found — only when it found something WRONG.
 *
 * A passing probe already has a place to be said: the `CONEXÃO OK` chip in the
 * header, which persists. Repeating it as a green banner mid-flow added a
 * fourth block to a screen whose whole point is showing one step at a time,
 * and said nothing the chip had not. A failure is different: the chip can only
 * report that something is wrong, not which environment or what to do, so that
 * one still gets its sentence.
 */
export function ProbeAlert({
  probe,
  busy,
  onRetry,
}: {
  probe: VerifyProbe;
  busy: boolean;
  onRetry: () => void;
}) {
  if (probe.ok) return null;
  const where = ENVIRONMENT_LABELS[probe.environment];
  // The ADAPTER's sentence when it has one. Only it knows the provider's name,
  // what that provider's own app calls this field and which screen states it —
  // "confira as credenciais deste ambiente" is advice you can follow all
  // afternoon without ever finding the value you were asked to check.
  const message =
    probe.message ??
    `Não foi possível conectar em ${where}. Confira as credenciais deste ambiente.`;

  // An outage is not a rejection. The credential is already SAVED and may well
  // be perfect; nothing was learned about it. So it is amber rather than red,
  // and it carries the only control that helps — ask again. Without one the
  // owner's sole route back was to re-save a value that was never wrong, and
  // saving is what resets the connection.
  const unreachable = probe.fault === 'UNREACHABLE';
  return (
    <Alert
      severity={unreachable ? 'warning' : 'error'}
      data-testid="payments-probe-result"
      action={
        unreachable ? (
          <Button
            size="small"
            disabled={busy}
            onClick={onRetry}
            data-testid="payments-verify-retry"
            sx={{ textTransform: 'none' }}
          >
            Testar conexão
          </Button>
        ) : undefined
      }
    >
      {message}
    </Alert>
  );
}

/**
 * Changing the tag on a store that has ALREADY proved it can receive.
 *
 * The dialog two steps later asks "is this the right account"; this answers a
 * different question the owner has not thought to ask — what happens to the
 * store while they do it. A save invalidates the proof and drops the provider
 * out of the failover chain (`applySaveCredentials`), so the shop stops taking
 * money through it until a new activation charge lands. That is entirely
 * correct and entirely invisible, and an owner who came to fix a typo deserves
 * to learn it before typing rather than from a quiet storefront.
 */
export function ReverifyWarning() {
  return (
    <Alert severity="warning" data-testid="payments-reverify-warning">
      Esta loja já está verificada. Trocar a InfiniteTag <strong>exige uma nova verificação</strong>{' '}
      e a loja <strong>para de receber</strong> por este provedor até que ela termine.
    </Alert>
  );
}

/** Salvar + Testar conexão, each dead when it would do nothing (or harm). */
/**
 * One button. Saving IS testing.
 *
 * "Testar conexão" was a second button the owner had to know to press, guarding
 * a step they could not finish without it — and its enablement rule was the
 * inverse of Salvar's (dead while the form was dirty, live only once it was
 * clean), so the two took turns being grey for reasons no label explained.
 * Nothing is learned by separating them: the probe reads what was just stored,
 * so the only useful moment to run it is immediately after a save.
 */
export function FormActions({
  busy,
  label,
  disabled,
  onSave,
}: {
  busy: string | null;
  label: string;
  disabled: boolean;
  onSave: () => void;
}) {
  return (
    <Stack spacing={1} alignItems="flex-start">
      <Button
        variant="contained"
        data-testid="payments-save"
        disabled={busy !== null || disabled}
        sx={{ textTransform: 'none' }}
        onClick={onSave}
      >
        {busy === 'save' ? <CircularProgress size={18} /> : label}
      </Button>
      {busy === 'verify' ? (
        <Stack direction="row" spacing={1} alignItems="center" data-testid="payments-verifying">
          <CircularProgress size={14} />
          <Typography variant="body2" color="text.secondary">
            Testando a conexão…
          </Typography>
        </Stack>
      ) : null}
    </Stack>
  );
}
