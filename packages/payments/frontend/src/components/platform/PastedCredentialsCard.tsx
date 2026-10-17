'use client';

import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import { useState, type ReactNode } from 'react';

import type {
  ConnectApplicationStatus,
  PastedConnectCredentials,
  PaymentEnvironment,
} from '@12-apps/payments-backend';

import { CARD_SX, ConnectEnvironmentCard, TAP_SX } from './ConnectEnvironmentCard';
import { usePlatformCopy } from './copy-context';

/**
 * Consult a Connect application with credentials PASTED here rather than the
 * ones the host holds — the backend's `consultPastedConnectApplication`.
 *
 * The host's two cards answer "what is configured?"; this answers "is the
 * application I am about to configure the right one, and is its redirect_uri
 * ours?" before anyone edits a secret and redeploys to find out. The answer
 * comes back in the same card the environments use, previews included, so the
 * three blocks read the same way.
 *
 * Whatever `onConsult` sends is the host's to keep out of storage and logs —
 * this card holds the values in component state and nowhere else.
 */

type PastedValues = Omit<PastedConnectCredentials, 'environment'>;

const EMPTY: PastedValues = { clientId: '', clientSecret: '', accountToken: '' };

/** The three paste fields; the secret two are masked as they are typed. */
function CredentialInputs({
  names,
  values,
  onChange,
}: {
  names: [string, string, string];
  values: PastedValues;
  onChange: (values: PastedValues) => void;
}): ReactNode {
  const fields: [keyof PastedValues, string, boolean][] = [
    ['clientId', names[0], false],
    ['clientSecret', names[1], true],
    ['accountToken', names[2], true],
  ];
  return fields.map(([key, label, secret]) => (
    <TextField
      key={key}
      size="small"
      type={secret ? 'password' : 'text'}
      label={label}
      value={values[key]}
      autoComplete={secret ? 'new-password' : 'off'}
      onChange={(event) => onChange({ ...values, [key]: event.target.value })}
      // Shrunk for good: the names share a long prefix, so an empty field's
      // placeholder-sized label is cut to the same "PAGBANK_OAUTH_CLIENT…" twice.
      slotProps={{
        inputLabel: { shrink: true },
        htmlInput: { 'data-testid': `connect-pasted-${key}` },
      }}
    />
  ));
}

/** The input names: the host's own variables when it names them, the copy's when not. */
function useCredentialNames(
  environment: PaymentEnvironment,
  configVarsFor?: (environment: PaymentEnvironment) => string[],
): [string, string, string] {
  const fallback = usePlatformCopy().connect.credentialNames;
  const vars = configVarsFor?.(environment) ?? [];
  return [
    vars[0] ?? fallback.clientId,
    vars[1] ?? fallback.clientSecret,
    vars[2] ?? fallback.accountToken,
  ];
}

/** One consult at a time: what it answered, whether it failed, whether it is running. */
function usePastedConsult(
  onConsult: (pasted: PastedConnectCredentials) => Promise<ConnectApplicationStatus>,
): {
  run: (pasted: PastedConnectCredentials) => void;
  pending: boolean;
  failed: boolean;
  result: ConnectApplicationStatus | null;
} {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [result, setResult] = useState<ConnectApplicationStatus | null>(null);
  const run = (pasted: PastedConnectCredentials): void => {
    setPending(true);
    setFailed(false);
    onConsult(pasted)
      .then(setResult)
      .catch(() => setFailed(true))
      .finally(() => setPending(false));
  };
  return { run, pending, failed, result };
}

export function PastedCredentialsCard({
  onConsult,
  configVarsFor,
}: {
  onConsult: (pasted: PastedConnectCredentials) => Promise<ConnectApplicationStatus>;
  configVarsFor?: (environment: PaymentEnvironment) => string[];
}): ReactNode {
  const copy = usePlatformCopy().connect;
  const [environment, setEnvironment] = useState<PaymentEnvironment>('SANDBOX');
  const [values, setValues] = useState<PastedValues>(EMPTY);
  const names = useCredentialNames(environment, configVarsFor);
  const consult = usePastedConsult(onConsult);
  const complete = Object.values(values).every((value) => value.trim() !== '');
  const trimmed = {
    environment,
    clientId: values.clientId.trim(),
    clientSecret: values.clientSecret.trim(),
    accountToken: values.accountToken.trim(),
  };

  return (
    <Stack spacing={1.5} data-testid="connect-pasted" sx={CARD_SX}>
      <Typography variant="body2" fontWeight={600}>
        {copy.pasted.heading}
      </Typography>
      <Typography variant="caption" component="p">
        {copy.pasted.lede}
      </Typography>
      <Stack spacing={1.5} sx={{ maxWidth: 560 }}>
        <TextField
          select
          size="small"
          label={copy.pasted.environment}
          value={environment}
          onChange={(event) => setEnvironment(event.target.value as PaymentEnvironment)}
          slotProps={{
            select: { native: true },
            htmlInput: { 'data-testid': 'connect-pasted-environment' },
          }}
        >
          <option value="SANDBOX">{copy.environmentLabels.SANDBOX}</option>
          <option value="PRODUCTION">{copy.environmentLabels.PRODUCTION}</option>
        </TextField>
        <CredentialInputs names={names} values={values} onChange={setValues} />
        <Box>
          <Button
            variant="contained"
            size="small"
            disabled={!complete || consult.pending}
            onClick={() => consult.run(trimmed)}
            data-testid="connect-pasted-submit"
            sx={TAP_SX}
          >
            {copy.pasted.submit}
          </Button>
        </Box>
      </Stack>
      <PastedAnswer consult={consult} configVarsFor={configVarsFor} />
    </Stack>
  );
}

/** The failure line, or the answer in the same card the environments use. */
function PastedAnswer({
  consult,
  configVarsFor,
}: {
  consult: ReturnType<typeof usePastedConsult>;
  configVarsFor?: (environment: PaymentEnvironment) => string[];
}): ReactNode {
  const copy = usePlatformCopy().connect;
  if (consult.failed) {
    return (
      <Alert severity="error" data-testid="connect-pasted-failed">
        {copy.pasted.failed}
      </Alert>
    );
  }
  if (!consult.result) return null;
  return (
    <ConnectEnvironmentCard
      status={consult.result}
      slot="PASTED"
      configVars={configVarsFor?.(consult.result.environment)}
      showConfigHelp={false}
    />
  );
}
