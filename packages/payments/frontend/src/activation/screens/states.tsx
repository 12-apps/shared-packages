'use client';

import { Button, Stack } from '@mui/material';
import type { JSX } from 'react';

import { BTN_PRIMARY_SX, BTN_SECONDARY_SX, LINKISH_SX } from '../../components/panel-tokens';

import { useActivationCopy } from './copy-context';
import { Notice, ProviderMessage } from './notice';

/**
 * The settled outcomes of the activation charge, shared by both flows.
 *
 * They live apart from the panels that frame them because the panel is about
 * layout and these are about what the owner is being TOLD — and every sentence
 * here has cost real money to get right more than once. Three of the six are
 * ways the link never got minted, and they are three screens rather than one
 * because they are three different instructions: fix a setting, wait it out,
 * read the provider's own words.
 */

/** Settled-and-passed: the provider is on, and the cent is on its way back. */
export function PassedState({
  amountLabel,
  refunded,
  onRetry,
}: {
  /** What was charged. `null` only while the endpoint has not priced it yet. */
  amountLabel: string | null;
  refunded: boolean;
  onRetry: () => void;
}): JSX.Element {
  const { outcome, actions } = useActivationCopy();
  const amount = amountLabel ?? outcome.someAmount;
  return (
    <Stack spacing={1} data-testid="verify-charge-passed">
      <Notice
        tone="ok"
        title={outcome.approvedTitle}
        description={refunded ? outcome.refundedBody(amount) : outcome.refundPendingBody(amount)}
      />
      <Stack direction="row">
        <Button sx={LINKISH_SX} onClick={onRetry} data-testid="verify-charge-retry">
          {actions.testAgain}
        </Button>
      </Stack>
    </Stack>
  );
}

/**
 * Settled-and-refused. The wording is the point: the owner IS connected, so
 * telling them the connection failed would send them to reauthorize something
 * that already works.
 */
export function FailedState({
  reason,
  providerMessage,
  onRetry,
}: {
  reason: string;
  providerMessage?: string;
  onRetry: () => void;
}): JSX.Element {
  const { outcome, actions } = useActivationCopy();
  return (
    <Stack spacing={1} data-testid="verify-charge-failed">
      <Notice tone="bad" title={outcome.authenticatedNotActive} description={reason} />
      {providerMessage ? (
        <ProviderMessage message={providerMessage} label={outcome.providerSaid} />
      ) : null}
      <Stack direction="row">
        <Button sx={BTN_PRIMARY_SX} onClick={onRetry} data-testid="verify-charge-retry">
          {actions.retry}
        </Button>
      </Stack>
    </Stack>
  );
}

/**
 * The provider would not CREATE the link. A different failure with a different
 * owner, and it had been wearing the wrong one's clothes.
 *
 * Nothing was charged and nothing is outstanding — the request to mint a
 * payment page was refused outright, which overwhelmingly means a provider-side
 * switch is still off. That is a setup step rather than an error, and the
 * screen it replaced ("authenticated but not active", with a retry button) sent
 * the owner to re-check credentials that were fine and then to press retry
 * against a setting that had not changed.
 *
 * `onDismiss` is not "try the same thing again": it clears the failed attempt
 * and returns the step to its starting state, which is what the owner needs
 * AFTER going to flip the setting. Safe here in a way it is not elsewhere in
 * this flow, because nothing was charged — there is no outstanding payment for
 * a second attempt to duplicate.
 */
export function SetupIncompleteState({
  displayName,
  reason,
  providerMessage,
  onDismiss,
}: {
  displayName: string;
  reason: string;
  providerMessage?: string;
  onDismiss: () => void;
}): JSX.Element {
  const { outcome, actions } = useActivationCopy();
  return (
    <Stack spacing={1} data-testid="verify-charge-setup-incomplete">
      <Notice
        tone="warn"
        title={outcome.refusedTitle(displayName)}
        description={outcome.refusedBody(displayName)}
      />
      {reason ? <Notice tone="info" title={reason} /> : null}
      {providerMessage ? (
        <ProviderMessage message={providerMessage} label={outcome.providerSaid} />
      ) : null}
      <Stack direction="row">
        <Button sx={LINKISH_SX} onClick={onDismiss} data-testid="verify-charge-retry">
          {actions.restart}
        </Button>
      </Stack>
    </Stack>
  );
}

