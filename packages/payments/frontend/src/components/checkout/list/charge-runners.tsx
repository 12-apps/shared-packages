/**
 * The charges the one list starts once an order is held (FUT-3592,
 * FUT-3685): the CARD — the buyer's saved card or the one they typed — and a
 * wallet's sheet, Google Pay's or Apple Pay's. Each is the existing money path (`useCardSubmit`,
 * `useWalletCharge`), run with no button of its own: the list's bar already
 * was the button, and its 5-second window the buyer's chance to stop it.
 *
 * Mounted only while a charge is under way, so a runner never outlives the
 * charge it was started for; what it learned on the way out — a refusal, an
 * accepted charge — goes back to the list through its callbacks.
 */
import { useEffect, useRef, type JSX } from "react";

import type { CardChainLink } from "../method-capability";
import { NEW_CARD, type CardTokenizationConfig } from "../../../card";
import { useRefreshOnCartChanged } from "../cart-changed";
import { SubmittedState } from "../card-view";
import type { ChallengeScope } from "../card-outcome";
import { useCheckoutCopy } from "../copy-context";
import type { BuyerInfo, CheckoutOrder, CheckoutWalletType, OnCheckoutResolved } from "../types";
import { useCardSubmit } from "../use-card-checkout";
import { useWalletCharge } from "../use-wallet-charge";

import type { ListCard } from "./use-list-state";

/** A charge that came back refused or unresolved — what the list shows beside the card. */
export interface ListChargeFailure {
  message: string;
  code: string | null;
}

interface RunnerCallbacks {
  /** Accepted, and now awaited — the list gives way to the wait. */
  onAccepted: () => void;
  /** Refused, unresolved, or never sent — back to the list, saying why (or not, for a dismissal). */
  onFailed: (failure: ListChargeFailure | null) => void;
}

/** Press "Pagar" once, as soon as the order's card key is in hand. */
function useFireOnce(ready: boolean, fire: () => void): void {
  const fired = useRef(false);
  const latest = useRef(fire);
  latest.current = fire;
  useEffect(() => {
    if (fired.current || !ready) return;
    fired.current = true;
    latest.current();
  }, [ready]);
}

/** The card, charged against the held order. Renders the wait once the charge is accepted. */
export function CardRun({
  order,
  buyer,
  card,
  config,
  chain,
  scope,
  onResolved,
  pollIntervalMs,
  onAccepted,
  onFailed,
}: RunnerCallbacks & {
  order: CheckoutOrder;
  buyer: BuyerInfo;
  card: ListCard;
  config: CardTokenizationConfig;
  chain: readonly CardChainLink[];
  scope: ChallengeScope;
  onResolved: OnCheckoutResolved;
  pollIntervalMs: number;
}): JSX.Element | null {
  const fieldCopy = useCheckoutCopy().card.fields;
  const usingNewCard = card.selection === NEW_CARD;
  const submit = useCardSubmit(
    order,
    buyer,
    config,
    onResolved,
    pollIntervalMs,
    {
      card: card.card,
      usingNewCard,
      selection: card.selection ?? NEW_CARD,
      saveCard: card.saveCard,
      // The button was only live with every field valid; re-checked here
      // because a submit that skipped it would tokenize garbage.
      validate: () => ({
        number: card.complete ? undefined : fieldCopy.numberInvalid,
      }),
      setFieldErrors: card.setFieldErrors,
    },
    chain,
    scope,
  );
  useFireOnce(!submit.keyPending, () => void submit.handlePay());
  // Re-priced by the host when the server says the cart moved (FUT-1139).
  useRefreshOnCartChanged(submit.errorCode);
  const { error, errorCode, submitted } = submit;
  useEffect(() => {
    if (error) onFailed({ message: error, code: errorCode });
  }, [error, errorCode, onFailed]);
  useEffect(() => {
    if (submitted) onAccepted();
  }, [submitted, onAccepted]);
  return submitted ? <SubmittedState card={submit} /> : null;
}

