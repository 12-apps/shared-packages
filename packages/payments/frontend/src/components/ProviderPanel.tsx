'use client';

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useCallback, useState, type ReactNode } from 'react';

import type {
  MaskedProviderConfig,
  PaymentEnvironment,
  ProviderDescriptor,
} from '@12-apps/payments-backend';

import type { PaymentsSettingsClient } from '../client';
import { ConnectionProbe } from './ConnectionProbe';
import { EnvironmentNotice, EnvironmentSelector } from './EnvironmentTabs';
import { ProviderConnection } from './ProviderConnection';
import { ProviderForm } from './ProviderCredentialForm';
import { ProviderStatusBar } from './ProviderStatusBar';

/**
 * One provider's configuration panel: the Ativo bar, the connect card or the
 * credential form (per the provider's authMode), the host's activation step,
 * and the manual-credentials fallback.
 *
 * Split out of `PaymentProviderSettings` so that file stays about WHICH
 * provider is open; this one is about what an open provider looks like.
 */

/**
 * Host endpoint that mints and persists the CSRF state against the admin
 * session and returns it with the callback URL to come back to.
 */
export type PrepareConnect = (
  provider: string,
  environment: PaymentEnvironment,
) => Promise<{ state: string; redirectUri: string; environment?: PaymentEnvironment }>;

export interface ActivePanelProps {
  descriptor: ProviderDescriptor;
  config: MaskedProviderConfig | null;
  client: PaymentsSettingsClient;
  onChanged?: (config: MaskedProviderConfig) => void;
  reload: () => void;
  prepareConnect?: PrepareConnect;
  /**
   * The provider's walkthrough, as a function of the form's own pieces.
   *
   * It LEADS on the credentials path — the stepper and the step still owed both
   * answer "where am I", which is a question you ask before typing — and it
   * physically contains the field for that step, because "informe sua
   * InfiniteTag" and the box you type it into are one thing.
   *
   * On the OAUTH path with a working connect button the walkthrough renders
   * OUTSIDE the manual disclosure (slots empty — the credential FORM stays
   * inside it). It used to be stuffed in there whole, which buried the
   * provider's own setup guide behind "prefiro informar as credenciais
   * manualmente" — a label the connect card above explicitly says there is no
   * reason to open (FUT-691). Deliberately shared behavior: every OAuth
   * provider's screen changes shape, PagBank's included.
   */
  guide?: (slots: {
    rows: ReactNode;
    sectionFooter: ReactNode;
    editing: boolean;
    /** The environment on screen holds its credentials — see `renderGuide`. */
    stored: boolean;
  }) => ReactNode;
  /** The host's activation step (see `renderVerification`), already resolved. */
  verification?: ReactNode;
  /** The stored credentials were replaced — see `ProviderForm`. */
  onCredentialsReplaced?: () => void;
}

/**
 * Credential form or OAuth connection card, per the provider's authMode.
 *
 * An OAuth provider gets BOTH: the connect button as the happy path, plus the
 * credential form tucked behind a disclosure. That fallback is not decoration
 * — stores connected before Connect existed still hold a pasted token, and a
 * deployment with no registered provider application has no working connect
 * button at all. Hiding the form outright would strand both.
 */
/**
 * The status chip + "Ativo" switch, owning its own in-flight state.
 *
 * Rendered above BOTH branches of {@link ActivePanel}, never inside the
 * manual-credentials disclosure: this is the control that decides whether
 * checkout can charge, and an OAuth-connected store — told on the card above
 * that no key needs copying — has no reason to open that disclosure at all.
 */
function EnableBar({ descriptor, config, client, onChanged, reload }: ActivePanelProps) {
  const [toggling, setToggling] = useState(false);
  const toggle = useCallback(
    async (enabled: boolean) => {
      setToggling(true);
      try {
        const next = await client.setEnabled(descriptor.name, enabled);
        onChanged?.(next);
        reload();
      } finally {
        setToggling(false);
      }
    },
    [client, descriptor.name, onChanged, reload],
  );

  return (
    <ProviderStatusBar
      descriptor={descriptor}
      config={config}
      busy={toggling}
      onToggle={(enabled) => void toggle(enabled)}
    />
  );
}

/**
 * One provider, one card — in three bands.
 *
 * The screen used to be a column of loose blocks on the page background, and
 * with the environment tabs halfway down it it was genuinely ambiguous what
 * they governed: the fields under them, or everything. Bounding the provider
 * makes the answer structural — inside this card, one provider, one
 * environment.
 *
 * The three bands exist for the middle one. The environment banner has to run
 * EDGE TO EDGE, because a strip that spans the card reads as a property of
 * everything below it while the same words inset by the card's padding read as
 * one more paragraph of content. That is not achievable inside a single padded
 * container, so the header and the body carry the padding and the band between
 * them carries none.
 */
function ProviderCard({
  header,
  band,
  children,
}: {
  header: ReactNode;
  band?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Paper variant="outlined">
      <Box sx={{ px: 3, pt: 3 }}>{header}</Box>
      {band}
      <Box sx={{ p: 3 }}>
        <Stack spacing={2}>{children}</Stack>
      </Box>
    </Paper>
  );
}

/** Every REQUIRED credential is on record for this environment specifically. */
function requiredStored(
  descriptor: ProviderDescriptor,
  config: MaskedProviderConfig | null,
  environment: PaymentEnvironment,
): boolean {
  const stored = config?.environments[environment] ?? {};
  return descriptor.credentialSchema
    .filter((spec) => spec.required)
    .every((spec) => stored[spec.key]?.configured === true);
}

