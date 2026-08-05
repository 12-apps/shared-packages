import { Box } from "@mui/material";
import type { JSX } from "react";

import {
  CardPayBar,
  NewCardForm,
  SavedCardsPicker,
  type CardTokenizationConfig,
} from "../../card";

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
  tenantSlug,
  onResolved,
  pollIntervalMs = 2500,
}: {
  order: CheckoutOrder;
  buyer?: BuyerInfo;
  /** The active provider's tokenization protocol + key (FUT-697). */
  providerConfig: CardTokenizationConfig;
  /** Scopes the saved-card list to cards the store's provider can charge. */
  tenantSlug?: string;
  onResolved: (status: OrderStatus) => void;
  pollIntervalMs?: number;
}): JSX.Element {
  const { Alert, Text } = useCheckoutComponents();
  const cc = useCardCheckout(order, buyer, providerConfig, onResolved, pollIntervalMs, tenantSlug);

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

      {cc.error ? (
        <Alert variant="danger" title="Não foi possível pagar" description={cc.error} showIcon data-testid="card-error" />
      ) : null}

      <CardPayBar totalLabel={order.totalLabel} submitting={cc.submitting} onPay={() => void cc.handlePay()} />
    </Box>
  );
}