/**
 * A refusal a host can fix: its order answers no `amountDueCents`, and its
 * total is not what the sheet showed — the shape of a balance taken off the
 * charge that the order view does not report. Said once in development; the
 * buyer still gets the refusal.
 */
function warnMissingAmountDue(order: CheckoutOrder, sheetCents: number, type: CheckoutWalletType): void {
  const development = typeof process !== "undefined" && process.env?.NODE_ENV !== "production";
  if (order.amountDueCents !== undefined || !development) return;
  const wallet = type === "APPLE_PAY" ? "Apple Pay" : "Google Pay";
  console.warn(
    `[payments-frontend] ${wallet} refused: the order costs ${order.totalCents} cents and the sheet showed ${sheetCents}. ` +
      "A host that takes a balance off the charge must answer CheckoutOrder.amountDueCents.",
  );
}

/** A wallet's sheet, opened inside the tap: its answer, the amount it showed, and how to close it. */
export interface WalletSheet {
  type: CheckoutWalletType;
  /** The sheet's answer: the wallet key, or `null` when the buyer closed it. */
  answer: Promise<string | null>;
  cents: number;
  /** Close the sheet with the charge's outcome — Apple's sheet waits for it; Google's closes itself. */
  complete?: (accepted: boolean) => void;
  /** A runner took the sheet: it, not the list, closes it. */
  claimed?: boolean;
}

/** The sentence for a wallet charge that could not go out. */
function useRefusedWords(type: CheckoutWalletType): string {
  const words = useCheckoutCopy().screens.wallet;
  return type === "APPLE_PAY" ? words.applePay.cannotComplete : words.googlePay.cannotComplete;
}

/**
 * A wallet — Google Pay or Apple Pay (FUT-3685): the sheet was opened INSIDE
 * the buyer's tap, priced at `sheet.cents`, while the order was raised; its
 * key is charged against that order only if the order asks the provider for
 * what the sheet showed — its amount due, which a balance the host holds may
 * have made less than its total (R4). A closed sheet sends nothing more.
 */
export function WalletRun({
  order,
  buyer,
  sheet,
  scope,
  onResolved,
  pollIntervalMs,
  onAccepted,
  onFailed,
}: RunnerCallbacks & {
  order: CheckoutOrder;
  buyer: BuyerInfo;
  sheet: WalletSheet;
  scope: ChallengeScope;
  onResolved: OnCheckoutResolved;
  pollIntervalMs: number;
}): JSX.Element | null {
  const refusedWords = useRefusedWords(sheet.type);
  const wallet = useWalletCharge(order, buyer, onResolved, pollIntervalMs, scope);
  useFireOnce(true, () => {
    sheet.claimed = true;
    const refused = { message: refusedWords, code: null };
    sheet.answer
      .then(async (key) => {
        if (key === null) return onFailed(null);
        // The sheet showed one amount; never charge another under it.
        if ((order.amountDueCents ?? order.totalCents) !== sheet.cents) {
          warnMissingAmountDue(order, sheet.cents, sheet.type);
          sheet.complete?.(false);
          return onFailed(refused);
        }
        // Charged FIRST, then the sheet told: `complete?.(await …)` would skip
        // the charge itself for a sheet with nothing to complete (Google's).
        const accepted = await wallet.payWithKey(sheet.type, key);
        sheet.complete?.(accepted);
      })
      .catch(() => {
        sheet.complete?.(false);
        onFailed(refused);
      });
  });
  const { error, errorCode, phase } = wallet;
  useEffect(() => {
    if (error) onFailed({ message: error, code: errorCode });
  }, [error, errorCode, onFailed]);
  useEffect(() => {
    if (phase === "polling") onAccepted();
  }, [phase, onAccepted]);
  return phase === "idle" ? null : <SubmittedState card={wallet} />;
}