/**
 * Does this provider get the connect-button branch of {@link OAuthPanel}?
 * With a working connect button the walkthrough leaves the form; without one
 * the form IS the path and keeps the guide interleaved.
 */
function oauthWithConnect(props: ActivePanelProps): boolean {
  return props.descriptor.authMode === 'oauth' && Boolean(props.prepareConnect);
}

/**
 * The walkthrough as the OAUTH connect branch renders it: standalone, slots
 * empty (null on every other branch, where the form carries the guide).
 *
 * The credential form stays inside the manual disclosure, so the guide gets no
 * rows and no live field — and `stored` answers for the ACTIVE environment,
 * which is the one the connect card and the server-computed stage describe
 * (the tabs inside the disclosure govern the form, not this).
 */
function oauthWalkthrough(props: ActivePanelProps): ReactNode {
  const { descriptor, config, guide } = props;
  if (!guide || !oauthWithConnect(props)) return null;
  return guide({
    rows: null,
    sectionFooter: null,
    editing: false,
    stored: requiredStored(descriptor, config, config?.environment ?? 'SANDBOX'),
  });
}

export function ActivePanel(props: ActivePanelProps) {
  const { descriptor, config, client, onChanged, reload, guide, verification } = props;
  const statusBar = <EnableBar {...props} />;
  // The environment frames everything below it, so the PANEL owns the choice
  // and puts the tabs at the top — not the form, halfway down its own column.
  const [environment, setEnvironment] = useState<PaymentEnvironment>(
    config?.environment ?? 'SANDBOX',
  );
  // Lifted out of the form because it decides more than the form: reopening
  // step 1 must also take step 3 off the screen. A card offering to charge
  // R$ 1,01 under a heading about typing your InfiniteTag is two steps at once,
  // and the one that costs money is the one you did not ask for.
  const [editing, setEditing] = useState(false);

  // On the connect branch the walkthrough leaves the form (see the `guide`
  // prop): the form then stands alone inside the manual disclosure.
  const oauthConnect = oauthWithConnect(props);

  const credentials = (
    <ProviderForm
      descriptor={descriptor}
      config={config}
      client={client}
      environment={environment}
      editing={editing}
      onEditingChange={setEditing}
      onChanged={onChanged}
      onSaved={reload}
      onCredentialsReplaced={props.onCredentialsReplaced}
      renderGuide={oauthConnect ? undefined : guide}
    />
  );

  const selector = <EnvironmentSelector environment={environment} onChange={setEnvironment} />;
  const band = <EnvironmentNotice environment={environment} active={config?.environment ?? null} />;

  // The activation step charges through the credentials of the environment it
  // is under. Shown on a tab that stores none, it offers to charge an account
  // that is not there — on the screen whose entire subject is which account
  // receives the store's money. `config.environment` is the ACTIVE one, so it
  // cannot answer this; the fields on screen can.
  const storedHere = requiredStored(descriptor, config, environment);

  if (descriptor.authMode !== 'oauth') {
    return (
      <ProviderCard
        header={
          <Stack spacing={2}>
            {statusBar}
            {selector}
          </Stack>
        }
        band={band}
      >
        {credentials}
        {editing || !storedHere ? null : verification}
      </ProviderCard>
    );
  }

  return (
    <OAuthPanel
      {...props}
      statusBar={statusBar}
      walkthrough={oauthWalkthrough(props)}
      form={
        <Stack spacing={2}>
          {selector}
          {band}
          {credentials}
        </Stack>
      }
    />
  );
}

/**
 * The OAuth path: a connect button as the happy path, with the credential form
 * kept behind a disclosure.
 *
 * That fallback is not decoration — stores connected before Connect existed
 * still hold a pasted token, and a deployment with no registered provider
 * application has no working connect button at all. Hiding the form outright
 * would strand both.
 */
function OAuthPanel({
  descriptor,
  config,
  client,
  reload,
  prepareConnect,
  verification,
  statusBar,
  walkthrough,
  form,
}: ActivePanelProps & { statusBar: ReactNode; walkthrough: ReactNode; form: ReactNode }) {
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
      <ProviderConnection
        descriptor={descriptor}
        config={config}
        client={client}
        prepareConnect={prepareConnect}
        onChanged={reload}
      />
      {/*
        Directly under the connect card, ABOVE the manual disclosure: this is
        the step that actually turns the store on, and an owner who just
        authorized has no reason to open "prefiro informar as credenciais
        manualmente" to find it.
      */}
      {verification}
      {/*
        The provider's walkthrough, OUTSIDE the disclosure for the same reason
        as the activation step above it: it used to live inside the credential
        form, which on this branch is folded into the manual fallback — so the
        guide (and the stepper answering "where am I") was buried behind a
        label the connect card says there is no reason to open (FUT-691).
      */}
      {walkthrough}
      {probe}
      {descriptor.credentialSchema.length > 0 ? (
        <Accordion disableGutters data-testid="payments-manual-fallback">
          <AccordionSummary expandIcon={<span aria-hidden>▾</span>}>
            <Typography variant="body2" color="text.secondary">
              Prefiro informar as credenciais manualmente
            </Typography>
          </AccordionSummary>
          <AccordionDetails>{form}</AccordionDetails>
        </Accordion>
      ) : null}
    </ProviderCard>
  );
}
