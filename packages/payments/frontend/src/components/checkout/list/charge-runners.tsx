/**
 * The two charges the one list's button starts once an order is held
 * (FUT-3592): the CARD — the buyer's saved card or the one they typed — and
 * GOOGLE PAY's sheet. Each is the existing money path (`useCardSubmit`,
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
import type { BuyerInfo, CheckoutOrder, OnCheckoutResolved } from "../types";
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
 * Google Pay: the sheet was opened INSIDE the buyer's tap (`sheet`, priced at
 * `sheetCents`) while the order was raised; its key is charged against that
 * order only if the order asks the provider for what the sheet showed — its
 * amount due, which a balance the host holds may have made less than its
 * total. A closed sheet sends nothing more.
 */
export function WalletRun({
  order,
  buyer,
  sheet,
  sheetCents,
  scope,
  onResolved,
  pollIntervalMs,
  onAccepted,
  onFailed,
}: RunnerCallbacks & {
  order: CheckoutOrder;
  buyer: BuyerInfo;
  /** The sheet's answer: the wallet key, or `null` when the buyer closed it. */
  sheet: Promise<string | null>;
  sheetCents: number;
  scope: ChallengeScope;
  onResolved: OnCheckoutResolved;
  pollIntervalMs: number;
}): JSX.Element | null {
  const words = useCheckoutCopy().screens.wallet.googlePay;
  const wallet = useWalletCharge(order, buyer, onResolved, pollIntervalMs, scope);
  useFireOnce(true, () => {
    const refused = { message: words.cannotComplete, code: null };
    sheet
      .then((key) => {
        if (key === null) return onFailed(null);
        // The sheet showed one amount; never charge another under it.
        if ((order.amountDueCents ?? order.totalCents) !== sheetCents) return onFailed(refused);
        return void wallet.payWithKey("GOOGLE_PAY", key);
      })
      .catch(() => onFailed(refused));
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
