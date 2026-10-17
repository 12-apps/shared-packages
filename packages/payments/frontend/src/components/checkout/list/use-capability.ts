import { useCallback, useMemo, useRef, useState } from "react";

import { applePaySessionClass, applePaySupported, type ApplePaySessionClass } from "../apple-pay-button";
import { useGooglePayClient, type GooglePayGatewayParams, type GooglePaymentsClient } from "../google-pay-button";
import { applePayDeclared, cardPathAvailable, googlePayConfig, offeredMethods } from "../method-capability";
import { methodChosenAtProvider } from "../providers/registry";
import type { CheckoutProviderConfig, PaymentMethod } from "../types";

import type { OnlineCapability } from "./choice";

/** Apple Pay, ready to start a session inside the tap. */
export interface ListApplePay {
  Session: ApplePaySessionClass;
  /** The host's merchant-validation port (server-side). */
  validateMerchant: (validationURL: string) => Promise<unknown>;
}

/** What the store's chain lets THIS browser offer in the list, the wallets included. */
export interface ListCapability extends OnlineCapability {
  /** Google Pay, ready to open its sheet — `null` when it is not offered, or while the host re-prices. */
  googlePay: { client: GooglePaymentsClient; params: GooglePayGatewayParams } | null;
  /** Apple Pay, ready to start its session — `null` when it is not offered, or while the host re-prices. */
  applePay: ListApplePay | null;
  /**
   * The wallets the "PAGAMENTO RÁPIDO" block draws, in the prototype's order.
   * A wallet drawn while the host re-prices has its button held
   * (`googlePay`/`applePay` is `null` for that moment).
   */
  wallets: ListWallet[];
}

export type ListWallet = "GOOGLE_PAY" | "APPLE_PAY";

/**
 * The host priced the sheet once and, for a moment, has no price (re-pricing:
 * the credit was toggled) — a wallet keeps its place, held, until the price
 * returns. An explicit zero (a balance covers everything) withdraws it.
 */
function useRepricing(totalCents: number | undefined): { priced: boolean; repricing: boolean } {
  const priced = totalCents !== undefined && totalCents > 0;
  const [wasPriced, setWasPriced] = useState(false);
  if (priced && !wasPriced) setWasPriced(true);
  if (totalCents === 0 && wasPriced) setWasPriced(false);
  return { priced, repricing: totalCents === undefined && wasPriced };
}

/** Apple Pay's session class, when the chain head declares the wallet and this device can pay (R5). */
function appleSession(config: CheckoutProviderConfig | null, port: ListApplePay["validateMerchant"] | undefined): ListApplePay | null {
  if (!port || !applePayDeclared(config) || !applePaySupported()) return null;
  const Session = applePaySessionClass();
  return Session ? { Session, validateMerchant: port } : null;
}

/** Whether the card is offered and available on THIS page — what a wallet is another way of producing. */
function cardHere(handOff: boolean, offered: PaymentMethod[] | null, cardUnavailable: boolean): boolean {
  return !handOff && !cardUnavailable && (offered === null || offered.includes("CARD"));
}

/** The wallets the block draws: each ready one, while the card is here and the sheet is (or was) priced. */
function walletsShown(shown: boolean, google: unknown, apple: unknown): ListWallet[] {
  if (!shown) return [];
  const wallets: ListWallet[] = [];
  if (google) wallets.push("GOOGLE_PAY");
  if (apple) wallets.push("APPLE_PAY");
  return wallets;
}

/** Google Pay's client and the head's gateway parameters, when both are there. */
function googleSheet(config: CheckoutProviderConfig | null, client: GooglePaymentsClient | null): ListCapability["googlePay"] {
  const params = googlePayConfig(config);
  return params && client ? { client, params } : null;
}

/** {@link useListCapability}'s answer, from what it read. */
function capabilityOf(
  config: CheckoutProviderConfig | null,
  client: GooglePaymentsClient | null,
  price: { priced: boolean; repricing: boolean },
  port: ListApplePay["validateMerchant"] | undefined,
): ListCapability {
  const offered = offeredMethods(config);
  const cardUnavailable = !cardPathAvailable(config);
  const handOff = methodChosenAtProvider(config?.chain?.[0]?.checkoutScreen, config);
  const card = cardHere(handOff, offered, cardUnavailable);
  const google = googleSheet(config, client);
  const apple = appleSession(config, port);
  const live = card && price.priced;
  return {
    handOff,
    offered,
    cardUnavailable,
    wallets: walletsShown(card && (price.priced || price.repricing), google, apple),
    googlePay: live ? google : null,
    applePay: live ? apple : null,
  };
}

/**
 * The capability reads the tabs layout already makes (`method-capability.ts`,
 * `providers/registry.ts`), plus the two wallets of the "PAGAMENTO RÁPIDO"
 * block (FUT-3685, R5). A wallet is ready when the chain head declares it AND
 * this device can pay with it — Google's `isReadyToPay`, Apple's
 * `canMakePayments` — AND the card is offered and available here, since a
 * wallet is another way of producing the card (so a Pix-only store never shows
 * the block). Apple also needs the host's merchant-validation port: without it
 * the session could only abort.
 *
 * Both sheets open inside the tap, before any order exists, so they are priced
 * with the host's `totalCents` — the amount DUE. A host that never priced it,
 * or prices it at zero (a balance covers everything), offers no wallet.
 */
export function useListCapability(
  config: CheckoutProviderConfig | null,
  /** The host's price for the sheets — no price (or zero), no wallet. */
  totalCents: number | undefined,
  validateApplePayMerchant?: ListApplePay["validateMerchant"],
): ListCapability {
  const declared = googlePayConfig(config) !== null;
  // `null` tells the client hook not to load pay.js at all.
  const client = useGooglePayClient(declared ? undefined : null, "TEST");
  const { priced, repricing } = useRepricing(totalCents);
  // The port is read at the press, through a ref: a host passing a new
  // function each render must not rebuild the capability (and the wallets'
  // buttons) every time. Only whether there IS one changes what is offered.
  const port = useRef(validateApplePayMerchant);
  port.current = validateApplePayMerchant;
  const hasPort = validateApplePayMerchant !== undefined;
  const stablePort = useCallback((validationURL: string): Promise<unknown> => {
    const current = port.current;
    return current ? current(validationURL) : Promise.reject(new Error("no merchant validation port"));
  }, []);
  return useMemo(
    () => capabilityOf(config, client, { priced, repricing }, hasPort ? stablePort : undefined),
    [config, client, priced, repricing, hasPort, stablePort],
  );
}
