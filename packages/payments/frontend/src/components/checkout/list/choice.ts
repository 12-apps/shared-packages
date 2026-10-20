/**
 * The one list's decisions, as pure functions (FUT-3591): which online rows
 * the store's chain offers, what is chosen before the buyer touches anything,
 * which of the buyer's own details must be asked inside the option, and why
 * the bar's button may not act yet. Nothing here renders or fetches, so every
 * rule is a unit test away.
 */
import {
  NEW_CARD,
  validateCardNumber,
  validateCvv,
  validateExpiry,
  validateHolder,
  detectBrand,
  onlyDigits,
  type CardDetails,
  type SavedCard,
} from "../../../card";
import type { CardFieldCopy } from "../../../card/copy";
import { buyerFieldsFor, fieldSatisfied } from "../buyer-fields";
import { handOffMethod } from "../method-capability";
import type { BuyerInfo, CheckoutChainLink, CheckoutCustomerField, PaymentMethod } from "../types";

import type { CheckoutDoorOption, CheckoutListChoice, CheckoutOnlineChoice, PaymentListCopy } from "./types";

/** One online row: what it is, and whether this browser can take it. */
export interface OnlineRow {
  method: CheckoutOnlineChoice;
  /** A card the store declares but this browser cannot mint for — drawn, not choosable. */
  disabled: boolean;
  /** The DEBIT card row (FUT-3754): the card again, authenticated by 3-D Secure. */
  funding?: "DEBIT";
}

/** What the chain lets this browser offer, as the list needs it. */
export interface OnlineCapability {
  /** The store finishes on the provider's own page. */
  handOff: boolean;
  /** The methods the chain declares, or `null` while unknown (fails OPEN). */
  offered: PaymentMethod[] | null;
  cardUnavailable: boolean;
  /** The debit row is offered: the head declares debit and the host gave an address (FUT-3754). */
  debit?: boolean;
}

/**
 * The "PAGAR AGORA, PELO APP" rows, in the prototype's order: Pix, then the
 * card — or the single hand-off row for a store that takes the method on its
 * own page (N18). The wallets are not rows: they are buttons in the block
 * above the list (FUT-3685, R1), and pressing one never changes the choice.
 */
export function onlineRows(cap: OnlineCapability): OnlineRow[] {
  if (cap.handOff) return [{ method: "HAND_OFF", disabled: false }];
  const offers = (method: PaymentMethod): boolean => cap.offered === null || cap.offered.includes(method);
  const rows: OnlineRow[] = [];
  if (offers("PIX")) rows.push({ method: "PIX", disabled: false });
  if (offers("CARD")) rows.push({ method: "CARD", disabled: cap.cardUnavailable });
  // Right under the credit card, and only where the store has debit on.
  if (offers("CARD") && cap.debit) rows.push({ method: "CARD", funding: "DEBIT", disabled: cap.cardUnavailable });
  return rows;
}

/** The chain method an online choice raises — what `createOrder` is asked for. */
export function raisedMethod(choice: CheckoutOnlineChoice, offered: PaymentMethod[] | null): PaymentMethod {
  if (choice === "PIX") return "PIX";
  if (choice === "HAND_OFF") return handOffMethod(offered);
  return "CARD";
}

/**
 * The saved card to choose for the buyer: the one used LAST (owner,
 * 2026-10-15), or the list's head — the host's own order, newest first — when
 * no card says when it was used. A card never used loses to any used one.
 */
export function lastUsedCard(saved: readonly SavedCard[]): SavedCard | undefined {
  let pick: SavedCard | undefined;
  let pickAt = -Infinity;
  for (const card of saved) {
    const at = card.lastUsedAt ? Date.parse(card.lastUsedAt) : Number.NaN;
    if (!Number.isNaN(at) && at > pickAt) {
      pick = card;
      pickAt = at;
    }
  }
  return pick ?? saved[0];
}

/**
 * What is chosen before the buyer touches anything (M7, owner 2026-10-15): a
 * saved card makes "Cartão de crédito" the choice with that card selected —
 * the one used last ({@link lastUsedCard}). The buyer's LAST online method
 * (`lastMethod`, FUT-3611) wins when the store offers it: Pix as Pix, since
 * choosing creates nothing any more. Never a door tender (FUT-1478), and not
 * a store's only method by itself either (that pick used to raise an order
 * with no tap at all).
 *
 * A buyer back here because a card was REFUSED (`fresh`) keeps the card
 * chosen, with no saved card selected for them — the one this would pick is
 * the one that failed (FUT-1145).
 */
