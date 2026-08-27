'use client';

import { Button, Stack, Typography } from '@mui/material';
import { useCallback, type JSX } from 'react';

import { BTN_PRIMARY_SX, T } from '../../components/panel-tokens';
import { useRedirectActivation } from '../use-redirect-activation';
import type { RedirectActivationState } from '../redirect-state';

import { AwaitingPayment } from './awaiting-payment';
import { useActivationCopy } from './copy-context';
import { Notice, StepPanel } from './notice';
import { useVerificationAmount } from './use-verification-amount';
import { ExpiredState, FailedState, SetupIncompleteState, UnreachableState } from './states';

/**
 * Step 3 for a provider whose buyer pays on ITS page.
 *
 * Same proof as the card form, different protocol: a REAL link through this
 * store's own connection, paid by the owner on the provider's site, then
 * confirmed by asking the provider. Telling an owner to "make a real low-value
 * order and check" instead was the dead-end instruction this screen exists to
 * abolish — if the check can be run for them, it must be.
 *
 * One button, one outcome: pressing it mints the charge AND lands them on the
 * payment page (`useRedirectActivation` claims the tab inside the click, so no
 * popup blocker can eat it). Generating a charge and then asking them to find a
 * second button was the same extra step in a smaller costume.
 */

/**
 * The pay button, or the reason it is not there yet.
 *
 * `blocked` withholds the button ONLY. Everything else this panel can render —
 * an outstanding charge, a return trip being confirmed, a settled result — goes
 * on rendering regardless, because those states describe money that has already
 * moved. Hiding them behind a setup step is how a payment stops being
 * confirmable, which is a far worse failure than an early click.
 */
function StartCharge({
  amountLabel,
  blocked,
  creating,
  onStart,
}: {
  amountLabel: string;
  blocked: boolean;
  creating: boolean;
  onStart: () => void;
}): JSX.Element {
  const { outcome, actions } = useActivationCopy();
  if (blocked) {
    return (
      <Notice
        tone="info"
        title={outcome.blockedTitle}
        description={outcome.blockedBody}
        dataTestId="verify-charge-blocked"
      />
    );
  }
  return (
    <Button
      sx={{ ...BTN_PRIMARY_SX, width: '100%' }}
      disabled={creating}
      onClick={onStart}
      data-testid="verify-charge-start-redirect"
    >
      {actions.payAndActivate(amountLabel)}
    </Button>
  );
}

/**
 * What is about to happen, said BEFORE it happens.
 *
 * FUT-463 asks that whatever is taken be reversed or explained beforehand, and
 * this is the explanation: whose money moves, and where to. Both sentences are
 * the host's, because the first attempt at them was true and still misread —
 * an owner asked what it meant. Nothing is lost: the charge goes through the
 * store's OWN connection, so it lands in the account that receives its sales,
 * and there is no refund because it never left.
 */
function Intro({ amountLabel }: { amountLabel: string }): JSX.Element {
  const { intro } = useActivationCopy();
  return (
    <Stack spacing={1}>
      <Typography sx={{ fontSize: '14px', fontWeight: 650, color: T.ink }} component="h2">
        {intro.title}
      </Typography>
      <Typography sx={{ fontSize: '12.5px', color: T.ink3, lineHeight: 1.5 }}>
        {intro.realCharge(amountLabel)}
      </Typography>
      <Typography sx={{ fontSize: '12.5px', color: T.ink3, lineHeight: 1.5 }}>
        {intro.payingYourself(amountLabel)}
      </Typography>
    </Stack>
  );
}

/**
 * Everything this step can be, once it has done something.
 *
 * Six states, each with its own sentence and its own next action. Three of the
 * six are ways the link never got minted, and they are three screens rather
 * than one because they are three different instructions: fix a setting
 * (refused), wait it out (unreachable), read the provider's own words (anything
 * else). One panel served all three and could only ever give the first one's
 * advice.
 */
