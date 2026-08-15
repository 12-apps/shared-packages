'use client';

import {
  Alert,
  Box,
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
import { useState, type ReactNode } from 'react';

import type {
  ConnectedOAuthAccount,
  MaskedProviderConfig,
  PaymentEnvironment,
  ProviderDescriptor,
} from '@12-apps/payments-backend';

import type { PaymentsSettingsClient } from '../client';
import { expiryProximity, isConnected } from './connection-state';
import {
  BAR_MSG_SX,
  BAR_SX,
  BTN_PRIMARY_SX,
  BTN_QUIET_DANGER_SX,
  BTN_SECONDARY_SX,
  LINKISH_SX,
  T,
} from './panel-tokens';

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

/**
 * What this connection IS, as four labelled facts.
 *
 * A connected store's screen used to answer "connected?" and stop. The
 * questions an owner actually returns with are which account, how it was
 * connected, which environment, and what it can take — and every one of them
 * was either absent or buried in a sentence. Read as a grid they are checkable
 * at a glance, which is the whole reason to come back to this screen at all.
 */
function ConnectionFacts({
  environment,
  account,
  displayName,
}: {
  environment: PaymentEnvironment;
  account: ConnectedOAuthAccount | null;
  displayName: string;
}) {
  const facts: [string, string][] = [
    ['Conta', account?.accountLabel ?? account?.accountId ?? `Conta ${displayName}`],
    ['Conexão', `Autorizada no ${displayName}`],
    ['Ambiente', environment === 'PRODUCTION' ? 'Produção' : 'Sandbox (testes)'],
  ];
  if (account?.connectedAt) {
    facts.push(['Conectada em', new Date(account.connectedAt).toLocaleString('pt-BR')]);
  }
  return (
    <Box
      data-testid="payments-connected-environment"
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
        gap: '12px 22px',
      }}
    >
      {facts.map(([key, value]) => (
        <Stack key={key} spacing={0.4} sx={{ borderLeft: `2px solid ${T.line2}`, pl: '11px' }}>
          <Typography
            sx={{
              fontSize: '11px',
              letterSpacing: '.05em',
              textTransform: 'uppercase',
              color: T.ink4,
              fontWeight: 700,
            }}
          >
            {key}
          </Typography>
          <Typography sx={{ fontSize: '13px', color: T.ink2, fontFamily: T.mono }}>
            {value}
          </Typography>
        </Stack>
      ))}
    </Box>
  );
}

/**
 * What authorizing actually involves, in three numbered steps.
 *
 * The card used to be one sentence and a button, which asks the owner to click
 * something that navigates away from their store to a site they will be asked
 * to log into. Numbering the three moments — sign in, authorize, come back —
 * makes the trip finite and says the one thing that most reduces hesitation:
 * you end up back here.
 */
