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

import { handsBuyerOver } from "./hands-over";
import { HostedLinkScreen } from "./hosted-link";
import { PixAndCardScreen } from "./pix-and-card";
import type { ProviderCheckoutScreenProps } from "./types";

export function CapabilityDefaultScreen(props: ProviderCheckoutScreenProps): JSX.Element | null {
  return handsBuyerOver(props.config) ? (
    <HostedLinkScreen {...props} />
  ) : (
    <PixAndCardScreen {...props} />
  );
}
