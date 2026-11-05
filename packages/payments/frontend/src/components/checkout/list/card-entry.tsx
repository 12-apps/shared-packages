/**
 * The card entry for a payable that ALREADY exists (FUT-3811) — what
 * `createPaymentFlows().screens.CardEntry` renders, e.g. a host's "pay this
 * order with a card" over an order page.
 *
 * It is the one list's card, without the list around it: the list's card state
 * (`useListCard`) and the list's charge runner (`CardRun`, the shared submit
 * machine), behind the package's own card fields and pay bar. There is no
 * order to raise and no method to choose, so there is no 5-second bar either:
 * "Pagar" charges.
 */
import { Box } from "@mui/material";
import { useCallback, useState, type JSX } from "react";

import {
  CardPayBar,
  NEW_CARD,
  NewCardForm,
  SavedCardsPicker,
  detectBrand,
  onlyDigits,
  validateCardNumber,
  validateCvv,
  validateExpiry,
  validateHolder,
  type CardDetails,
  type CardFieldCopy,
  type CardFieldErrors,
} from "../../../card";
import { useSavedCards } from "../card-sources";
import type { CheckoutDecline } from "../decline";
import { ChargeFailure } from "../charge-states";
import { useCheckoutCopy } from "../copy-context";
import { UNRESOLVED_CODE } from "../failure-codes";
import { cardChain, cardTokenization } from "../method-capability";
import type { CheckoutOrder, CheckoutProviderConfig, OnCheckoutResolved } from "../types";
import { useCheckoutComponents } from "../ui";

import { CardRun, type ListChargeFailure } from "./charge-runners";
import { useListCard, type ListCard } from "./use-list-state";

/** Every field's reason, for a new card — what "Pagar" checks before it charges. */
function newCardErrors(card: CardDetails, copy: CardFieldCopy): CardFieldErrors {
  return {
    number: validateCardNumber(card.number, copy),
    holder: validateHolder(card.holder, copy),
    expiry: validateExpiry(card.expiry, copy),
    cvv: validateCvv(card.cvv, copy, detectBrand(onlyDigits(card.number))),
  };
}

/**
 * The list's card, opened on the buyer's saved card when there is one (the
 * saved cards and the selection land in one update, so the form never flashes
 * at a buyer whose card is about to be chosen) and on the fields otherwise.
 */
function useEntryCard(tenantSlug: string | undefined): ListCard {
  const { savedCards, selection, setSelection } = useSavedCards(tenantSlug, false);
  const card = useListCard(savedCards);
  const select = useCallback((next: string | null) => setSelection(next ?? NEW_CARD), [setSelection]);
  return { ...card, selection, setSelection: select };
}

/** The saved cards, then the form for a new one while "Novo cartão" is chosen. */
function EntryFields({ card }: { card: ListCard }): JSX.Element {
  const selection = card.selection ?? NEW_CARD;
  return (
    <>
      {card.saved.length > 0 ? (
        <SavedCardsPicker savedCards={card.saved} selection={selection} onSelect={card.setSelection} />
      ) : null}
      {selection === NEW_CARD ? (
        <NewCardForm
          card={card.card}
          fieldErrors={card.fieldErrors}
          brand={detectBrand(onlyDigits(card.card.number))}
          saveCard={card.saveCard}
          setCard={card.setCard}
          setFieldErrors={card.setFieldErrors}
          onSaveCardChange={card.setSaveCard}
        />
      ) : null}
    </>
  );
}

/** Bubble a closed refusal up — with one argument when the server classified nothing, as before. */
function resolveRefused(onResolved: OnCheckoutResolved, decline: CheckoutDecline): void {
  if (decline.reason === undefined && decline.retriable === undefined) onResolved("FAILED");
  else onResolved("FAILED", decline);
}

export function CardEntryPane({
  order,
  config,
  tenantSlug,
  onResolved,
  pollIntervalMs = 2500,
}: {
  order: CheckoutOrder;
  /** The store's `/checkout/config` — its card key and the chain to mint for (FUT-563). */
  config: CheckoutProviderConfig | null;
  /** Scopes the saved cards to the store, and parks a 3-D Secure hand-off with it. */
  tenantSlug?: string;
  onResolved: OnCheckoutResolved;
  pollIntervalMs?: number;
}): JSX.Element {
  const { Text } = useCheckoutComponents();
  const copy = useCheckoutCopy();
  const card = useEntryCard(tenantSlug);
  const [running, setRunning] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [failure, setFailure] = useState<ListChargeFailure | null>(null);
  const onAccepted = useCallback(() => setAccepted(true), []);
  const onFailed = useCallback((next: ListChargeFailure | null) => {
    setRunning(false);
    setAccepted(false);
    // A refusal that closed the payable cannot be paid again here: the host's
    // own ending takes it, as every refusal did before FUT-4401. One that left
    // it chargeable stays beside the card, for the buyer to correct and resend.
    if (next?.refusal?.orderClosed) return void resolveRefused(onResolved, next.refusal.decline);
    setFailure(next);
  }, [onResolved]);
  const pay = (): void => {
    setFailure(null);
    if (card.selection === NEW_CARD) {
      const errors = newCardErrors(card.card, copy.card.fields);
      card.setFieldErrors(errors);
      if (Object.values(errors).some(Boolean)) return;
    }
    setRunning(true);
  };
  // A charge NOBODY can confirm yet is not a decline (FUT-563): paying again is
  // the one act its message forbids, so the pay bar is gone, not disabled.
  const unresolved = failure?.code === UNRESOLVED_CODE;
  return (
    <Box data-testid="card-entry" sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {accepted ? null : (
        <>
          <Text variant="heading" size="md" weight="bold" as="h2">
            {copy.screens.card.heading}
          </Text>
          <EntryFields card={card} />
          {failure ? <ChargeFailure message={failure.message} unresolved={unresolved} /> : null}
          {unresolved ? null : <CardPayBar totalLabel={order.totalLabel} submitting={running} onPay={pay} />}
        </>
      )}
      {running || accepted ? (
        <CardRun
          order={order}
          buyer={{}}
          card={card}
          config={cardTokenization(config)}
          chain={cardChain(config)}
          scope={{ tenantSlug }}
          onResolved={onResolved}
          pollIntervalMs={pollIntervalMs}
          onAccepted={onAccepted}
          onFailed={onFailed}
        />
      ) : null}
    </Box>
  );
}
