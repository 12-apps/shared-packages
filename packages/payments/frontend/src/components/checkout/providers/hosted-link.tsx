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

import { offeredMethods } from "../method-capability";
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
function destinationLabel(config: CheckoutProviderConfig | null): string {
  const name = config?.chain?.[0]?.displayName?.trim();
  return name ? `à página de pagamento da ${name}` : "à página de pagamento segura do provedor";
}

/**
 * What the buyer will be asked to choose between once they get there, so the
 * sentence promises exactly what the provider's page offers.
 *
 * Read from the same declaration the picker used to render, which is what
 * keeps this honest for a provider that takes only one of the two: a hosted
 * PIX-only store must not promise a card.
 */
function methodsPhrase(config: CheckoutProviderConfig | null): string | null {
  const offered = offeredMethods(config);
  const pix = offered === null || offered.includes("PIX");
  const card = offered === null || offered.includes("CARD");
  if (pix && card) return "PIX ou cartão";
  if (pix) return "PIX";
  if (card) return "cartão";
  return null;
}

/** The full "where you are going and what happens there" sentence. */
function handoffMessage(config: CheckoutProviderConfig | null): string {
  const methods = methodsPhrase(config);
  const choice = methods ? `, onde você escolhe pagar com ${methods}` : "";
  return `Você será levado ${destinationLabel(config)}${choice}.`;
}

/** The invitation: what happens next, and the one button that starts it. */
function HandOffInvite({
  config,
  onStart,
}: {
  config: CheckoutProviderConfig | null;
  onStart: () => void;
}): JSX.Element {
  const { Button, Text } = useCheckoutComponents();
  return (
    <Box
      data-testid="checkout-handoff-invite"
      sx={{ display: "flex", flexDirection: "column", gap: 2 }}
    >
      <Text variant="body" size="md" as="p">
        {handoffMessage(config)}
      </Text>
      <Text variant="caption" size="sm" as="p" color="secondary">
        Assim que o pagamento for concluído, você volta para cá e nós confirmamos o pedido.
      </Text>
      <Button
        variant="solid"
        color="primary"
        size="lg"
        fullWidth
        onClick={onStart}
        dataTestId="checkout-handoff-start"
      >
        Seguir para o pagamento
      </Button>
    </Box>
  );
}

/** The moment after the button: the charge is being raised, then we navigate. */
function HandOffPending(): JSX.Element {
  const { Text, LoadingState } = useCheckoutComponents();
  return (
    <Box
      data-testid="checkout-handoff-pending"
      sx={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "center", py: 4 }}
    >
      <LoadingState variant="spinner" message="Preparando o pagamento" size="md" />
      <Text variant="body" size="md" as="p">
        Você será levado à página segura do provedor para concluir o pagamento.
      </Text>
      <Text variant="caption" size="sm" as="p" color="secondary">
        Assim que terminar, você volta para cá e nós confirmamos o pedido.
      </Text>
    </Box>
  );
}

export function HostedLinkScreen({
  method,
  config,
  onStart,
}: ProviderCheckoutScreenProps): JSX.Element | null {
  // A method is only ever set here once the buyer has committed — either by
  // pressing the CTA below, or (on a host whose shell still renders a picker)
  // by choosing a tile. Both mean the same thing: the hand-off is underway.
  if (method) return <HandOffPending />;
  // No method and no CTA to offer ⇒ the shell is still showing its picker, and
  // the pane stays out of the way exactly as every other screen does.
  if (!onStart) return null;
  return <HandOffInvite config={config} onStart={onStart} />;
}
