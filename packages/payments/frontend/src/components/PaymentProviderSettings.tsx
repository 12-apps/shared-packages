'use client';

import { Alert, Box, Button, CircularProgress } from '@mui/material';
import { useCallback, type ReactNode } from 'react';

import type { MaskedProviderConfig, ProviderSetupGuide } from '@12-apps/payments-backend';

import type { PaymentsSettingsClient } from '../client';
import { canAttemptCharge } from './connection-state';
import { ProviderList } from './ProviderList';
import { ActivePanel, type ActivePanelProps, type PrepareConnect } from './ProviderPanel';
import {
  guideAwaitsConfirmation,
  progressKeyOf,
  useCanonicalProviderSegment,
  useOpenProvider,
  useSelectedProvider,
  useSettingsState,
  useSetupConfirmation,
  useSetupGuide,
  type ProviderChangeHandler,
} from './settings-state';
import { openSection, SetupGuideSection } from './SetupGuideSection';

/**
 * Plug-and-play settings page for payment providers — the reusable
 * equivalent of the app's per-provider config screen:
 *
 *   - the FAILOVER CHAIN: the enabled providers in the order checkout will
 *     try them, reorderable by drag or by keyboard
 *   - provider selector (every adapter registered in the backend)
 *   - per provider, EITHER a connect button (`authMode: 'oauth'`) or a
 *     schema-driven credential form — and for OAuth providers, both
 *   - SANDBOX/PRODUCTION environment switch (both credential sets kept)
 *   - save / verify ("test connection") / enable (join or leave the chain)
 *   - the provider's own onboarding walkthrough
 *
 * The host provides only the authenticated `client` and (optionally) the
 * connect-state minting for OAuth providers.
 */
