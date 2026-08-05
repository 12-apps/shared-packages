import { Box } from "@mui/material";
import type { JSX } from "react";

import {
  CardPayBar,
  NewCardForm,
  SavedCardsPicker,
  type CardTokenizationConfig,
} from "../../card";

import { UNRESOLVED_CODE } from "./failure-codes";
import type { CardChainLink } from "./method-capability";
import type { BuyerInfo, CheckoutOrder, OrderStatus } from "./types";
import { useCheckoutComponents } from "./ui";
import { useCardCheckout } from "./use-card-checkout";

/**
 * Post-submit confirmation state, error > timeout > spinner (FUT-191): a poll
 * failure is a danger Alert, the healthy-poll cap elapsing is a warning (the
 * order stays AWAITING server-side and is recoverable by webhook/reconcile/
 * backfill), and otherwise the — now bounded — confirmation spinner shows.
 */
function SubmittedState({
  pollError,
  pollTimedOut,
}: {
  pollError: string | null;
  pollTimedOut: boolean;
}): JSX.Element {
  const { Alert, LoadingState } = useCheckoutComponents();
  if (pollError) {
    return (
      <Alert
        variant="danger"
        title="Não foi possível confirmar o pagamento"
        description={pollError}
        showIcon
        data-testid="card-poll-error"
      />
    );
  }
  if (pollTimedOut) {
    return (
      <Alert
        variant="warning"
        title="O pagamento está demorando mais que o esperado"
        description="Você pode aguardar ou verificar seu pedido em instantes — não realize um novo pagamento."
        showIcon
        data-testid="card-poll-timeout"
      />
    );
  }
  return (
    <LoadingState
      variant="spinner"
      size="md"
      message="Processando pagamento…"
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
  if (unresolved) {
    return (
      <Alert
        variant="warning"
        title="Estamos confirmando seu pagamento"
        description={message}
        showIcon
        data-testid="card-unresolved"
      />
    );
  }
  return (
    <Alert variant="danger" title="Não foi possível pagar" description={message} showIcon data-testid="card-error" />
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
  onResolved: (status: OrderStatus) => void;
  pollIntervalMs?: number;
}): JSX.Element {
  const { Text } = useCheckoutComponents();
  const cc = useCardCheckout(order, buyer, providerConfig, onResolved, pollIntervalMs, tenantSlug, providerChain);
  // A charge NOBODY can confirm yet is not a decline (FUT-563). Some provider
  // may be holding the buyer's money, so it gets its own presentation: the
  // danger heading "Não foi possível pagar" contradicts the body's "não pague
  // de novo" and pushes the buyer toward exactly the retry it forbids.
  const unresolved = cc.errorCode === UNRESOLVED_CODE;

  if (cc.submitted) {
    return <SubmittedState pollError={cc.pollError} pollTimedOut={cc.pollTimedOut} />;
  }

  return (
    <Box data-testid="card-view" sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Text variant="heading" size="md" weight="bold" as="h2">
        Pague com cartão
      </Text>

      {cc.savedCards.length > 0 ? (
        <SavedCardsPicker
          savedCards={cc.savedCards}
          selection={cc.selection}
          onSelect={cc.setSelection}
        />
      ) : null}

      {cc.usingNewCard ? (
        <NewCardForm
          card={cc.card}
          fieldErrors={cc.fieldErrors}
          brand={cc.brand}
          saveCard={cc.saveCard}
          setCard={cc.setCard}
          setFieldErrors={cc.setFieldErrors}
          onSaveCardChange={cc.setSaveCard}
        />
      ) : null}

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
