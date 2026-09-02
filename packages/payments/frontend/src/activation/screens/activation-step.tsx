'use client';

import type { ComponentType, JSX } from 'react';

import { tokenizerFor } from '../../card/tokenize';

import { CardVerification, type CardSurface } from './card-verification';
import { ActivationCopyProvider } from './copy-context';
import type { ActivationStepCopy } from './copy';
import { ProvenState } from './states';
import { RedirectVerification } from './redirect-verification';

/**
 * Step 3 of connecting a provider — "connected" and "can charge" are different
 * facts, and this is the one that proves the second (FUT-463, screens packaged
 * by FUT-764's burn-down).
 *
 * `PaymentProviderSettings` decides WHERE this step appears; what it looks like
 * and how it behaves is here. The split it replaces put the protocol in this
 * package and the whole screen in the host, which meant every adopter rewrote
 * six outcome panels, a polling display, a link fallback and a router between
 * two flows — and the origin host's copies of them carry a paragraph each about
 * a real payment that went wrong. None of that is host knowledge. The
 * SENTENCES are, and they stay a required, defaultless port.
 *
 * What the host still answers:
 *
 * - `verifyChargeUrl` — its own endpoint. The route shape is the host's.
 * - `copy` — every word, in the owner's language.
 * - `formatAmount` — how this product writes money.
 * - `CardSurface` — its design system and card words, for the card flow's
 *   fields, so the owner meets the SAME form their shoppers will.
 * - `validateTaxId` — the host's validator, already bound to its own words.
 */

/** What the settings surface hands the step, plus what only the host knows. */
export interface ActivationStepProps {
  provider: string;
  /** The provider's human name — the refusal screens have to say who refused. */
  displayName: string;
  /** A stored connection exists — there is an account to charge through. */
  connected: boolean;
  /** A real charge already landed — say so, and charge nothing. */
  proven: boolean;
  /** An earlier setup step is unconfirmed: withhold the pay button, nothing else. */
  blocked: boolean;
  /** The walkthrough is on an earlier step: show only what has already settled. */
  hidden: boolean;
  onVerified: () => void;
  /** The provider refused to mint a link — reopen the step that explains why. */
  onSetupIncomplete: () => void;
  /** Who is paying: the signed-in owner, read from the host's own session. */
  ownerEmail: string;
  /** The storefront this connection now takes money for. */
  storeUrl: string;
  /** Where the owner goes once this is done: the failover chain. */
  onProviderOrder: () => void;
}

export interface ActivationStepConfig {
  /** Where this host mints, polls and discards the activation charge. */
  verifyChargeUrl: (provider: string) => string;
  /** Every sentence the step renders. Required, and there is no default. */
  copy: ActivationStepCopy;
  /** How this product writes an amount in cents. */
  formatAmount: (cents: number) => string;
  /** The host's providers around the card fields — its design system, its words. */
  CardSurface: CardSurface;
  /** The host's tax-id validator, already bound to its own refusals. */
  validateTaxId: (value: string) => string | undefined;
  /**
   * Where the return trip's ids are parked.
   *
   * Optional, and a host that has shipped this flow before should pass the name
   * it already used. An owner can be on the provider's site paying RIGHT NOW
   * across a deploy: their ids are in `sessionStorage` under the old key, and
   * reading a different one on the way back would find nothing and offer to
   * mint a charge for a payment they had just made.
   */
  storageKey?: string;
}

/**
 * Bind the step to one host, once.
 *
 * A factory rather than a component with a dozen props, for the reason every
 * mount in this package is one: the returned component's IDENTITY has to be
 * stable, and a host composing it inline inside `renderVerification` would
 * remount the whole step — and re-fetch, and lose a half-typed card — on every
 * render of the page above it.
 */
export function createActivationStep(
  config: ActivationStepConfig,
): ComponentType<ActivationStepProps> {
  function ActivationStep(props: ActivationStepProps): JSX.Element | null {
    return (
      <ActivationCopyProvider copy={config.copy}>
        <ActivationBody {...props} config={config} />
      </ActivationCopyProvider>
    );
  }
  ActivationStep.displayName = 'ActivationStep';
  return ActivationStep;
}

/** The router between the two flows, inside the copy provider. */
function ActivationBody({
  config,
  provider,
  displayName,
  connected,
  proven,
  blocked,
  hidden,
  onVerified,
  onSetupIncomplete,
  ownerEmail,
  storeUrl,
  onProviderOrder,
}: ActivationStepProps & { config: ActivationStepConfig }): JSX.Element | null {
  // Nothing to verify until the account is connected: steps 1 and 2 come first.
  if (!connected) return null;

  if (proven) {
    return <ProvenState storeUrl={storeUrl} onProviderOrder={onProviderOrder} />;
  }

  /**
   * A card form this provider could never satisfy is worse than no form.
   *
   * A REDIRECT provider's buyer pays on ITS page, so there is no card to
   * tokenize here and no public key to do it with. Rendering the fields anyway
   * produced a dead end that blamed the store — "the card public key is not
   * available for this store, reconnect the provider" — an instruction that
   * cannot work, for a key that was never going to exist.
   *
   * It still gets a REAL charge, just minted as a link instead.
   */
  if (!tokenizerFor(provider)) {
    return (
      <RedirectVerification
        verifyChargeUrl={config.verifyChargeUrl(provider)}
        displayName={displayName}
        blocked={blocked}
        hidden={hidden}
        storageKey={config.storageKey}
        formatAmount={config.formatAmount}
        onVerified={onVerified}
        onSetupIncomplete={onSetupIncomplete}
      />
    );
  }

  // The card flow settles synchronously, so it has nothing outstanding to
  // report from an earlier step — hiding it is still correct there.
  if (hidden) return null;
  return (
    <CardVerification
      verifyChargeUrl={config.verifyChargeUrl(provider)}
      provider={provider}
      displayName={displayName}
      ownerEmail={ownerEmail}
      onVerified={onVerified}
      CardSurface={config.CardSurface}
      validateTaxId={config.validateTaxId}
      formatAmount={config.formatAmount}
    />
  );
}