function Outcome({
  state,
  displayName,
  amountLabel,
  lastCheckedAt,
  onCheckNow,
  onReset,
}: {
  state: RedirectActivationState;
  displayName: string;
  amountLabel: string;
  lastCheckedAt: number;
  onCheckNow: () => Promise<void>;
  onReset: () => void;
}): JSX.Element | null {
  const { outcome } = useActivationCopy();
  if (state.kind === 'passed') {
    return (
      <Notice
        tone="ok"
        title={outcome.settledTitle}
        description={outcome.settledBody(amountLabel)}
      />
    );
  }
  if (state.kind === 'expired') {
    return <ExpiredState reason={state.reason} onRegenerate={onReset} />;
  }
  if (state.kind === 'awaiting') {
    return (
      <AwaitingPayment
        checkoutUrl={state.checkoutUrl}
        amountLabel={amountLabel}
        declined={state.declined}
        lastCheckedAt={lastCheckedAt}
        onCheckNow={onCheckNow}
      />
    );
  }
  if (state.kind !== 'failed') return null;
  if (!state.atCreation) {
    return (
      <FailedState reason={state.reason} providerMessage={state.providerMessage} onRetry={onReset} />
    );
  }
  if (state.transport) {
    return (
      <UnreachableState
        reason={state.reason}
        providerMessage={state.providerMessage}
        onRetry={onReset}
      />
    );
  }
  return (
    <SetupIncompleteState
      displayName={displayName}
      reason={state.reason}
      providerMessage={state.providerMessage}
      onDismiss={onReset}
    />
  );
}

export function RedirectVerification({
  verifyChargeUrl,
  displayName,
  blocked,
  hidden,
  storageKey,
  formatAmount,
  onVerified,
  onSetupIncomplete,
}: {
  verifyChargeUrl: string;
  /** The provider's human name, for the sentences that must say who refused. */
  displayName: string;
  blocked: boolean;
  /** The walkthrough is on an earlier step — see `renderVerification`'s `hidden`. */
  hidden: boolean;
  storageKey?: string;
  formatAmount: (cents: number) => string;
  onVerified: () => void;
  onSetupIncomplete: () => void;
}): JSX.Element | null {
  const copy = useActivationCopy();
  // Still memoized: the hook reads its callbacks through a ref inside the
  // effects, but `onCreateFailed` remains a dependency of `start`, so a fresh
  // identity every render would rebuild it on every unrelated keystroke.
  const onCreateFailed = useCallback(() => onSetupIncomplete(), [onSetupIncomplete]);
  const { state, lastCheckedAt, start, checkNow, reset } = useRedirectActivation({
    verifyChargeUrl,
    onVerified,
    onCreateFailed,
    copy: copy.redirect,
    storageKey,
  });
  // Named from the server, because it is not always a cent — see
  // `useVerificationAmount`. A button promising one figure while charging
  // another is the kind of lie this whole flow exists to remove, and an
  // unpriced charge says so rather than guessing.
  const cents = useVerificationAmount(verifyChargeUrl);
  const amountLabel = cents === null ? copy.outcome.someAmount : formatAmount(cents);

  // Off the current step and with nothing outstanding: the walkthrough is
  // showing something earlier and this panel has nothing to add.
  //
  // NOT unmounted whenever `hidden` is true. The provider refusing to mint a
  // link is exactly the evidence that withdraws the owner's step-2
  // confirmation — so the guide goes back a step in the same render that
  // produced the explanation, and unmounting took the explanation with it. The
  // owner landed back on a step they thought was finished with nothing on
  // screen saying why.
  if (hidden && (state.kind === 'idle' || state.kind === 'creating')) return null;

  return (
    <StepPanel dataTestId="verify-charge-redirect">
      {hidden ? null : <Intro amountLabel={amountLabel} />}

      <Outcome
        state={state}
        displayName={displayName}
        amountLabel={amountLabel}
        lastCheckedAt={lastCheckedAt}
        onCheckNow={checkNow}
        onReset={reset}
      />

      {state.kind === 'idle' || state.kind === 'creating' ? (
        <StartCharge
          amountLabel={amountLabel}
          blocked={blocked}
          creating={state.kind === 'creating'}
          onStart={() => void start()}
        />
      ) : null}
    </StepPanel>
  );
}
