'use client';

import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { useState, type ReactNode } from 'react';

import type { ConnectApplicationStatus, PaymentEnvironment } from '@12-apps/payments-backend';
import { usePlatformCopy } from './copy-context';

/**
 * One environment's Connect application (FUT-479, packaged by FUT-573).
 * Sandbox and production are SEPARATE applications with separate id/secret
 * pairs, so each card stands on its own: configured or not, what PagBank says
 * is registered, and whether the registered redirect URI matches the
 * deployment's callback.
 *
 * English, like the rest of this platform surface (FUT-760) — see
 * `ConnectApplicationPanel` for why.
 */

const ENV_LABEL: Record<PaymentEnvironment, string> = {
  SANDBOX: 'Sandbox',
  PRODUCTION: 'Production',
};

/** The bordered-card look every block of these screens shares. */
export const CARD_SX = {
  border: 1,
  borderColor: 'divider',
  borderRadius: 2,
  p: 2,
} as const;

function Field({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <Box
      sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, minWidth: 180, wordBreak: 'break-all' }}
    >
      <Typography variant="caption" color="text.secondary" fontWeight={600}>
        {label}
      </Typography>
      <Typography component="span" variant="body2">
        {children}
      </Typography>
    </Box>
  );
}

/** The verdict the screen exists for: does the registered callback match ours? */
function MismatchAlert({ status }: { status: ConnectApplicationStatus }): ReactNode {
  const copy = usePlatformCopy().connect;
  if (status.application === null) return null;
  if (status.redirectUriMismatch === true) {
    return (
      <Alert severity="error" data-testid={`connect-mismatch-${status.environment}`}>
        {copy.redirectDiffers}
      </Alert>
    );
  }
  if (status.redirectUriMismatch === false) {
    return (
      <Alert severity="success" data-testid={`connect-match-${status.environment}`}>
        {copy.redirectMatches}
      </Alert>
    );
  }
  return (
    <Alert severity="warning" data-testid={`connect-unknown-${status.environment}`}>
      {copy.redirectUnreported}
    </Alert>
  );
}

/** What PagBank reports as registered, plus whatever extra keys came back. */
function ApplicationFields({ status }: { status: ConnectApplicationStatus }): ReactNode {
  const copy = usePlatformCopy().connect;
  const app = status.application;
  if (app === null) return null;
  const extraKeys = Object.keys(app.extra);
  return (
    <Stack spacing={1.5}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2.5 }}>
        <Field label={copy.fields.name}>{app.name ?? copy.fieldEmpty}</Field>
        <Field label={copy.fields.site}>{app.site ?? copy.fieldEmpty}</Field>
        <Field label={copy.fields.description}>{app.description ?? copy.fieldEmpty}</Field>
        <Field label={copy.fields.logo}>{app.logo ?? copy.fieldEmpty}</Field>
        <Field label={copy.fields.redirectUri}>
          {app.redirectUri ?? copy.redirectNotReported}
        </Field>
      </Box>
      {extraKeys.length > 0 ? (
        <Box data-testid={`connect-extra-${status.environment}`}>
          <Typography variant="caption" color="text.secondary" fontWeight={600}>
            {copy.extraKeys}
          </Typography>
          <Box component="pre" sx={{ m: 0, fontSize: 12, overflowX: 'auto' }}>
            {JSON.stringify(app.extra, null, 2)}
          </Box>
        </Box>
      ) : null}
    </Stack>
  );
}

/**
 * The collapsible "what feeds this environment" help. The variable names are
 * the HOST's own configuration surface, so they arrive via `configVars`; with
 * none provided the toggle is omitted entirely rather than opening on nothing.
 */
function ConfigHelp({
  environment,
  configVars,
}: {
  environment: PaymentEnvironment;
  configVars?: string[];
}): ReactNode {
  const copy = usePlatformCopy().connect;
  const [open, setOpen] = useState(false);
  if (!configVars || configVars.length === 0) return null;
  return (
    <Stack spacing={1} alignItems="flex-start">
      <Button
        variant="outlined"
        size="small"
        onClick={() => setOpen((value) => !value)}
        data-testid={`connect-config-toggle-${environment}`}
      >
        {open ? copy.hideConfig : copy.showConfig}
      </Button>
      {open ? (
        <Box data-testid={`connect-config-details-${environment}`}>
          <Typography variant="caption" color="text.secondary" component="p">
            {copy.resolvedFrom}
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {configVars.map((name) => (
              <Box component="li" key={name}>
                <Box component="code" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {name}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      ) : null}
    </Stack>
  );
}

export function ConnectEnvironmentCard({
  status,
  configVars,
}: {
  status: ConnectApplicationStatus;
  configVars?: string[];
}): ReactNode {
  const copy = usePlatformCopy().connect;
  return (
    <Stack spacing={1.5} data-testid={`connect-env-${status.environment}`} sx={CARD_SX}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, wordBreak: 'break-all' }}>
        <Typography variant="body2" fontWeight={600}>
          {ENV_LABEL[status.environment]}
        </Typography>
        <Typography component="span" variant="caption" color="text.secondary">
          {status.clientId !== null ? `client_id: ${status.clientId}` : ''}
        </Typography>
      </Box>
      {!status.configured ? (
        <Typography variant="body2" color="text.secondary">{copy.noApplication}</Typography>
      ) : null}
      {status.error !== null ? (
        <Alert severity="warning" data-testid={`connect-error-${status.environment}`}>
          {status.error}
        </Alert>
      ) : null}
      <MismatchAlert status={status} />
      <ApplicationFields status={status} />
      <ConfigHelp environment={status.environment} configVars={configVars} />
    </Stack>
  );
}