export interface PaymentProviderSettingsProps {
  client: PaymentsSettingsClient;
  /** Called after any state-changing action, e.g. to refresh host UI. */
  onChanged?: (config: MaskedProviderConfig) => void;
  /**
   * Required to render `authMode: 'oauth'` providers: the host mints and
   * persists the CSRF state against the admin session and returns it with
   * the callback URL. Omit it and OAuth providers fall back to their
   * credential form instead of showing a connect button that cannot work.
   */
  prepareConnect?: PrepareConnect;
  /**
   * Provider to open on mount instead of the list.
   *
   * The OAuth callback comes back to this page having just connected one — and
   * landing on the provider LIST at that moment hides the very thing that
   * changed, along with the switch that still has to be flipped. The host knows
   * which provider it was (its own callback said so); the package does not read
   * the URL.
   */
  initialProvider?: string | null;
  /**
   * Which provider is open, when the HOST owns that state (e.g. it lives in
   * the URL, so each provider is its own linkable page).
   *
   * Passing it — `null` included — switches this component to controlled mode:
   * it stops keeping its own selection and `initialProvider` no longer applies,
   * because the host's value is now the single source of truth. Leave it
   * `undefined` and nothing changes: selection stays internal, as every
   * existing caller expects.
   *
   * The value may be the provider's NAME or its `urlSlug` — a host that keeps
   * the selection in a path segment passes the segment verbatim, and the raw
   * name stays a working alias so old links do not 404. Which spelling each
   * provider uses is the adapter's own declaration, carried in the catalog;
   * the host holds no map.
   */
  selectedProvider?: string | null;
  /**
   * Fired when the owner picks a provider (or leaves one, with `null`).
   *
   * Independent of `selectedProvider`: an uncontrolled host can use this purely
   * to observe, while a controlled host uses it to write the new selection
   * wherever it keeps it.
   *
   * Reports the provider's `urlSlug` — its name, unless the adapter re-spells
   * it — so a controlled host writes the value straight into its URL. It is
   * also how a segment gets CORRECTED: handed an alias (the OAuth callback's
   * `?connected=` carries the raw name), this fires once with the canonical
   * slug and `{ replace: true }`, asking the host to rewrite — not extend —
   * its history ({@link ProviderChangeHandler}).
   */
  onProviderChange?: ProviderChangeHandler;
  /**
   * The activation step, rendered under the connection card.
   *
   * "Connected" and "can charge" are different facts, and only the HOST can
   * prove the second one: it owns the endpoint that puts a real R$0,01 through
   * the store's own account and enables the provider when it lands (FUT-463).
   * The package decides only WHERE that step appears, never how it works — the
   * same split as `prepareConnect`.
   *
   * `onVerified` refreshes this screen, so a passing charge immediately shows
   * the provider as active.
   */
  renderVerification?: (context: {
    provider: string;
    /**
     * The provider's human name ("InfinitePay").
     *
     * The activation step tells the owner who refused what, and "o provedor
     * recusou criar a cobrança" is the same sentence with the one word that
     * makes it actionable removed — an owner reading it on a screen that lists
     * three providers has to work out which one is being talked about.
     */
    displayName: string;
    /** A stored connection exists — there is something to charge through. */
    connected: boolean;
    /**
     * A real charge through this connection has already succeeded
     * (`chargeVerifiedAt` is stamped). The step renders a confirmation instead
     * of demanding another payment: an owner who has ALREADY paid the R$0,01
     * and reloads must be told it worked, not shown the pay button again — the
     * button that being shown again is what made one owner pay four times.
     */
    proven: boolean;
    /**
     * An earlier step is still outstanding, so a NEW charge must not be
     * offered yet — the owner has not confirmed the provider-side switch
     * without which no link can be minted at all.
     *
     * It withholds the pay BUTTON and nothing else. The step itself must go on
     * rendering whatever its state: it is what resumes an outstanding charge on
     * mount and what reads the `transaction_nsu` a returning payer arrives
     * with, so not rendering it is how a payment that HAS been made stops being
     * confirmable. A blocked screen may cost a click; an unmounted one costs
     * the money.
     */
    blocked: boolean;
    /**
     * The walkthrough has an EARLIER step open, so this one is not the current
     * step. It must still render whatever it has already settled.
     *
     * The same lesson as `blocked`, one turn further. Unmounting was how the
     * one sentence explaining why step 2 had just reopened disappeared in the
     * same frame that reopened it: the provider refuses to mint a link, the
     * step-2 confirmation is withdrawn on that evidence, the guide goes back a
     * step — and the panel carrying "the provider refused, here is why" is
     * taken off screen by its own report. The owner is returned to a step they
     * believed they had done, with nothing saying so.
     */
    hidden: boolean;
    onVerified: () => void;
    /**
     * The provider refused to create the charge — the strongest evidence
     * available that the step the owner ticked off is not in fact done. Undoes
     * the confirmation and puts them back on it.
     */
    onSetupIncomplete: () => void;
  }) => ReactNode;
}

/** Everything the activation step needs that only this screen knows. */
interface VerificationInputs {
  render: PaymentProviderSettingsProps['renderVerification'];
  provider: string;
  displayName: string;
  config: MaskedProviderConfig | null;
  /** An earlier step is unfinished: withhold the pay button, render the rest. */
  blocked: boolean;
  /** The walkthrough is on an earlier step; this one is not on screen at all. */
  hidden: boolean;
  onVerified: () => void;
  onSetupIncomplete: () => void;
}

/** The activation step's context, built from what this screen already knows. */
function verificationFor(io: VerificationInputs): ReactNode {
  // `enabled` is deliberately NOT passed: the step used it to show a standing
  // "provider is active" banner, which kept reassuring a store whose every
  // charge was being refused. `proven` is a different kind of fact — it is
  // stamped only by a real charge landing, which is exactly what this step
  // exists to observe.
  return io.render?.({
    provider: io.provider,
    displayName: io.displayName,
    connected: canAttemptCharge(io.config),
    proven: Boolean(io.config?.chargeVerifiedAt),
    blocked: io.blocked,
    // Never `hidden` once the charge has landed: then this step IS the
    // confirmation, and the guide has nothing left to show anyway.
    hidden: io.hidden && !io.config?.chargeVerifiedAt,
    onVerified: io.onVerified,
    onSetupIncomplete: io.onSetupIncomplete,
  });
}

