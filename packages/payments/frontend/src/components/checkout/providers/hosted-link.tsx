/**
 * The screen for a store whose buyer finishes on the PROVIDER's page (FUT-596).
 *
 * Declared as `hosted-link` by any adapter of that shape — today InfinitePay.
 * There is no card form and no PIX pane here on purpose: this provider takes
 * neither on our page, and rendering either would offer a buyer something the
 * charge cannot honour.
 *
 * ## Why this screen renders no payable
 *
 * For a hand-off provider the pane never receives an `order`, and that is by
 * design rather than an omission. The controller raises the charge, sees a
 * `hostedCheckoutUrl` on the response and navigates — `handOverToProvider`
 * returns before `setOrder` (`use-checkout-controller.ts`), because the buyer
 * is leaving this page and parking the payable for the return leg matters more
 * than painting a pane they will not see. `hosted-return.ts` picks it back up.
 *
 * So the whole job here is the moment BEFORE that: telling the buyer where
 * they are about to go, and giving them the one action that takes them.
 *
 * ## Why the ACTION lives here and not in the shell's picker
 *
 * The shell hides its PIX/card picker for this screen (`methodChosenAtProvider`
 * in `./registry.ts`), so the screen owns the affordance that starts the
 * charge. That is the point of the whole arrangement: the method question is
 * binding on the provider's page, not on ours — every answer mints the same
 * link — so asking it twice tells the buyer their first answer was thrown
 * away. One button that says where it leads is the honest version of that
 * screen, and it also removes the moment where the pane rendered `null` under
 * a picker, which reads as a checkout that has stalled.
 */
import { Box } from "@mui/material";
import type { JSX } from "react";

import { useCheckoutCopy } from "../copy-context";
import { offeredMethods } from "../method-capability";
import type { HostedHandoverCopy } from "../screens-copy";
import type { CheckoutProviderConfig } from "../types";
import { useCheckoutComponents } from "../ui";

import type { ProviderCheckoutScreenProps } from "./types";

/**
 * How the store's own page is named to the buyer — "à página segura da
 * InfinitePay", or the provider-neutral phrasing when no name was published.
 *
 * The neutral form is not a lesser fallback to be tidied away later: a host one
 * release behind serves no `displayName`, and the buyer of that store gets a
 * true sentence rather than our internal id ("infinitepay") dressed up as a
 * brand.
 */
function destinationLabel(copy: HostedHandoverCopy, config: CheckoutProviderConfig | null): string {
  const name = config?.chain?.[0]?.displayName?.trim();
  return name ? copy.destinationNamed(name) : copy.destinationGeneric;
}

/**
 * What the buyer will be asked to choose between once they get there, so the
 * sentence promises exactly what the provider's page offers.
 *
 * Read from the same declaration the picker used to render, which is what
 * keeps this honest for a provider that takes only one of the two: a hosted
 * PIX-only store must not promise a card.
 */
function methodsPhrase(
  copy: HostedHandoverCopy,
  config: CheckoutProviderConfig | null,
): string | null {
  const offered = offeredMethods(config);
  const pix = offered === null || offered.includes("PIX");
  const card = offered === null || offered.includes("CARD");
  if (pix && card) return copy.pixAndCard;
  if (pix) return copy.pixOnly;
  if (card) return copy.cardOnly;
  return null;
}

/** The full "where you are going and what happens there" sentence. */
function handoffMessage(
  copy: HostedHandoverCopy,
  config: CheckoutProviderConfig | null,
): string {
  const methods = methodsPhrase(copy, config);
  const choice = methods ? copy.methodsChoice(methods) : "";
  return copy.handoff(destinationLabel(copy, config), choice);
}

/**
 * The moment after the button: the charge is being raised, then we navigate.
 *
 * Names the destination the way the store's chain declares it, from the one
 * helper, so the screen never words the provider two different ways.
 */
function HandOffPending({ config }: { config: CheckoutProviderConfig | null }): JSX.Element {
  const { Text, LoadingState } = useCheckoutComponents();
  const copy = useCheckoutCopy().screens.hosted;
  return (
    <Box
      data-testid="checkout-handoff-pending"
      sx={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "center", py: 4 }}
    >
      <LoadingState variant="spinner" message={copy.preparing} size="md" />
      <Text variant="body" size="md" as="p">
        {handoffMessage(copy, config)}
      </Text>
      <Text variant="caption" size="sm" as="p" color="secondary">
        {copy.afterwards}
      </Text>
    </Box>
  );
}

export function HostedLinkScreen({
  method,
  config,
}: ProviderCheckoutScreenProps): JSX.Element | null {
  // A method is set here once the buyer has committed — the list's bar ("Ir
  // para …") raised the hand-off. Until then the list's own hand-off row says
  // where she is going, and this pane stays out of the way.
  if (method) return <HandOffPending config={config} />;
  return null;
}
