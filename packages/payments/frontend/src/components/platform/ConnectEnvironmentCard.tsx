'use client';

import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { Fragment, useState, type ReactNode } from 'react';

import type {
  ConnectApplicationStatus,
  ConnectCredentialPreview,
  PaymentEnvironment,
} from '@12-apps/payments-backend';
import { usePlatformCopy } from './copy-context';

/**
 * One environment's Connect application (FUT-479, packaged by FUT-573).
 * Sandbox and production are SEPARATE applications with separate id/secret
 * pairs, so each card stands on its own: configured or not, what PagBank says
 * is registered, and whether the registered redirect URI matches the
 * deployment's callback — plus the first characters of each value it was
 * consulted with, so an operator can tell WHICH id, secret and token are in play.
 *
 * The same card renders the answer to a PASTED consult, so its test ids key on
 * a `slot` — the environment for the host's two cards, `PASTED` for that one —
 * rather than on the environment, which the pasted answer shares with one of
 * them.
 */

/** The bordered-card look every block of these screens shares. */
export const CARD_SX = {
  border: 1,
  borderColor: 'divider',
  borderRadius: 2,
  p: 2,
} as const;

/** A small button that is still a 40px tap target on a phone. */
export const TAP_SX = { minHeight: { xs: 40, sm: 'auto' } } as const;

/**
 * A label like `PAGBANK_OAUTH_CLIENT_SECRET` is one token, so a narrow card
 * would break it anywhere ("…SECRE / T"). A `<wbr>` after each underscore lets
 * it wrap at the word joints instead.
 */
function breakAfterUnderscores(label: string): ReactNode {
  return label.split(/(?<=_)/).map((part, index) => (
    // The parts are positional by construction; the label never reorders.
    <Fragment key={index}>
      {part}
      <wbr />
    </Fragment>
  ));
}

function Field({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <Box
      // Whole words stay whole; only an unbroken id or URL breaks mid-run.
      sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, minWidth: 180, overflowWrap: 'anywhere' }}
    >
      <Typography variant="caption" fontWeight={600}>
        {breakAfterUnderscores(label)}
      </Typography>
      <Typography component="span" variant="body2">
        {children}
      </Typography>
    </Box>
  );
}

/** The verdict the screen exists for: does the registered callback match ours? */
function MismatchAlert({ status, slot }: { status: ConnectApplicationStatus; slot: string }): ReactNode {
  const copy = usePlatformCopy().connect;
  if (status.application === null) return null;
  if (status.redirectUriMismatch === true) {
    return (
      <Alert severity="error" data-testid={`connect-mismatch-${slot}`}>
        {copy.redirectDiffers}
      </Alert>
    );
  }
  if (status.redirectUriMismatch === false) {
    return (
      <Alert severity="success" data-testid={`connect-match-${slot}`}>
        {copy.redirectMatches}
      </Alert>
    );
  }
  return (
    <Alert severity="warning" data-testid={`connect-unknown-${slot}`}>
      {copy.redirectUnreported}
    </Alert>
  );
}

/** What PagBank reports as registered, plus whatever extra keys came back. */
function ApplicationFields({ status, slot }: { status: ConnectApplicationStatus; slot: string }): ReactNode {
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
        <Box data-testid={`connect-extra-${slot}`}>
          <Typography variant="caption" fontWeight={600}>
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

const EMPTY_PREVIEW: ConnectCredentialPreview = {
  clientId: null,
  clientSecret: null,
  accountToken: null,
};

/** One previewed value: unset, inherited from a fallback variable, or its own. */
function PreviewValue({ value, inherited }: { value: string | null; inherited: boolean }): ReactNode {
  const copy = usePlatformCopy().connect;
  if (value === null) return copy.previewUnset;
  if (inherited) return copy.previewInherited(value);
  return (
    <Box component="code" sx={{ fontFamily: 'monospace', fontSize: 13 }}>
      {`${value}…`}
    </Box>
  );
}

/**
 * The first characters of each value the application was consulted with —
 * never the value. Each is named by the host's own variable when it supplies
 * them (`configVars`, in id / secret / token order), by the copy's names when not.
 */
function CredentialPreview({
  status,
  slot,
  configVars,
}: {
  status: ConnectApplicationStatus;
  slot: string;
  configVars?: string[];
}): ReactNode {
  const copy = usePlatformCopy().connect;
  // A payload from a backend older than the preview carries none — render it unset, never crash.
  const preview = status.credentialPreview ?? EMPTY_PREVIEW;
  const names = copy.credentialNames;
  const fields = ['clientId', 'clientSecret', 'accountToken'] as const;
  const rows = fields.map((field, index) => ({
    name: configVars?.[index] ?? names[field],
    value: preview[field],
    inherited: preview.inherited?.includes(field) ?? false,
  }));
  return (
    <Stack spacing={1} data-testid={`connect-preview-${slot}`}>
      <Typography variant="caption" fontWeight={600}>
        {copy.previewHeading}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2.5 }}>
        {rows.map(({ name, value, inherited }) => (
          <Field key={name} label={name}>
            <PreviewValue value={value} inherited={inherited} />
          </Field>
        ))}
      </Box>
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
        sx={TAP_SX}
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
  slot = status.environment,
  showConfigHelp = true,
}: {
  status: ConnectApplicationStatus;
  configVars?: string[];
  /** What the test ids key on — see the module doc. */
  slot?: string;
  /** The variable help belongs to a host-configured environment, not a pasted answer. */
  showConfigHelp?: boolean;
}): ReactNode {
  const copy = usePlatformCopy().connect;
  return (
    <Stack spacing={1.5} data-testid={`connect-env-${slot}`} sx={CARD_SX}>
      {/* The label never yields to a long client_id: the id wraps beneath it. */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 1.5 }}>
        <Typography variant="body2" fontWeight={600} sx={{ whiteSpace: 'nowrap' }}>
          {copy.environmentLabels[status.environment]}
        </Typography>
        <Typography
          component="span"
          variant="caption"
          color="text.secondary"
          sx={{ wordBreak: 'break-all', minWidth: 0 }}
        >
          {status.clientId !== null ? `client_id: ${status.clientId}` : ''}
        </Typography>
      </Box>
      {!status.configured ? (
        <Typography variant="body2" color="text.secondary">{copy.noApplication}</Typography>
      ) : null}
      {status.error !== null ? (
        <Alert severity="warning" data-testid={`connect-error-${slot}`}>
          {status.error}
        </Alert>
      ) : null}
      <MismatchAlert status={status} slot={slot} />
      <ApplicationFields status={status} slot={slot} />
      <CredentialPreview status={status} slot={slot} configVars={configVars} />
      {showConfigHelp ? <ConfigHelp environment={status.environment} configVars={configVars} /> : null}
    </Stack>
  );
}
