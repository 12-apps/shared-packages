'use client';

import { Alert, Box, Button } from '@mui/material';
import { useState, type ReactNode } from 'react';

import { ConnectionProbe } from './ConnectionProbe';
import { LINKISH_SX } from './panel-tokens';
import { ProviderConnection } from './ProviderConnection';
import type { ActivePanelProps } from './ProviderPanel';
import { ProviderCard } from './ProviderPanel';
import { usePaymentsSettingsCopy } from './settings-copy-context';

/**
 * The OAuth branch of a provider's screen, and the switch between its two
 * connection paths.
 *
 * Split from `ProviderPanel` — which decides WHICH branch a provider gets —
 * because this one is about what the connect branch looks like once chosen, and
 * because the two together no longer fit the size gate.
 */
/**
 * The collapsed row that moves the owner between the two connection paths.
 *
 * Both directions get one, and they are the same control: the row on screen
 * always names the path you are NOT on. Only the manual leg carries content —
 * the OAuth leg's "content" is the connect card, which belongs above the
 * walkthrough rather than nested inside a disclosure — so `children` is
 * optional and an empty one renders as a bare, clickable row.
 */
function PathSwitch({
  label,
  expanded,
  onChange,
  testId,
  children,
}: {
  label: string;
  expanded: boolean;
  onChange: (expanded: boolean) => void;
  testId: string;
  children?: ReactNode;
}) {
  // Open, this is not a disclosure any more — it IS the path, and dressing a
  // whole block (its own stepper, environment switch, fields and action bar) in
  // a collapsible chrome adds a frame around a frame. So the content renders
  // bare and only the CLOSED state is a control: one quiet line offering the
  // other way in, which is all a path the owner is not on needs to be.
  if (expanded) {
    return (
      <Box data-testid={testId} data-open="true">
        {children}
      </Box>
    );
  }
  return (
    <Box data-testid={testId} sx={{ px: '20px', pb: '20px' }}>
      <Button onClick={() => onChange(true)} sx={{ ...LINKISH_SX, fontSize: '12.5px' }}>
        {label}
      </Button>
    </Box>
  );
}

/**
 * The OAuth path: a connect button as the happy path, with the credential form
 * kept behind a disclosure.
 *
 * ## One path on screen at a time
 *
 * Opening the manual disclosure is the owner SAYING which path they are on.
 * While the connect card stayed above the open form the screen showed both at
 * once — a card explaining that no key needs copying, directly over four boxes
 * asking for keys, with the grant's own controls in between belonging to
 * neither. Every control on that card acts on the OAuth grant; a store
 * connecting by hand has no grant for them to act on.
 *
 * ## Order inside the card
 *
 * The activation step sits directly under the connect card and ABOVE the
 * disclosure: it is what actually turns the store on, and an owner who just
 * authorized has no reason to open a fallback to find it.
 *
 * The walkthrough renders OUTSIDE the disclosure for the same reason — it used
 * to live inside the credential form, which on this branch is folded into the
 * fallback, so the guide and the stepper answering "where am I" were buried
 * behind a label the connect card says there is no reason to open (FUT-691).
 * Its step LIST depends on the path: under authorization step 1 says to press
 * the connect button above, and with pasted keys that button is not rendered.
 * An adapter shipping a `credentialsPath` variant gets its own steps; one that
 * does not keeps the single guide on both paths, unchanged.
 *
 * That fallback is not decoration — stores connected before Connect existed
 * still hold a pasted token, and a deployment with no registered provider
 * application has no working connect button at all. Hiding the form outright
 * would strand both.
 */
export function OAuthPanel({
  descriptor,
  config,
  client,
  reload,
  prepareConnect,
  verification,
  statusBar,
  walkthrough,
  form,
}: ActivePanelProps & {
  statusBar: ReactNode;
  walkthrough: (path: 'oauth' | 'credentials') => ReactNode;
  form: ReactNode;
}) {
  const copy = usePaymentsSettingsCopy().oauth;
  // Which path the owner is on. The disclosure is no longer just a container —
  // opening it CHOOSES the credentials path, so the panel has to know.
  const [manual, setManual] = useState(false);
  // The connection probe, for a store whose connection is a grant: the form's
  // own probe runs off Salvar, which an OAuth store never presses (FUT-691).
  const probe = (
    <ConnectionProbe descriptor={descriptor} config={config} client={client} reload={reload} />
  );
  if (!prepareConnect) {
    return (
      <ProviderCard header={statusBar}>
        <Alert severity="info">
          Este provedor conecta por autorização, mas o botão de conexão não está disponível nesta
          instalação. Você ainda pode conectar informando as credenciais manualmente.
        </Alert>
        {form}
        {probe}
        {verification}
      </ProviderCard>
    );
  }

  return (
    <ProviderCard header={statusBar}>
      {manual ? (
        <PathSwitch
          label={copy.preferOAuth}
          expanded={false}
          onChange={() => setManual(false)}
          testId="payments-oauth-fallback"
        />
      ) : (
        <ProviderConnection
          descriptor={descriptor}
          config={config}
          client={client}
          prepareConnect={prepareConnect}
          onChanged={reload}
        />
      )}
      {verification}
      {manual ? null : walkthrough('oauth')}
      {probe}
      {descriptor.credentialSchema.length > 0 ? (
        <PathSwitch
          label={copy.preferCredentials}
          expanded={manual}
          onChange={setManual}
          testId="payments-manual-fallback"
        >
          {form}
        </PathSwitch>
      ) : null}
    </ProviderCard>
  );
}
