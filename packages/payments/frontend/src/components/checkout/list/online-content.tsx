import { Box, Chip } from "@mui/material";
import { useRef, type JSX } from "react";

import { NEW_CARD, NewCardForm, detectBrand, onlyDigits } from "../../../card";
import { ChargeFailure } from "../card-view";
import { UNRESOLVED_CODE } from "../failure-codes";
import type { BuyerInfo, CheckoutCustomerField } from "../types";

import { BuyerInline } from "./buyer-inline";
import { cardName } from "./choice";
import type { ListChargeFailure } from "./charge-runners";
import type { PaymentListCopy } from "./types";
import type { ListCard } from "./use-list-state";

/**
 * The saved cards as chips — "Visa final 4242", "Outro cartão" — the
 * storefront's chip look (the owner's "use the chips system is using today"):
 * MUI's own `Chip`, which the host's theme already dresses, filled in the
 * primary colour when chosen.
 */
function SavedChips({ card, copy }: { card: ListCard; copy: PaymentListCopy }): JSX.Element | null {
  if (card.saved.length === 0) return null;
  const chip = (id: string, label: string) => {
    const on = card.selection === id;
    return (
      <Chip
        key={id}
        label={label}
        clickable
        color={on ? "primary" : "default"}
        variant="filled"
        role="radio"
        aria-checked={on}
        onClick={() => card.setSelection(id)}
        data-testid={id === NEW_CARD ? "list-card-new" : `list-card-${id}`}
        sx={{ fontWeight: on ? 600 : 400 }}
      />
    );
  };
  return (
    <Box role="radiogroup" aria-label={copy.card.label} sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
      {card.saved.map((saved) => chip(saved.id, cardName(copy, saved)))}
      {chip(NEW_CARD, copy.otherCard)}
    </Box>
  );
}

/** Move the focus to the card number — the next thing to type once the CPF is complete. */
function focusCardNumber(scope: HTMLElement | null): void {
  scope?.querySelector<HTMLInputElement>('input[data-testid="card-number"]')?.focus();
}

/**
 * What opens inside a chosen ONLINE option, top to bottom (M11, FN:180-202):
 * the buyer's missing details, then — for the card — the saved-card chips and
 * the card fields, then a refusal of the last charge. No left indent: it all
 * starts where the row's own content starts.
 */
export function OnlineContent({
  method,
  asked,
  buyer,
  onBuyerChange,
  card,
  copy,
  provider,
  failure,
}: {
  method: "PIX" | "CARD" | "GOOGLE_PAY" | "HAND_OFF";
  asked: readonly CheckoutCustomerField[];
  buyer: BuyerInfo;
  onBuyerChange: (buyer: BuyerInfo) => void;
  card: ListCard;
  copy: PaymentListCopy;
  provider: string | null;
  failure: ListChargeFailure | null;
}): JSX.Element {
  const scope = useRef<HTMLDivElement | null>(null);
  const isCard = method === "CARD";
  return (
    <Box ref={scope} sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
      <BuyerInline
        asked={asked}
        buyer={buyer}
        onBuyerChange={onBuyerChange}
        copy={copy.buyer}
        provider={provider}
        onComplete={isCard ? () => focusCardNumber(scope.current) : undefined}
      />
      {isCard ? <SavedChips card={card} copy={copy} /> : null}
      {isCard && card.selection === NEW_CARD ? (
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
      {failure ? <ChargeFailure message={failure.message} unresolved={failure.code === UNRESOLVED_CODE} /> : null}
    </Box>
  );
}
