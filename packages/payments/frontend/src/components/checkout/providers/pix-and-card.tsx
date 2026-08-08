/**
 * The screen for a store that collects payment ON OUR PAGE (FUT-596).
 *
 * A PIX charge renders the provider's code here; a card charge renders our own
 * form and mints the instrument in this browser. Declared by any adapter whose
 * flow is that shape — `pix-and-card` — which today is PagBank and tomorrow is
 * Stone, from one declaration each and no second component.
 *
 * It carries NO hand-off branch. A provider that finishes on its own page
 * declares `hosted-link` and renders `./hosted-link.tsx` instead; the two never
 * test for each other, which is the property FUT-596 exists to buy.
 */
import type { JSX } from "react";

import { PixView } from "../pix-view";
import { WalletCardPane } from "../wallet-pane";

import type { ProviderCheckoutScreenProps } from "./types";

export function PixAndCardScreen(props: ProviderCheckoutScreenProps): JSX.Element | null {
  const { order, onResolved, pollIntervalMs } = props;
  if (order?.method === "PIX") {
    return <PixView order={order} onResolved={onResolved} pollIntervalMs={pollIntervalMs} />;
  }
  if (order?.method === "CARD") {
    // The card pane, with its wallet fast lane above the form (FUT-471/472).
    // The pane reads the chain itself (FUT-563: one instrument per provider,
    // so the charge survives the first one failing with nothing re-typed) and
    // renders exactly the old CardView for a store with no wallet.
    return <WalletCardPane {...props} order={order} />;
  }
  // No order yet — the shell is still showing the picker, and raises one as
  // soon as a method is chosen.
  return null;
}
