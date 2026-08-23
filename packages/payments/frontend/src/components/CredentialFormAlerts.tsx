'use client';

import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';

import type { VerifiedProviderConfig } from '@12-apps/payments-backend';

import { environmentLabels } from './EnvironmentTabs';
import type { CredentialFormCopy } from './settings-copy';
import { usePaymentsSettingsCopy } from './settings-copy-context';
import { BAR_MSG_SX, BAR_SX, BTN_PRIMARY_SX } from './panel-tokens';
import { richText } from './rich-text';

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
  const copy = usePaymentsSettingsCopy();
  const where = environmentLabels(copy.environment)[probe.environment];
  // The ADAPTER's sentence when it has one. Only it knows the provider's name,
  // what that provider's own app calls this field and which screen states it —
  // "confira as credenciais deste ambiente" is advice you can follow all
  // afternoon without ever finding the value you were asked to check.
  const message = probe.message ?? copy.credentials.probeFailed(where);

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
            {copy.credentials.probeAction}
          </Button>
        ) : undefined
      }
    >
      {message}
    </Alert>
  );
}

/**
 * Off-screen but read aloud. Inline rather than `@mui/utils`'s `visuallyHidden`,
 * which is not a dependency of this package — one style object is not worth a
 * new one on a package that ships to every host.
 */
const SCREEN_READER_ONLY = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

/** How each verdict reads at a glance — the mark, and what it is called. */
function checkMarks(copy: CredentialFormCopy) {
  return {
    PASS: { mark: '✓', color: 'success.main', label: copy.checkPass },
    FAIL: { mark: '✕', color: 'error.main', label: copy.checkFail },
    UNCHECKED: { mark: '–', color: 'text.secondary', label: copy.uncheckable },
  } as const;
}

/**
 * What the probe established, credential by credential (FUT-796).
 *
 * Rendered on a PASS as well as a failure, which is the point. One boolean over
 * a four-field form told an owner their connection was fine when only the
 * secret key had been checked — the publishable key and the signing secret
 * failed later, at a buyer's card and at a payment that never confirmed, where
 * neither looks like a credential problem.
 *
 * The `UNCHECKED` row is the one that earns this component. It says a
 * credential could NOT be verified and why, which a green tick would deny and a
 * red cross would misattribute — and it tells the owner precisely which part of
 * a passing result not to lean on.
 */
export function ProbeChecklist({
  probe,
  only,
}: {
  probe: VerifyProbe;
  /** Keep only the verdicts this predicate accepts — see `ProviderForm`. */
  only?: (key: string) => boolean;
}) {
  const marks = checkMarks(usePaymentsSettingsCopy().credentials);
  const shown = (probe.checks ?? []).filter((check) => only?.(check.key) ?? true);
  if (shown.length === 0) return null;
  return (
    <Stack spacing={0.5} data-testid="payments-probe-checks">
      {shown.map((check) => {
        const { mark, color, label } = marks[check.status];
        return (
          <Stack
            key={check.key}
            direction="row"
            spacing={1}
            alignItems="flex-start"
            data-testid={`payments-probe-check-${check.key}`}
            data-status={check.status}
          >
            <Typography component="span" sx={{ color, fontWeight: 700, lineHeight: 1.5 }}>
              <span aria-hidden>{mark}</span>
              {/* The mark alone is colour-only information; the state has to be
                  readable to anyone not seeing the colour. */}
              <Box component="span" sx={SCREEN_READER_ONLY}>{` ${label}: `}</Box>
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {check.message}
            </Typography>
          </Stack>
        );
      })}
    </Stack>
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
export function ReverifyWarning({ displayName }: { displayName: string }) {
  const copy = usePaymentsSettingsCopy().credentials;
  return (
    <Alert severity="warning" data-testid="payments-reverify-warning">
      {richText(copy.reverifyWarning(displayName))}
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
  willTest,
  disabled,
  onSave,
}: {
  busy: string | null;
  label: string;
  /** Whether pressing save will also SEND the set to the provider. */
  willTest: boolean;
  disabled: boolean;
  onSave: () => void;
}) {
  // The bar states what pressing it costs, which is the half a verb cannot
  // carry: a complete set is sent to the provider on save, and a partial one is
  // only written down. The owner reads the promise and the button in one line.
  const copy = usePaymentsSettingsCopy().credentials;
  const message =
    busy === 'verify'
      ? copy.probeRunning
      : willTest
        ? copy.probeSaveNote
        : copy.probeIncompleteNote;

  return (
    <Box sx={BAR_SX} data-testid="payments-form-bar">
      <Typography sx={BAR_MSG_SX} data-testid={busy === 'verify' ? 'payments-verifying' : undefined}>
        {busy === 'verify' ? (
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <CircularProgress size={14} />
            {message}
          </Box>
        ) : (
          message
        )}
      </Typography>
      <Button
        variant="contained"
        disableElevation
        data-testid="payments-save"
        disabled={busy !== null || disabled}
        sx={BTN_PRIMARY_SX}
        onClick={onSave}
      >
        {busy === 'save' ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : label}
      </Button>
    </Box>
  );
}
