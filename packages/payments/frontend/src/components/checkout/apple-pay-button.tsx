import { Box } from "@mui/material";
import { useRef, type JSX } from "react";

import { useCheckoutCopy } from "./copy-context";
import type { WalletCopy } from "./screens-copy";
import type { CheckoutOrder } from "./types";

/** The Apple half of {@link WalletCopy} — what this button and its sheet say. */
type ApplePayCopy = WalletCopy["applePay"];

/**
 * The Apple-owned pay button (FUT-472), on `ApplePaySession` — the API Safari
 * ships natively; there is no script to load. This component owns token
 * ACQUISITION: feature-detect, render Apple's button, run the session, and
 * turn an authorized payment into the wallet key (Apple's `token.paymentData`,
 * serialized verbatim). The charge itself belongs to the pane above
 * (`wallet-pane.tsx`), which reports back so the sheet can be completed with
 * the honest status.
 *
 * ## Visa and Mastercard ONLY — a money rule, not a default
 *
 * PagBank currently processes Apple Pay for Visa and Mastercard alone. The
 * sheet's `supportedNetworks` is the one gate that keeps every other card
 * from being OFFERED: a shopper whose wallet holds only an Elo card sees the
 * sheet refuse selection instead of authorizing a payment PagBank then
 * declines. Widening this list is a provider fact change, not a UI choice.
 *
 * ## The fallback is the card form
 *
 * A device without Apple Pay, a store that never declared the wallet, or a
 * merchant validation that cannot run all degrade the same way: no button,
 * and the card form the pane always renders stays. The buyer loses a
 * shortcut, never the ability to pay.
 */

/** PagBank processes Apple Pay for these networks ONLY. See module comment. */
export const APPLE_PAY_SUPPORTED_NETWORKS = ["visa", "masterCard"] as const;

/** ApplePaySession API version 3 — the floor for the fields this sheet uses. */
const APPLE_PAY_VERSION = 3;

/** The payment-request slice this checkout builds. */
export interface ApplePayPaymentRequest {
  countryCode: string;
  currencyCode: string;
  supportedNetworks: readonly string[];
  merchantCapabilities: readonly string[];
  total: { label: string; amount: string };
}

/** The session events/methods this button drives. */
export interface ApplePaySessionLike {
  onvalidatemerchant: ((event: { validationURL: string }) => void) | null;
  onpaymentauthorized: ((event: { payment: { token: { paymentData: unknown } } }) => void) | null;
  oncancel: (() => void) | null;
  begin(): void;
  abort(): void;
  completeMerchantValidation(merchantSession: unknown): void;
  completePayment(result: { status: number }): void;
}

/** The `window.ApplePaySession` constructor, as far as this button needs it. */
export interface ApplePaySessionClass {
  new (version: number, request: ApplePayPaymentRequest): ApplePaySessionLike;
  canMakePayments(): boolean;
  STATUS_SUCCESS: number;
  STATUS_FAILURE: number;
}

/** The native constructor, where Safari (or a harness) provides one. */
function applePaySessionClass(): ApplePaySessionClass | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as { ApplePaySession?: ApplePaySessionClass };
  return scope.ApplePaySession ?? null;
}

/**
 * Whether THIS device can show the sheet at all — the synchronous half of the
 * gate (the capability half is `applePayDeclared`). Exported so the pane can
 * decide whether any wallet chrome (the divider) is worth rendering.
 */
export function applePaySupported(): boolean {
  const Session = applePaySessionClass();
  if (!Session) return false;
  try {
    return Session.canMakePayments();
  } catch {
    return false;
  }
}

/** The sheet's payment request, from the server-authoritative order total. */
function paymentRequest(order: CheckoutOrder, copy: ApplePayCopy): ApplePayPaymentRequest {
  return {
    countryCode: "BR",
    currencyCode: "BRL",
    supportedNetworks: APPLE_PAY_SUPPORTED_NETWORKS,
    merchantCapabilities: ["supports3DS"],
    // The one line Apple's own sheet renders from us, so it is the host's
    // (FUT-760) — the rest of that sheet is Apple's, in the buyer's own
    // system language.
    total: { label: copy.orderTotal, amount: (order.totalCents / 100).toFixed(2) },
  };
}

export interface ApplePayButtonProps {
  order: CheckoutOrder;
  /**
   * The payment authorized on the sheet — charge this key. Resolves `true`
   * when the charge was accepted (paid, or confirming), `false` on a refusal,
   * so the sheet can be completed with the honest status.
   */
  onAuthorized: (key: string) => Promise<boolean>;
  /** A session failure worth telling the buyer about (not a dismissal). */
  onError: (message: string) => void;
  /**
   * The host's merchant-validation port: exchange `validationURL` for an
   * Apple merchant session, SERVER-SIDE (the merchant identity certificate
   * must never reach a browser). Absent — the external prerequisites are not
   * done, or the host has not wired it — the session aborts with the host's
   * `cannotStart` sentence and the card form remains the way to pay.
   */
  validateMerchant?: (validationURL: string) => Promise<unknown>;
}

/** Wire one session run. Split from the component for the size gate. */
function runSession(
  Session: ApplePaySessionClass,
  order: CheckoutOrder,
  handlers: ApplePayButtonProps,
  copy: ApplePayCopy,
): void {
  const session = new Session(APPLE_PAY_VERSION, paymentRequest(order, copy));
  session.onvalidatemerchant = (event) => {
    const validate = handlers.validateMerchant;
    if (!validate) {
      session.abort();
      handlers.onError(copy.cannotStart);
      return;
    }
    validate(event.validationURL)
      .then((merchantSession) => session.completeMerchantValidation(merchantSession))
      .catch(() => {
        session.abort();
        handlers.onError(copy.cannotComplete);
      });
  };
  session.onpaymentauthorized = (event) => {
    // Apple's `token.paymentData`, serialized VERBATIM — PagBank's `key`.
    const key = JSON.stringify(event.payment.token.paymentData);
    void handlers.onAuthorized(key).then((accepted) => {
      session.completePayment({
        status: accepted ? Session.STATUS_SUCCESS : Session.STATUS_FAILURE,
      });
    });
  };
  // Closing the sheet is a choice, not a failure to report.
  session.oncancel = () => undefined;
  session.begin();
}

/**
 * Renders NOTHING unless this device can pay — the sheet's own
 * `supportedNetworks` then keeps unsupported cards from being offered on a
 * device that can. The pixels are Apple's (`-apple-pay-button` appearance, as
 * their Human Interface Guidelines require); only Safari ever renders this,
 * because only Safari passes the feature-detect.
 */
export function ApplePayButton(props: ApplePayButtonProps): JSX.Element | null {
  // The latest handlers/order, so a session opened from a click never closes
  // over a stale charge target.
  const current = useRef(props);
  current.current = props;
  const copy = useCheckoutCopy().screens.wallet.applePay;
  const Session = applePaySessionClass();
  if (!Session || !applePaySupported()) return null;
  return (
    <Box
      component="button"
      type="button"
      aria-label={copy.payAction}
      data-testid="apple-pay-button"
      onClick={() => runSession(Session, current.current.order, current.current, copy)}
      sx={{
        WebkitAppearance: "-apple-pay-button",
        // Apple draws the button; these only give it room. The fallback
        // colors are unreachable in practice (only Safari gets here) but keep
        // the element visible if the appearance ever fails to apply.
        height: 40,
        width: "100%",
        border: 0,
        borderRadius: 2,
        cursor: "pointer",
        bgcolor: "common.black",
        color: "common.white",
      }}
    />
  );
}
