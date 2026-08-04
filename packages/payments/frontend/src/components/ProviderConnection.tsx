'use client';

import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import { useState } from 'react';

import type {
  MaskedProviderConfig,
  PaymentEnvironment,
  ProviderDescriptor,
} from '@12-apps/payments-backend';

import type { PaymentsSettingsClient } from '../client';
import { isConnected } from './connection-state';

/**
 * The `authMode: 'oauth'` half of the settings page: a provider whose
 * connection is a BUTTON, not a form. Replaces the credential fields with a
 * connection card — connect / reconnect / disconnect plus the connection's
 * live state.
 *
 * The `state` parameter is minted and stored server-side by the host and
 * echoed back on the callback; this component only relays it, so a forged
 * connect attempt cannot originate here.
 */
export interface ProviderConnectionProps {
  descriptor: ProviderDescriptor;
  config: MaskedProviderConfig | null;
  client: PaymentsSettingsClient;
  /**
   * Host endpoint that mints + persists the CSRF state against the admin
   * session and returns it with the callback URL to come back to.
   */
  prepareConnect: (
    provider: string,
    environment: PaymentEnvironment,
  ) => Promise<{ state: string; redirectUri: string; environment?: PaymentEnvironment }>;
  onChanged: () => void;
}

function expiryNote(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const when = new Date(expiresAt);
  return `Autorização válida até ${when.toLocaleString('pt-BR')}`;
}

function connectLabel(displayName: string, connected: boolean, busy: string | null) {
  if (busy === 'connect') return <CircularProgress size={18} />;
  return connected ? 'Reconectar' : `Conectar com ${displayName}`;
}

/** Header + explanatory copy + any warning banner for the connection. */
function ConnectionSummary(props: {
  displayName: string;
  status: string;
  connected: boolean;
  expiresAt: string | null;
  environment: PaymentEnvironment;
}) {
  return (
    <>
      {/*
        No name and no status chip here: the provider header above this card
        already carries both, and printing them twice produced two "PagBank"
        headings stacked on top of each other with different-looking states.
        Only the environment — which the header cannot know — is shown, and only
        once connected, since the provider sealed it into the grant.
      */}
      {props.connected ? (
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip
            size="small"
            variant="outlined"
            data-testid="payments-connected-environment"
            label={props.environment === 'PRODUCTION' ? 'Produção' : 'Sandbox (testes)'}
            color={props.environment === 'PRODUCTION' ? 'default' : 'warning'}
          />
        </Stack>
      ) : null}
      <Typography variant="body2" color="text.secondary">
        {props.connected
          ? 'Sua conta está conectada. O Future Pay cria as cobranças em seu nome — nenhuma chave precisa ser copiada.'
          : `Conecte sua conta ${props.displayName} autorizando o acesso no site do provedor. Nenhuma chave precisa ser copiada.`}
      </Typography>
      {props.status === 'RECONNECT_REQUIRED' ? (
        <Alert severity="warning">
          A autorização expirou ou foi revogada. Reconecte para voltar a receber pagamentos.
        </Alert>
      ) : null}
      {props.expiresAt ? (
        <Typography variant="caption" color="text.secondary">
          {expiryNote(props.expiresAt)}
        </Typography>
      ) : null}
    </>
  );
}

/**
 * Confirmation for Desconectar, which is destructive and irreversible from
 * here: it revokes the grant at the provider, so the store stops being able to
 * charge immediately and getting back requires the owner to authorize again on
 * the provider's site. It also sat one careless click from "Reconectar".
 */
function DisconnectDialog(props: {
  open: boolean;
  displayName: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={props.open} onClose={props.onCancel} data-testid="payments-disconnect-confirm">
      <DialogTitle>Desconectar {props.displayName}?</DialogTitle>
      <DialogContent>
        <DialogContentText>
          A autorização será revogada no {props.displayName} e sua loja deixa de conseguir cobrar
          imediatamente. Para voltar a receber, será necessário conectar a conta novamente
          autorizando o acesso no site do provedor.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onCancel} disabled={props.busy}>
          Cancelar
        </Button>
        <Button
          color="error"
          variant="contained"
          onClick={props.onConfirm}
          disabled={props.busy}
          data-testid="payments-disconnect-confirm-action"
        >
          {props.busy ? <CircularProgress size={18} /> : 'Desconectar'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ConnectionActions(props: {
  displayName: string;
  connected: boolean;
  busy: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const { displayName, connected, busy, onConnect, onDisconnect } = props;
  return (
    <Stack direction="row" spacing={1}>
      <Button variant="contained" disabled={busy !== null} onClick={onConnect}>
        {connectLabel(displayName, connected, busy)}
      </Button>
      {connected ? (
        <Button variant="outlined" color="error" disabled={busy !== null} onClick={onDisconnect}>
          {busy === 'disconnect' ? <CircularProgress size={18} /> : 'Desconectar'}
        </Button>
      ) : null}
    </Stack>
  );
}

/** One in-flight action at a time, with its failure surfaced to the owner. */
function useConnectionAction(onChanged: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (kind: string, action: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return { busy, error, run };
}

export function ProviderConnection(props: ProviderConnectionProps) {
  const { descriptor, config, client, prepareConnect, onChanged } = props;
  const { busy, error, run } = useConnectionAction(onChanged);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  // Which account the owner is connecting. Follows whatever this provider is
  // already configured for, defaulting to SANDBOX so a live grant is never the
  // accident. Changing it is an ADVANCED action and lives with the manual
  // credentials, not on the one-button connect card.
  const environment: PaymentEnvironment = config?.environment ?? 'SANDBOX';
  const status = config?.status ?? 'UNVERIFIED';
  const connected = isConnected(config);

  const connect = () =>
    void run('connect', async () => {
      // The host re-reads and seals the environment server-side; sending it
      // here is what stops a SANDBOX choice from authorizing a LIVE account.
      const ctx = await prepareConnect(descriptor.name, environment);
      const { url } = await client.beginOAuth(descriptor.name, { environment, ...ctx });
      // Full-page navigation: the provider's consent screen must be a
      // top-level document, never an iframe.
      window.location.assign(url);
    });

  return (
    <Stack spacing={2}>
      <ConnectionSummary
        displayName={descriptor.displayName}
        status={status}
        connected={connected}
        expiresAt={config?.expiresAt ?? null}
        environment={environment}
      />

      {error ? <Alert severity="error">{error}</Alert> : null}

      <ConnectionActions
        displayName={descriptor.displayName}
        connected={connected}
        busy={busy}
        onConnect={connect}
        onDisconnect={() => setConfirmingDisconnect(true)}
      />

      <DisconnectDialog
        open={confirmingDisconnect}
        displayName={descriptor.displayName}
        busy={busy === 'disconnect'}
        onCancel={() => setConfirmingDisconnect(false)}
        onConfirm={() =>
          void run('disconnect', async () => {
            await client.disconnectOAuth(descriptor.name);
            setConfirmingDisconnect(false);
          })
        }
      />
    </Stack>
  );
}