/**
 * The walkthrough for the connection path the panel currently has open.
 *
 * A provider that accepts both a grant and pasted keys ships one guide with a
 * `credentialsPath` variant; everything else ships one guide, and both paths
 * get it. Only the SECTIONS are swapped — the variant mirrors the base's stage
 * count and confirmable index, which is what lets `blocked`/`hidden` above stay
 * computed from the base guide alone.
 */
function guideForPath(
  guide: ProviderSetupGuide | null,
  path: 'oauth' | 'credentials',
): ProviderSetupGuide | null {
  if (!guide || path === 'oauth') return guide;
  return guide.credentialsPath ? { ...guide.credentialsPath } : guide;
}

interface ProviderScreenProps extends ActivePanelProps {
  onBack: () => void;
}

/** One provider's configuration, with the way back to the list. */
function ProviderScreen({ onBack, ...panel }: ProviderScreenProps) {
  return (
    <Box data-testid="payments-provider-settings">
      <Button
        size="small"
        onClick={onBack}
        data-testid="payments-provider-back"
        sx={{ mb: 2, textTransform: 'none' }}
      >
        ← Voltar aos provedores
      </Button>
      <ActivePanel {...panel} />
    </Box>
  );
}

export function PaymentProviderSettings({
  client,
  onChanged,
  prepareConnect,
  initialProvider = null,
  selectedProvider,
  onProviderChange,
  renderVerification,
}: PaymentProviderSettingsProps) {
  const { view, error, reload } = useSettingsState(client);
  const { selected, setSelected } = useSelectedProvider(
    initialProvider,
    selectedProvider,
    onProviderChange,
  );
  // What leaves this component (and what it stores) is the adapter's URL
  // spelling, so a controlled host writes it into its path segment verbatim —
  // `useOpenProvider` resolves names and slugs alike, so either survives.
  const openProvider = useCallback(
    (name: string | null) =>
      setSelected(name ? (view?.providers.find((p) => p.name === name)?.urlSlug ?? name) : null),
    [view, setSelected],
  );
  // Resolved above the early returns, because the guide hook depends on both.
  const { active, activeConfig } = useOpenProvider(view, selected);
  // A controlled segment that resolved through the alias gets respelled to the
  // adapter's canonical slug — the address bar is part of the contract.
  useCanonicalProviderSegment(selectedProvider, active, onProviderChange);
  const { guide, loaded } = useSetupGuide(client, active?.name ?? null, progressKeyOf(activeConfig));
  const ack = useSetupConfirmation(client, active, activeConfig);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!view) return <CircularProgress data-testid="payments-settings-loading" />;

  if (!active) {
    return <ProviderList view={view} client={client} reload={reload} onSelect={openProvider} />;
  }

  return (
    <ProviderScreen
      descriptor={active}
      config={activeConfig}
      client={client}
      onChanged={onChanged}
      reload={() => void reload()}
      prepareConnect={prepareConnect}
      onBack={() => openProvider(null)}
      // A new credential may name a DIFFERENT InfinitePay account, and the
      // owner's "Checkout Integrado is on" was said about the old one. The
      // server already drops its own verdict and its proof on any credential
      // change; this drops the half it cannot see.
      onCredentialsReplaced={ack.withdraw}
      verification={verificationFor({
        render: renderVerification,
        provider: active.name,
        displayName: active.displayName,
        config: activeConfig,
        blocked: guideAwaitsConfirmation(guide, ack.confirmed, loaded),
        // The walkthrough still has a step to show ⇒ this is not that step.
        hidden: !loaded || openSection(guide, ack.confirmed, false) !== null,
        onVerified: () => void reload(),
        onSetupIncomplete: ack.withdraw,
      })}
      guide={({ path, ...slots }) => (
        <SetupGuideSection
          // Which walkthrough, per the path the panel has open. Only the
          // SECTIONS differ; `blocked`/`hidden` above stay computed from the
          // base guide, which `credentialsPath` is required to mirror.
          guide={guideForPath(guide, path)}
          confirmed={ack.confirmed}
          onConfirm={ack.confirm}
          onReopen={ack.withdraw}
          {...slots}
        />
      )}
    />
  );
}
