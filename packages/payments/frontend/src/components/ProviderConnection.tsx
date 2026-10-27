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
import { EnvironmentSelector } from './EnvironmentTabs';
import { readConnection, useConnectEnvironment } from './connect-environment';
import { expiryProximity } from './connection-state';
import {
  BAR_MSG_SX,
  BAR_SX,
  BTN_PRIMARY_SX,
  BTN_QUIET_DANGER_SX,
  CARD_INSET,
  T,
} from './panel-tokens';
import type { OAuthConnectionCopy } from './settings-copy';
import { describeFailure } from './failure-copy';
import { usePaymentsFailureCopy, usePaymentsSettingsCopy } from './settings-copy-context';

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
  const copy = usePaymentsSettingsCopy().oauth;
  const when = new Date(props.expiresAt).toLocaleString('pt-BR');
  const proximity = expiryProximity(props.expiresAt);
  if (proximity === 'SAFE' || proximity === null) {
    return (
      <Typography variant="caption" color="text.secondary">
        {copy.validUntil(when)}
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
        ? copy.expiredAt(when)
        : copy.expiresAt(when)}
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
 * Anything else arrives already worded by its error code
 * (`describeFailure`), never as the server's English.
 */
const NO_PLATFORM_APP = /no platform oauth application credentials/i;

function connectFailure(
  copy: OAuthConnectionCopy,
  message: string,
  displayName: string,
): { severity: 'error' | 'warning'; text: string } {
  if (NO_PLATFORM_APP.test(message)) {
    return { severity: 'warning', text: copy.notAvailableHere(displayName) };
  }
  return { severity: 'error', text: message };
}

function ConnectError({ message, displayName }: { message: string; displayName: string }) {
  const copy = usePaymentsSettingsCopy().oauth;
  const { severity, text } = connectFailure(copy, message, displayName);
  return (
    <Alert severity={severity} data-testid="payments-connect-failure">
      {text}
    </Alert>
  );
}

function connectLabel(
  copy: OAuthConnectionCopy,
  displayName: string,
  connected: boolean,
  busy: string | null,
) {
  if (busy === 'connect') return <CircularProgress size={18} />;
  return connected ? copy.reconnectAction : copy.connectAction(displayName);
}

/**
 * pt-BR labels for the scopes a store owner actually sees. Unknown scopes fall
 * back to the provider's own spelling — wrong words are worse than raw ones.
 */
function scopeLabels(copy: OAuthConnectionCopy): Record<string, string> {
  return {
    'payments.read': copy.scopes.read,
    'payments.create': copy.scopes.create,
    'payments.refund': copy.scopes.refund,
    'accounts.read': copy.scopes.account,
  };
}

/**
 * WHAT the connected grant may do (FUT-300): its granted scopes, in the
 * owner's words.
 *
 * The account and the connect date used to be repeated here, as sentences
 * under the facts grid that already states both (`ConnectionFacts`). One place
 * per thing: the grid answers "which account, since when"; this answers only
 * what the grid cannot.
 */
function GrantedScopes(props: { account: ConnectedOAuthAccount }) {
  const copy = usePaymentsSettingsCopy().oauth;
  const { grantedScopes } = props.account;
  if (grantedScopes.length === 0) return null;
  return (
    <Stack
      direction="row"
      spacing={0.5}
      useFlexGap
      flexWrap="wrap"
      data-testid="payments-connected-account"
    >
      {grantedScopes.map((scope) => (
        <Chip key={scope} size="small" variant="outlined" label={scopeLabels(copy)[scope] ?? scope} />
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
  const copy = usePaymentsSettingsCopy().oauth;
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
          ? copy.connectedExplainer
          : copy.invitation(props.displayName)}
      </Typography>
      {props.connected ? null : <ConnectSteps displayName={props.displayName} />}
      {props.connected && props.connectedAccount ? (
        <GrantedScopes account={props.connectedAccount} />
      ) : null}
      {props.status === 'RECONNECT_REQUIRED' ? (
        <Alert severity="warning">
          {copy.revoked}
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
  const copy = usePaymentsSettingsCopy().oauth;
  const { displayName, connected, busy, onConnect, onDisconnect } = props;
  return (
    // The bar runs full-bleed for its rule, but its text starts at the card's
    // inset like every block above it — BAR_SX's own 18px is tuned for a bar
    // nested inside a step panel, which this one is not.
    <Box sx={{ ...BAR_SX, px: CARD_INSET }} data-testid="payments-connection-bar">
      <Typography sx={BAR_MSG_SX}>
        {connected
          ? copy.connectedNote(displayName)
          : copy.roundTripNote}
      </Typography>
      {connected ? (
        <Button
          disabled={busy !== null}
          onClick={onDisconnect}
          sx={BTN_QUIET_DANGER_SX}
          data-testid="payments-disconnect"
        >
          {busy === 'disconnect' ? <CircularProgress size={18} /> : copy.removeAction}
        </Button>
      ) : null}
      <Button
        variant="contained"
        disableElevation
        disabled={busy !== null}
        onClick={onConnect}
        sx={BTN_PRIMARY_SX}
      >
        {connectLabel(copy, displayName, connected, busy)}
      </Button>
    </Box>
  );
}

/** One in-flight action at a time, with its failure surfaced to the owner. */
function useConnectionAction(onChanged: () => void) {
  const failures = usePaymentsFailureCopy();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (kind: string, action: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      // The missing-platform-app refusal keeps its raw message: `connectFailure`
      // recognises it there and names the way round. Everything else reads as
      // its code's sentence.
      const raw = err instanceof Error ? err.message : '';
      setError(NO_PLATFORM_APP.test(raw) ? raw : describeFailure(err, failures));
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
  const stored = readConnection(config);
  const { status, connected, expiresAt, account, receiving } = stored;
  const { environment, selectable, setChosen } = useConnectEnvironment(
    descriptor,
    stored.environment,
    connected,
  );

  /** Run a dialog action and shut the dialog once it has actually landed. */
  const close = (kind: string, action: () => Promise<unknown>) =>
    void run(kind, async () => {
      await action();
      setConfirmingDisconnect(false);
    });

  const connect = () =>
    void run('connect', async () => {
      // The host seals this environment into the state cookie and the callback
      // trusts only that sealed value, so the grant lands where it was asked.
      const ctx = await prepareConnect(descriptor.name, environment);
      const { url } = await client.beginOAuth(descriptor.name, { environment, ...ctx });
      // Full-page navigation: the provider's consent screen must be a
      // top-level document, never an iframe.
      window.location.assign(url);
    });

  return (
    <Stack spacing={2}>
      {/* Every block but the full-bleed bar shares the card's inset, so the
          facts, the sentences and the scopes start where the provider's name
          does instead of against the card's border. */}
      <Stack spacing={2} sx={{ px: CARD_INSET }} data-testid="payments-connection-body">
        <ConnectionSummary
          displayName={descriptor.displayName}
          status={status}
          connected={connected}
          expiresAt={expiresAt}
          environment={environment}
          connectedAccount={account}
        />

        {selectable ? (
          <EnvironmentSelector environment={environment} onChange={setChosen} />
        ) : null}

        {error ? <ConnectError message={error} displayName={descriptor.displayName} /> : null}
      </Stack>

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
