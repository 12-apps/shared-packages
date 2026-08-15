'use client';

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  Typography,
} from '@mui/material';
import { useState } from 'react';

import type {
  ConnectedOAuthAccount,
  MaskedProviderConfig,
  PaymentEnvironment,
  ProviderDescriptor,
} from '@12-apps/payments-backend';

import type { PaymentsSettingsClient } from '../client';
import { ConnectionFacts, ConnectSteps, DisconnectDialog } from './ConnectionCard';
import { expiryProximity, isConnected } from './connection-state';
import { BAR_MSG_SX, BAR_SX, BTN_PRIMARY_SX, BTN_QUIET_DANGER_SX, T } from './panel-tokens';

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

/**
 * The expiry caption, with PROXIMITY emphasis (FUT-683): the renewal sweep
 * normally refreshes a grant long before it lapses, so an expiry that is
 * actually close means renewal has been failing quietly — and this caption is
 * the only warning an owner gets before checkout starts refusing. A neutral
 * gray line read the same on the eve of an outage as a year out.
 */
function ExpiryNote(props: { expiresAt: string }) {
  const when = new Date(props.expiresAt).toLocaleString('pt-BR');
  const proximity = expiryProximity(props.expiresAt);
  if (proximity === 'SAFE' || proximity === null) {
    return (
      <Typography variant="caption" color="text.secondary">
        {`Autorização válida até ${when}`}
      </Typography>
    );
  }
  return (
    <Typography
      variant="caption"
      color={proximity === 'PAST' ? 'error.main' : 'warning.main'}
      sx={{ fontWeight: 600 }}
      data-testid="payments-expiry-warning"
    >
      {proximity === 'PAST'
        ? `A autorização expirou em ${when}. Reconecte para voltar a receber pagamentos.`
        : `A autorização expira em ${when}. Se o aviso continuar, reconecte a conta.`}
    </Typography>
  );
}

/**
 * A failed connect, in the owner's terms.
 *
 * The one case worth naming is the deployment that has registered no OAuth
 * application for this provider. It surfaced as
 * `{"error":"CredentialsError","message":"No platform OAuth application
 * credentials configured for stripe/SANDBOX"}` in a red box under the connect
 * button — an error class, a slash-joined pair of internal identifiers, and not
 * one word about what to do. It is not a failure the owner caused or can fix,
 * and it is not a dead end either: the credentials path works, and it is right
 * there on the same screen. So it reads as a warning that names the way round.
 *
 * Anything else is passed through. The adapter's own sentence beats a generic
 * one, and inventing copy for a failure we have not seen is how a screen ends
 * up confidently misdescribing an outage.
 */
function connectFailure(
  message: string,
  displayName: string,
): { severity: 'error' | 'warning'; text: string } {
  if (/no platform oauth application credentials/i.test(message)) {
    return {
      severity: 'warning',
      text:
        `A conexão automática com ${displayName} não está disponível nesta instalação — ` +
        'o aplicativo de autorização não foi cadastrado. Para conectar agora, abra ' +
        '“Prefiro informar as credenciais manualmente” abaixo e cole as suas próprias chaves.',
    };
  }
  return { severity: 'error', text: message };
}

function ConnectError({ message, displayName }: { message: string; displayName: string }) {
  const { severity, text } = connectFailure(message, displayName);
  return (
    <Alert severity={severity} data-testid="payments-connect-failure">
      {text}
    </Alert>
  );
}

function connectLabel(displayName: string, connected: boolean, busy: string | null) {
  if (busy === 'connect') return <CircularProgress size={18} />;
  return connected ? 'Reconectar' : `Conectar com ${displayName}`;
}

/**
 * pt-BR labels for the scopes a store owner actually sees. Unknown scopes fall
 * back to the provider's own spelling — wrong words are worse than raw ones.
 */
const SCOPE_LABELS: Record<string, string> = {
  'payments.read': 'Consultar pagamentos',
  'payments.create': 'Criar cobranças',
  'payments.refund': 'Estornar pagamentos',
  'accounts.read': 'Consultar dados da conta',
};

/**
 * WHICH account is connected (FUT-300): identity, granted scopes and the
 * connect date — the difference between "conectado" and "conectado como".
 * Without it, the only way an owner could tell which PagBank account a store
 * charges into was to disconnect and connect again.
 */