/**
 * Already proven: the ONLY honest thing this step can render is that fact.
 *
 * It used to reset to the pay button on every reload, because the proof lives
 * on the server and the screen never asked. An owner whose charge HAD landed
 * was greeted by the pay button again — and one owner, reasonably reading that
 * as "it did not work", paid four times.
 *
 * It is also the end of the flow, so it says where to go next. A terminal
 * screen with no exit is how an owner who has just finished setting up payments
 * ends up hunting the sidebar for the two things they now actually want: the
 * order providers are tried in, and the storefront this was all for. Both sit
 * INSIDE the panel, because they are what this outcome offers.
 */
export function ProvenState({
  storeUrl,
  onProviderOrder,
}: {
  /** The storefront this connection now takes money for. */
  storeUrl: string;
  /** Back to the provider list, which is where the failover chain lives. */
  onProviderOrder: () => void;
}): JSX.Element {
  const { outcome, actions } = useActivationCopy();
  return (
    <Notice
      tone="ok"
      title={outcome.provenTitle}
      description={outcome.provenBody}
      dataTestId="verify-charge-proven"
    >
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
        <Button
          sx={BTN_SECONDARY_SX}
          onClick={onProviderOrder}
          data-testid="verify-charge-provider-order"
        >
          {actions.setProviderOrder}
        </Button>
        <Button
          sx={BTN_SECONDARY_SX}
          onClick={() => window.open(storeUrl, '_blank', 'noopener')}
          data-testid="verify-charge-open-store"
        >
          {actions.seePublishedStore}
        </Button>
      </Stack>
    </Notice>
  );
}

/**
 * We could not reach the provider while MINTING the link.
 *
 * Deliberately not {@link SetupIncompleteState}, and the difference is the whole
 * reason this exists: that screen tells the owner a provider-side switch is
 * probably off and puts them back a step to fix it. A request that never
 * arrived is no evidence of that at all — the provider refused nothing — so
 * saying it would send someone whose connection blinked to change a setting
 * that was already correct, and take a finished step away from them on the way.
 *
 * The only honest instruction is the one an outage deserves: try again.
 */
export function UnreachableState({
  reason,
  providerMessage,
  onRetry,
}: {
  reason: string;
  providerMessage?: string;
  onRetry: () => void;
}): JSX.Element {
  const { outcome, actions } = useActivationCopy();
  return (
    <Stack spacing={1} data-testid="verify-charge-unreachable">
      <Notice tone="warn" title={outcome.unreachableTitle} description={reason} />
      {providerMessage ? (
        <ProviderMessage message={providerMessage} label={outcome.providerSaid} />
      ) : null}
      <Stack direction="row">
        <Button sx={BTN_PRIMARY_SX} onClick={onRetry} data-testid="verify-charge-retry-create">
          {actions.tryAgain}
        </Button>
      </Stack>
    </Stack>
  );
}

/**
 * The link's window elapsed with nobody paying it.
 *
 * Nothing failed and nothing was charged, so the wording carries no blame and
 * the offer is the only thing that helps: another link. The sentence it
 * replaced read as a refusal, and an owner who believes a charge was refused
 * does not press a button that looks like it charges again.
 */
export function ExpiredState({
  reason,
  onRegenerate,
}: {
  reason: string;
  onRegenerate: () => void;
}): JSX.Element {
  const { outcome, actions } = useActivationCopy();
  return (
    <Stack spacing={1} data-testid="verify-charge-expired">
      <Notice tone="info" title={outcome.expiredTitle} description={reason} />
      <Stack direction="row">
        <Button sx={BTN_PRIMARY_SX} onClick={onRegenerate} data-testid="verify-charge-regenerate">
          {actions.generateNewCharge}
        </Button>
      </Stack>
    </Stack>
  );
}
