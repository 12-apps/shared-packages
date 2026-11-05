/**
 * A press on the live pay button while the typed card lacks only its CVV
 * (FUT-4401) — what a refusal that kept the card leaves: everything typed but
 * the CVV, cleared on purpose. The button stays live after a refusal, so the
 * buyer always has an action; this press charges nothing, says what is
 * missing in the CVV field and puts the focus there.
 */
import { NEW_CARD, detectBrand, onlyDigits, validateCvv } from "../../../card";
import type { CardFieldCopy } from "../../../card/copy";
import { useCheckoutCopy } from "../copy-context";

import type { CheckoutListChoice } from "./types";
import type { ListCard } from "./use-list-state";

type CvvFirst = (input: { card: ListCard; choice: CheckoutListChoice; covered: boolean }) => boolean;

/** The press guard, bound to the pack's field words. */
export function useCvvFirst(): CvvFirst {
  const copy = useCheckoutCopy().card.fields;
  return (input) => cvvFirst({ ...input, copy });
}

/** True when the press was taken here: the CVV is flagged and focused, and nothing is charged. */
function cvvFirst(input: { card: ListCard; choice: CheckoutListChoice; covered: boolean; copy: CardFieldCopy }): boolean {
  const { card, choice } = input;
  if (input.covered || choice.kind !== "online" || choice.method !== "CARD") return false;
  if (card.selection !== NEW_CARD || card.cvvOnly !== true) return false;
  const flag = validateCvv(card.card.cvv, input.copy, detectBrand(onlyDigits(card.card.number))) ?? input.copy.cvvRequired;
  card.setFieldErrors((current) => ({ ...current, cvv: flag }));
  focusCvv();
  return true;
}

/** The CVV input, wherever the card fields put its test id (on the input, or on its wrapper). */
function focusCvv(): void {
  if (typeof document === "undefined") return;
  const node = document.querySelector('[data-testid="card-cvv"]');
  const input = node instanceof HTMLInputElement ? node : node?.querySelector("input");
  input?.focus();
}
