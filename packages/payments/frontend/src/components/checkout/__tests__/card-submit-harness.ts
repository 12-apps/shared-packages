/**
 * The card submit machine (`../card-submit.ts`) with the card state a screen
 * would hold around it — the saved cards and their selection, the typed card
 * and its field errors — for suites that drive the charge itself rather than
 * any one screen's pixels.
 */
import { useState } from "react";

import {
  NEW_CARD,
  detectBrand,
  onlyDigits,
  validateCardNumber,
  validateCvv,
  validateExpiry,
  validateHolder,
  type CardDetails,
  type CardFieldErrors,
  type CardTokenizationConfig,
} from "../../../card";
import { useCardSubmit, type CardSubmit } from "../card-submit";
import type { ChallengeScope } from "../card-outcome";
import { useSavedCards } from "../card-sources";
import { useCheckoutCopy } from "../copy-context";
import type { CardChainLink } from "../method-capability";
import type { CheckoutOrder, OnCheckoutResolved } from "../types";

const EMPTY_CARD: CardDetails = { number: "", holder: "", expiry: "", cvv: "" };

interface SubmitHarness extends CardSubmit {
  selection: string;
  setCard: (card: CardDetails) => void;
}

export function useSubmitHarness(input: {
  order: CheckoutOrder;
  config: CardTokenizationConfig;
  onResolved: OnCheckoutResolved;
  chain?: readonly CardChainLink[];
  tenantSlug?: string;
  scope?: ChallengeScope;
}): SubmitHarness {
  const { selection } = useSavedCards(input.tenantSlug, false);
  const [card, setCard] = useState<CardDetails>(EMPTY_CARD);
  const [, setFieldErrors] = useState<CardFieldErrors>({});
  const fieldCopy = useCheckoutCopy().card.fields;
  const usingNewCard = selection === NEW_CARD;
  const submit = useCardSubmit(
    input.order,
    {},
    input.config,
    input.onResolved,
    10,
    {
      card,
      usingNewCard,
      selection,
      saveCard: false,
      validate: () => ({
        number: validateCardNumber(card.number, fieldCopy),
        holder: validateHolder(card.holder, fieldCopy),
        expiry: validateExpiry(card.expiry, fieldCopy),
        cvv: validateCvv(card.cvv, fieldCopy, detectBrand(onlyDigits(card.number))),
      }),
      setFieldErrors,
    },
    input.chain ?? [],
    input.scope ?? {},
  );
  return { ...submit, selection, setCard };
}
