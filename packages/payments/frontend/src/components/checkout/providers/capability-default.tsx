/**
 * The screen for a provider that declares none (FUT-596, AC3).
 *
 * This is the guarantee that adding a vendor never leaves a blank pane. It is
 * reached three ways, and all three are normal rather than exceptional:
 *
 *   1. An adapter that has not declared `checkoutScreen` at all — Stone and
 *      Stripe today. They check out on the day they are written.
 *   2. A host serving an older `/checkout/config` with no chain, so there is
 *      no id to read.
 *   3. An id THIS bundle has never heard of. The backend and frontend packages
 *      version independently, so a host running a newer server than bundle is
 *      an ordinary deployment state — and the buyer must not pay for it.
 *
 * It does not reimplement a pane. It picks between the same two screens a
 * declaration would have chosen, from the capabilities every adapter already
 * publishes — so the default and the declared path cannot drift apart, and
 * there is exactly one implementation of each shape.
 */
import type { JSX } from "react";

import type { CheckoutProviderConfig } from "../types";

import { HostedLinkScreen } from "./hosted-link";
import { PixAndCardScreen } from "./pix-and-card";
import type { ProviderCheckoutScreenProps } from "./types";

/** Schemes that give the BROWSER a card form of its own. */
const IN_BROWSER_TOKENIZATION: ReadonlySet<string> = new Set(["PUBLIC_KEY", "SDK"]);

/**
 * Whether this store hands the buyer over instead of collecting here — the
 * frontend twin of the server's `usesHostedCheckout`, deliberately written to
 * the same three rules so the pane and the walk cannot disagree.
 *
 * Note this is NOT `!cardPathAvailable(config)`. That helper answers a
 * different question — "is a card offerable at all" — and it answers TRUE for
 * a hand-off store, because typing the card on the provider's page is still a
 * card path. Inverting it therefore sends the hosted store to the on-page
 * screen and the on-page store to the hand-off, which is exactly backwards.
 *
 * The rules, in order:
 *   - Only CARD can be answered in advance. TOKENIZATION IS A CARD FACT: it
 *     says how the browser turns a PAN into an instrument, and a PIX charge
 *     has no instrument to mint. A store with no card-capable entry is not
 *     hosted — this is the FUT-747 correction, and getting it wrong routed the
 *     simplest store there is (one PIX-only provider honestly declaring
 *     `NONE`) into a hand-off it had no link for.
 *   - Hosted only when NOBODY who takes a card takes it here.
 *   - No chain served (an older host, a still-loading config) ⇒ not hosted,
 *     which is what this checkout did before there was a chain to read.
 */
function handsBuyerOver(config: CheckoutProviderConfig | null): boolean {
  const chain = config?.chain;
  if (!chain || chain.length === 0) return false;
  const cardCapable = chain.filter((link) => link.methods.includes("CARD"));
  if (cardCapable.length === 0) return false;
  return !cardCapable.some((link) => IN_BROWSER_TOKENIZATION.has(link.tokenization));
}

export function CapabilityDefaultScreen(props: ProviderCheckoutScreenProps): JSX.Element | null {
  return handsBuyerOver(props.config) ? (
    <HostedLinkScreen {...props} />
  ) : (
    <PixAndCardScreen {...props} />
  );
}