function ConnectSteps({ displayName }: { displayName: string }) {
  const steps = [
    `Entre na sua conta ${displayName} — dá para criar uma na hora, se ainda não tiver.`,
    'Autorize o acesso na tela do provedor.',
    'Você volta para cá com a conta conectada.',
  ];
  return (
    <Stack component="ol" spacing={1.1} sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {steps.map((text, index) => (
        <Stack component="li" key={text} direction="row" gap="9px">
          <Box
            aria-hidden
            sx={{
              width: 19,
              height: 19,
              borderRadius: '50%',
              background: T.brandSoft,
              color: T.brandInk,
              fontSize: '11px',
              fontWeight: 700,
              display: 'grid',
              placeItems: 'center',
              flex: '0 0 auto',
              mt: '1px',
            }}
          >
            {index + 1}
          </Box>
          <Typography sx={{ fontSize: '13px', color: T.ink2, lineHeight: 1.5 }}>{text}</Typography>
        </Stack>
      ))}
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
 * Confirmation for Desconectar, which is destructive and irreversible from
 * here: it revokes the grant at the provider, so the store stops being able to
 * charge immediately and getting back requires the owner to authorize again on
 * the provider's site. It also sat one careless click from "Reconectar".
 */
function DisconnectDialog(props: {
  open: boolean;
  displayName: string;
  busy: boolean;
  /** The store is live on this provider — removing it stops checkout NOW. */
  receiving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  /** The softer path: keep the connection, stop taking orders through it. */
  onPauseInstead?: () => void;
}) {
  const { displayName, receiving } = props;
  return (
    <Dialog open={props.open} onClose={props.onCancel} data-testid="payments-disconnect-confirm">
      <DialogTitle sx={{ fontSize: '16.5px', fontWeight: 700, letterSpacing: '-.01em', pb: '8px' }}>
        Remover a conexão com {displayName}?
      </DialogTitle>
      <DialogContent sx={{ pb: '4px' }}>
        <DialogContentText sx={{ fontSize: '13px', color: T.ink2, lineHeight: 1.55 }}>
          {receiving
            ? 'A loja para de receber na hora e fica sem provedor ativo — pedidos novos não conseguem ser pagos até você conectar outro.'
            : 'Esta conexão sai da loja. Você pode conectar de novo depois.'}
        </DialogContentText>
        {/* The consequences, itemised. A single paragraph makes the reversible
            facts and the irreversible one weigh the same, and the one that
            costs money is the one an owner skims past. */}
        <Stack component="ul" spacing={1} sx={{ listStyle: 'none', m: 0, mt: '14px', p: 0 }}>
          {receiving ? (
            <Consequence tone="bad">Pedidos novos deixam de ser cobrados imediatamente.</Consequence>
          ) : null}
          <Consequence>
            {`A autorização é revogada no ${displayName}. Sua conta e seu histórico continuam lá, intactos.`}
          </Consequence>
          <Consequence>
            {`Pagamentos já aprovados e estornos em andamento seguem normalmente pelo ${displayName}.`}
          </Consequence>
          <Consequence>Para reconectar, os passos recomeçam do zero.</Consequence>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ display: 'flex', flexDirection: 'column', gap: '8px', p: '18px 22px 20px' }}>
        {/* Offered FIRST, and only when it is a real alternative. An owner who
            came here to stop taking orders wants the switch, not the removal —
            and reaching for the destructive control is how they got here. */}
        {receiving && props.onPauseInstead ? (
          <Button
            fullWidth
            onClick={props.onPauseInstead}
            disabled={props.busy}
            sx={BTN_SECONDARY_SX}
            data-testid="payments-pause-instead"
          >
            Só pausar o recebimento
          </Button>
        ) : null}
        <Button
          fullWidth
          variant="contained"
          disableElevation
          onClick={props.onConfirm}
          disabled={props.busy}
          data-testid="payments-disconnect-confirm-action"
          sx={{ ...BTN_PRIMARY_SX, background: T.bad, '&:hover': { background: '#a51f1f' } }}
        >
          {props.busy ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : 'Remover conexão'}
        </Button>
        <Button fullWidth onClick={props.onCancel} disabled={props.busy} sx={LINKISH_SX}>
          Cancelar
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** One consequence of removing the connection, marked by how much it costs. */
function Consequence({ children, tone }: { children: ReactNode; tone?: 'bad' }) {
  return (
    <Stack component="li" direction="row" gap="9px">
      <Box component="span" aria-hidden sx={{ fontWeight: 800, color: tone ? T.bad : T.ink4 }}>
        {tone ? '✕' : '·'}
      </Box>
      <Typography sx={{ fontSize: '12.5px', color: T.ink2, lineHeight: 1.5 }}>{children}</Typography>
    </Stack>
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
        connectedAccount={config?.connectedAccount ?? null}
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
        receiving={config?.enabled === true}
        onPauseInstead={() =>
          void run('pause', async () => {
            await client.setEnabled(descriptor.name, false);
            setConfirmingDisconnect(false);
          })
        }
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
