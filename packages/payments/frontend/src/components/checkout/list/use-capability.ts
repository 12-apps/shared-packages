import { useMemo, useState } from "react";

import { useGooglePayClient, type GooglePayGatewayParams, type GooglePaymentsClient } from "../google-pay-button";
import { cardPathAvailable, googlePayConfig, offeredMethods } from "../method-capability";
import { methodChosenAtProvider } from "../providers/registry";
import type { CheckoutProviderConfig } from "../types";

import type { OnlineCapability } from "./choice";

/** What the store's chain lets THIS browser offer in the list, Google Pay's client included. */
export interface ListCapability extends OnlineCapability {
  /** Google Pay, ready to open its sheet — `null` when there is no row, or while the host re-prices. */
  googlePay: { client: GooglePaymentsClient; params: GooglePayGatewayParams } | null;
}

/**
 * The capability reads the tabs layout already makes (`method-capability.ts`,
 * `providers/registry.ts`), plus the one the list adds: Google Pay as its own
 * row, offered only when the chain head declares it AND this browser's
 * `isReadyToPay` said yes — the same two gates the Google Pay button has
 * always had (FUT-471), so the list never offers a wallet that cannot work.
 *
 * The sheet must open inside the tap, before any order exists, so it is priced
 * with the host's `totalCents` — the amount DUE. A host that never priced it,
 * or prices it at zero (a balance it holds covers everything), offers no row.
 * Once priced, a moment without a price (the host re-pricing — the credit was
 * toggled) keeps the row, and the list holds a chosen Google Pay's button,
 * plainly, until the price returns.
 *
 * Apple Pay is not a row here: its sheet must open synchronously inside the
 * tap, before any order could be raised for it. The tabs layout keeps it.
 */
export function useListCapability(
  config: CheckoutProviderConfig | null,
  /** The host's price for the sheet — no price (or zero), no Google Pay row. */
  totalCents: number | undefined,
): ListCapability {
  const declared = googlePayConfig(config) !== null;
  // `null` tells the client hook not to load pay.js at all.
  const client = useGooglePayClient(declared ? undefined : null, "TEST");
  const priced = totalCents !== undefined && totalCents > 0;
  // Priced once, and not since withdrawn by an explicit zero.
  const [wasPriced, setWasPriced] = useState(false);
  if (priced && !wasPriced) setWasPriced(true);
  if (totalCents === 0 && wasPriced) setWasPriced(false);
  const repricing = totalCents === undefined && wasPriced;
  return useMemo(() => {
    const params = googlePayConfig(config);
    const usable = params && client ? { client, params } : null;
    return {
      handOff: methodChosenAtProvider(config?.chain?.[0]?.checkoutScreen, config),
      offered: offeredMethods(config),
      cardUnavailable: !cardPathAvailable(config),
      googlePayReady: usable !== null && (priced || repricing),
      googlePay: priced ? usable : null,
    };
  }, [config, client, priced, repricing]);
}
