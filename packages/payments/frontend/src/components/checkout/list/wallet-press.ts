/**
 * A wallet button's press (FUT-3685, C5, C6): the wallet's sheet opens HERE,
 * synchronously, inside the buyer's tap — the browser opens Google's sheet and
 * Safari starts an Apple Pay session only from inside one — priced at the
 * host's amount DUE (`totalCents`, K3). The order is raised in parallel by the
 * list's charge, and the runner charges the sheet's key only against an order
 * that asks the provider for the same amount (R4).
 */
import { useEffect, type MutableRefObject } from "react";

import { startApplePaySession } from "../apple-pay-button";
import { useCheckoutCopy } from "../copy-context";
import { paymentDataRequest, sheetDismissed } from "../google-pay-button";

import type { ListChargeFailure, WalletSheet } from "./charge-runners";
import type { ListCapability } from "./use-capability";
import type { ListCharge } from "./use-list-charge";

/** What a press needs from the list face. */
export interface WalletPressInput {
  cap: ListCapability;
  charge: ListCharge;
  /** The host's amount due, in cents — what the sheet shows. */
  cents: number | undefined;
  /** The amount the bar names for an online payment, frozen at the press. */
  total: string;
  /** Something stops a press: a reason the block shows, or a charge already under way. */
  blocked: boolean;
  /** Before the sheet opens: clear the last refusal, keep the asked details. */
  before: () => void;
  /** A sheet that could not open, in the wallet's own words. */
  onFailed: (failure: ListChargeFailure) => void;
}

/** Google Pay's press: `loadPaymentData` inside the tap, then the charge. */
export function useGooglePayPress(input: WalletPressInput, sheet: MutableRefObject<WalletSheet | null>): () => void {
  return () => {
    const google = input.cap.googlePay;
    const cents = input.cents;
    if (!google || cents === undefined || input.blocked) return;
    input.before();
    const answer = google.client
      .loadPaymentData(paymentDataRequest(google.params, { totalCents: cents }))
      .then(
        (data) => data.paymentMethodData.tokenizationData.token,
        (error: unknown) => {
          if (sheetDismissed(error)) return null;
          throw error;
        },
      );
    sheet.current = { type: "GOOGLE_PAY", answer, cents };
    input.charge.start("GOOGLE_PAY", input.total);
  };
}

/**
 * Apple Pay's press: the session is CREATED and BEGUN synchronously, in the
 * tap — Safari's rule — and the order is raised while the buyer looks at the
 * sheet. A merchant validation that cannot run says why, beside the list.
 */
export function useApplePayPress(input: WalletPressInput, sheet: MutableRefObject<WalletSheet | null>): () => void {
  const copy = useCheckoutCopy().screens.wallet.applePay;
  return () => {
    const apple = input.cap.applePay;
    const cents = input.cents;
    if (!apple || cents === undefined || input.blocked) return;
    input.before();
    const started = startApplePaySession({
      Session: apple.Session,
      cents,
      copy,
      validateMerchant: apple.validateMerchant,
      onError: (message) => input.onFailed({ message, code: null }),
    });
    sheet.current = { type: "APPLE_PAY", answer: started.answer, cents, complete: started.complete };
    input.charge.start("APPLE_PAY", input.total);
  };
}

/**
 * A sheet left open with nobody to charge it: the raise behind it was refused,
 * and the list is back to its rows. Apple's sheet waits for an outcome, so it
 * is told this one failed; nothing is charged.
 */
export function useCloseOrphanSheet(phase: ListCharge["phase"], sheet: MutableRefObject<WalletSheet | null>): void {
  useEffect(() => {
    if (phase !== "idle") return;
    const open = sheet.current;
    sheet.current = null;
    if (!open || open.claimed) return;
    void open.answer.then((key) => {
      if (key !== null) open.complete?.(false);
    }, () => undefined);
  }, [phase, sheet]);
}