export function preselection(
  rows: readonly OnlineRow[],
  saved: readonly SavedCard[],
  fresh: boolean,
  lastMethod: "PIX" | "CARD" | null = null,
): { choice: CheckoutListChoice; selection: string | null } | null {
  const pixOffered = rows.some((row) => row.method === "PIX" && !row.disabled);
  if (lastMethod === "PIX" && pixOffered && !fresh) return { choice: { kind: "online", method: "PIX" }, selection: null };
  const card = rows.find((row) => row.method === "CARD" && !row.disabled);
  if (!card) return null;
  if (fresh) return { choice: { kind: "online", method: "CARD" }, selection: saved.length > 0 ? null : NEW_CARD };
  const head = lastUsedCard(saved);
  if (!head) return null;
  return { choice: { kind: "online", method: "CARD" }, selection: head.id };
}

/**
 * The buyer's own details to ask INSIDE the chosen online option (M11): the
 * fields the chain requires for that method which the buyer arrived without.
 * Decided against what the buyer ARRIVED with, never against what they are
 * typing, so the field does not vanish under their thumb as it completes.
 * With a CPF on file the CPF is never asked — the server holds it.
 */
export function askedFields(input: {
  chain: readonly CheckoutChainLink[] | undefined;
  method: PaymentMethod;
  arrivedWith: BuyerInfo | undefined;
  taxIdOnFile: boolean;
}): CheckoutCustomerField[] {
  return buyerFieldsFor(input.chain, input.method).filter(
    (field) =>
      field.required &&
      !(field.key === "taxId" && input.taxIdOnFile) &&
      !fieldSatisfied(field, input.arrivedWith?.[field.key]),
  );
}

/** Every one of the four card fields is valid — the button's question. */
export function cardComplete(card: CardDetails, copy: CardFieldCopy): boolean {
  const brand = detectBrand(onlyDigits(card.number));
  return (
    !validateCardNumber(card.number, copy) &&
    !validateHolder(card.holder, copy) &&
    !validateExpiry(card.expiry, copy) &&
    !validateCvv(card.cvv, copy, brand)
  );
}

/** The reason for the first of the asked fields the buyer has not satisfied yet. */
function buyerReason(
  asked: readonly CheckoutCustomerField[],
  buyer: BuyerInfo,
  reasons: PaymentListCopy["reasons"],
): string | null {
  const missing = asked.find((field) => !fieldSatisfied(field, buyer[field.key]));
  if (!missing) return null;
  if (missing.key === "taxId") return reasons.cpf;
  if (missing.key === "phone") return reasons.phone;
  return reasons.details;
}

/** What the card option still needs: a card chosen, and a typed one complete. */
function cardReason(
  selection: string | null,
  complete: boolean,
  reasons: PaymentListCopy["reasons"],
): string | null {
  if (selection === null) return reasons.chooseCard;
  if (selection === NEW_CARD && !complete) return reasons.cardDetails;
  return null;
}

/**
 * Why the bar's button cannot act, in the order the prototype checks
 * (FN:447-456): the host's hold, nothing chosen, the buyer's details, the
 * card — and for a door option, the host's own reason. `null` ⇒ it can act.
 */
export function blockedReason(input: {
  copy: PaymentListCopy;
  hold: string | null;
  choice: CheckoutListChoice | null;
  door: CheckoutDoorOption | undefined;
  asked: readonly CheckoutCustomerField[];
  buyer: BuyerInfo;
  selection: string | null;
  cardIsComplete: boolean;
  /** The host's balance pays the whole amount: no card needs choosing. */
  covered?: boolean;
}): string | null {
  const { copy, choice } = input;
  if (input.hold) return input.hold;
  if (!choice) return copy.reasons.choose;
  if (choice.kind === "door") return input.door ? input.door.blocked : copy.reasons.choose;
  const buyer = buyerReason(input.asked, input.buyer, copy.reasons);
  if (buyer) return buyer;
  if (choice.method !== "CARD" || input.covered) return null;
  return cardReason(input.selection, input.cardIsComplete, copy.reasons);
}

/** The bar button's verb for what is chosen. */
export function actionLabel(
  copy: PaymentListCopy,
  choice: CheckoutListChoice | null,
  door: CheckoutDoorOption | undefined,
  provider: string | null,
  covered = false,
): string {
  if (!choice) return copy.actions.choose;
  if (choice.kind === "door") return door?.action ?? copy.actions.choose;
  // A handoff leaves the store for a provider even at zero: it keeps its own verb.
  if (covered && choice.method !== "HAND_OFF") return copy.actions.covered;
  const verbs: Record<CheckoutOnlineChoice, string> = {
    PIX: copy.actions.pix,
    CARD: copy.actions.card,
    GOOGLE_PAY: copy.actions.googlePay,
    HAND_OFF: copy.actions.handOff(provider),
  };
  return verbs[choice.method];
}

/** A saved card's name — "Visa final 4242", or "Cartão final 4242" when the network is unknown. */
export function cardName(copy: PaymentListCopy, card: Pick<SavedCard, "brand" | "last4">): string {
  const brand = card.brand.trim();
  return copy.savedCard(brand && brand.toLowerCase() !== "unknown" ? brand : null, card.last4);
}
