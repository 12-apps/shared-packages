import { Box } from "@mui/material";
import type { JSX } from "react";

import {
  CardPayBar,
  NewCardForm,
  SavedCardsPicker,
  type CardTokenizationConfig,
} from "../../card";

import { useCheckoutCopy } from "./copy-context";
import { UNRESOLVED_CODE } from "./failure-codes";
import { StalledWait } from "./stalled-wait";
import type { CheckoutBasketIdentity } from "./basket";
import type { CardChainLink } from "./method-capability";
import type { BuyerInfo, CheckoutOrder, OnCheckoutResolved } from "./types";
import { useCheckoutComponents } from "./ui";
import { useCardCheckout, type CardCheckout } from "./use-card-checkout";

/**
 * Post-submit confirmation state: timeout > error > spinner.
 *
 * The elapsed wall-clock wait leads (the order stays AWAITING server-side and is
 * recoverable by webhook/reconcile/backfill, which is what its copy says), then
 * a poll that cannot reach us — a warning saying we are STILL TRYING, where
 * FUT-1144 found a danger Alert over a wait that had actually given up — then
 * the ordinary bounded spinner.
 *
 * That order inverted with the meaning of the two flags. An error used to BE the
 * ending; now the clock is, and a wait that failed its way to the clock carries
 * both. "We keep trying" over a wait nothing is scheduled for is the lie.
 */
function SubmittedState({ card }: { card: CardCheckout }): JSX.Element {
  const { LoadingState } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens.settling;
  if (card.pollTimedOut) {
    return (
      <StalledWait
        title={copy.takingLonger}
        description={copy.takingLongerHelp}
        onCheckAgain={card.pollCheckAgain}
        testId="card-poll-timeout"
        actionTestId="card-check-again"
      />
    );
  }
  if (card.pollError) {
    return (
      <StalledWait
        title={copy.connectionLost}
        description={card.pollError}
        onCheckAgain={card.pollCheckAgain}
        testId="card-poll-error"
        actionTestId="card-check-again"
      />
    );
  }
  return (
    <LoadingState
      variant="spinner"
      size="md"
      message={copy.processing}
      dataTestId="card-processing"
    />
  );
}

/**
 * What a submit came back with.
 *
 * An UNRESOLVED charge gets its own presentation (FUT-563): some provider may
 * be holding the buyer's money, so wording it as a failure — and heading it
 * "Não foi possível pagar" above a body that says "não pague de novo" — pushes
 * the buyer toward exactly the second payment it forbids.
 */
function ChargeFailure({
  message,
  unresolved,
}: {
  message: string;
  unresolved: boolean;
}): JSX.Element {
  const { Alert } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens.settling;
  if (unresolved) {
    return (
      <Alert
        variant="warning"
        title={copy.confirming}
        description={message}
        showIcon
        data-testid="card-unresolved"
      />
    );
  }
  return (
    <Alert variant="danger" title={copy.cannotPay} description={message} showIcon data-testid="card-error" />
  );
}

/**
 * What the buyer pays WITH: the saved cards they may reuse, and the form for a
 * new one.
 *
 * The picker is absent when there is nothing saved, and the form is absent
 * while a saved card is selected — so a buyer retrying a refused card (FUT-1145)
 * lands on the form, because nothing is preselected for them.
 */
function CardInstrumentFields({ card }: { card: CardCheckout }): JSX.Element {
  return (
    <>
      {card.savedCards.length > 0 ? (
        <SavedCardsPicker
          savedCards={card.savedCards}
          selection={card.selection}
          onSelect={card.setSelection}
        />
      ) : null}

      {card.usingNewCard ? (
        <NewCardForm
          card={card.card}
          fieldErrors={card.fieldErrors}
          brand={card.brand}
          saveCard={card.saveCard}
          setCard={card.setCard}
          setFieldErrors={card.setFieldErrors}
          onSaveCardChange={card.setSaveCard}
        />
      ) : null}
    </>
  );
}

/**
 * Card payment view (FUT-58). Card data is validated + formatted client-side, then
 * tokenized (mock PagBank JS SDK) so the PAN never reaches our server; only the
 * token is charged. Supports reusing a saved card and opting to save a new one for
 * future purchases. On an accepted charge it polls for the async confirmation,
 * then bubbles the terminal status up to the parent. All state + the submit
 * handler live in {@link useCardCheckout}; this component is presentational.
 *
 * Tip: the `4000 0000 0000 0002` test card always declines.
 */
export function CardView({
  order,
  buyer = {},
  providerConfig,
  providerChain,
  tenantSlug,
  onResolved,
  pollIntervalMs = 2500,
  freshInstrument = false,
  basket,
}: {
  order: CheckoutOrder;
  buyer?: BuyerInfo;
  /** The active provider's tokenization protocol + key (FUT-697). */
  providerConfig: CardTokenizationConfig;
  /**
   * Every provider the charge may WALK, in the merchant's order (FUT-563) —
   * one instrument is minted per entry so the charge survives the first
   * provider failing. Omitted ⇒ the head alone, as before.
   */
  providerChain?: CardChainLink[];
  /** Scopes the saved-card list to cards the store's provider can charge. */
  tenantSlug?: string;
  onResolved: OnCheckoutResolved;
  pollIntervalMs?: number;
  /**
   * Preselect NOTHING from the saved list (FUT-1145): the buyer is back here
   * because a card was refused, and the card this would otherwise choose for
   * them is that one.
   */
  freshInstrument?: boolean;
  /**
   * WHICH basket this checkout is for (FUT-1213) — parked with the order when
   * a 3-D Secure challenge sends the buyer to the provider's page.
   */
  basket?: CheckoutBasketIdentity;
}): JSX.Element {
  const { Text } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens.card;
  const cc = useCardCheckout(
    order,
    buyer,
    providerConfig,
    onResolved,
    pollIntervalMs,
    tenantSlug,
    providerChain,
    freshInstrument,
    { tenantSlug, basket },
  );
  // A charge NOBODY can confirm yet is not a decline (FUT-563). Some provider
  // may be holding the buyer's money, so it gets its own presentation: the
  // danger heading "Não foi possível pagar" contradicts the body's "não pague
  // de novo" and pushes the buyer toward exactly the retry it forbids.
  const unresolved = cc.errorCode === UNRESOLVED_CODE;

  if (cc.submitted) {
    return <SubmittedState card={cc} />;
  }

  return (
    <Box data-testid="card-view" sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Text variant="heading" size="md" weight="bold" as="h2">
        {copy.heading}
      </Text>

      <CardInstrumentFields card={cc} />

      {cc.error ? <ChargeFailure message={cc.error} unresolved={unresolved} /> : null}

      {/* The pay bar is GONE while a charge is unresolved, not merely disabled
          with a spinner: paying again is the one action the message forbids,
          and a live "Pagar R$ …" directly under "não pague de novo" is what
          the buyer's thumb reaches for. */}
      {unresolved ? null : (
        <CardPayBar totalLabel={order.totalLabel} submitting={cc.submitting} onPay={() => void cc.handlePay()} />
      )}
    </Box>
  );
}