function ConnectedAccountDetails(props: { account: ConnectedOAuthAccount }) {
  const { account } = props;
  const identity = account.accountLabel ?? account.accountId;
  return (
    <Stack spacing={0.5} data-testid="payments-connected-account">
      {identity ? (
        <Typography variant="body2">
          Conta conectada: <strong>{identity}</strong>
        </Typography>
      ) : null}
      {account.connectedAt ? (
        <Typography variant="caption" color="text.secondary">
          {`Conectada em ${new Date(account.connectedAt).toLocaleString('pt-BR')}`}
        </Typography>
      ) : null}
      {account.grantedScopes.length > 0 ? (
        <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
          {account.grantedScopes.map((scope) => (
            <Chip
              key={scope}
              size="small"
              variant="outlined"
              label={SCOPE_LABELS[scope] ?? scope}
            />
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
}



/** Header + explanatory copy + any warning banner for the connection. */
function ConnectionSummary(props: {
  displayName: string;
  status: string;
  connected: boolean;
  expiresAt: string | null;
  environment: PaymentEnvironment;
  connectedAccount: ConnectedOAuthAccount | null;
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
        <ConnectionFacts
          environment={props.environment}
          account={props.connectedAccount}
          displayName={props.displayName}
        />
      ) : null}
      {/*
        The connected sentence names NO platform. It used to open with one
        adopter's product name, hard-coded — so every other host installing this
        package told its own merchants that somebody else's product was creating
        their charges, with no prop to change it. The tell that it was an
        oversight rather than a decision is the branch right below, which already
        templates the provider from props.

        Nothing was lost by removing it. The sentence exists to answer ONE
        question — why no API key had to be copied — and the answer is the OAuth
        grant, not whose logo is on the page. The subject is the connection
        itself, which is true for every host and needs no new configuration.
      */}
      <Typography sx={{ fontSize: '13px', color: T.ink2, lineHeight: 1.6 }}>
        {props.connected
          ? 'Sua conta está conectada. As cobranças são criadas em seu nome — nenhuma chave precisa ser copiada.'
          : `Conecte sua conta ${props.displayName} autorizando o acesso no site do provedor. Nenhuma chave precisa ser copiada.`}
      </Typography>
      {props.connected ? null : <ConnectSteps displayName={props.displayName} />}
      {props.connected && props.connectedAccount ? (
        <ConnectedAccountDetails account={props.connectedAccount} />
      ) : null}
      {props.status === 'RECONNECT_REQUIRED' ? (
        <Alert severity="warning">
          A autorização expirou ou foi revogada. Reconecte para voltar a receber pagamentos.
        </Alert>
      ) : null}
      {props.expiresAt ? <ExpiryNote expiresAt={props.expiresAt} /> : null}
    </>
  );
}



/**
 * The connect card's action bar.
 *
 * Removing the connection is stated QUIETLY beside the step's own button rather
 * than as a second filled control: an owner reaches it deliberately or not at
 * all, and a red button of equal weight on every visit is an invitation to
 * misclick the one action here that cannot be undone from this screen.
 */
function ConnectionActions(props: {
  displayName: string;
  connected: boolean;
  busy: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const { displayName, connected, busy, onConnect, onDisconnect } = props;
  return (
    <Box sx={BAR_SX} data-testid="payments-connection-bar">
      <Typography sx={BAR_MSG_SX}>
        {connected
          ? `Conta ${displayName} conectada. Revogue quando quiser, aqui ou no painel do provedor.`
          : 'Você sai para o provedor e volta para cá — leva menos de um minuto.'}
      </Typography>
      {connected ? (
        <Button
          disabled={busy !== null}
          onClick={onDisconnect}
          sx={BTN_QUIET_DANGER_SX}
          data-testid="payments-disconnect"
        >
          {busy === 'disconnect' ? <CircularProgress size={18} /> : 'Remover conexão'}
        </Button>
      ) : null}
      <Button
        variant="contained"
        disableElevation
        disabled={busy !== null}
        onClick={onConnect}
        sx={BTN_PRIMARY_SX}
      >
        {connectLabel(displayName, connected, busy)}
      </Button>
    </Box>
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

/**
 * The connection as this card reads it, with every default applied once.
 *
 * `environment` follows whatever the provider is already configured for and
 * falls back to SANDBOX, so a live grant is never the accident — changing it is
 * an ADVANCED action that lives with the manual credentials, not on the
 * one-button connect card.
 */
function readConnection(config: MaskedProviderConfig | null) {
  return {
    environment: (config?.environment ?? 'SANDBOX') as PaymentEnvironment,
    status: config?.status ?? 'UNVERIFIED',
    connected: isConnected(config),
    expiresAt: config?.expiresAt ?? null,
    account: config?.connectedAccount ?? null,
    receiving: config?.enabled === true,
  };
}

export function ProviderConnection(props: ProviderConnectionProps) {
  const { descriptor, config, client, prepareConnect, onChanged } = props;
  const { busy, error, run } = useConnectionAction(onChanged);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const { environment, status, connected, expiresAt, account, receiving } = readConnection(config);

  /** Run a dialog action and shut the dialog once it has actually landed. */
  const close = (kind: string, action: () => Promise<unknown>) =>
    void run(kind, async () => {
      await action();
      setConfirmingDisconnect(false);
    });

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
        expiresAt={expiresAt}
        environment={environment}
        connectedAccount={account}
      />

      {error ? <ConnectError message={error} displayName={descriptor.displayName} /> : null}

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
        // Live on this provider: removing it stops checkout, and pausing is a
        // real alternative rather than a lesser version of the same thing.
        receiving={receiving}
        onPauseInstead={() => close('pause', () => client.setEnabled(descriptor.name, false))}
        onCancel={() => setConfirmingDisconnect(false)}
        onConfirm={() => close('disconnect', () => client.disconnectOAuth(descriptor.name))}
      />
    </Stack>
  );
}
